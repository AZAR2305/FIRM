// Builds deployments/10143.evidence.json: the proof the frontend's /proof page and landing page show.
// Everything chain-derived is READ FROM THE CHAIN when this runs (receipts and events of the transactions you name, eth_estimateGas for the
// gas matrix, the gas price); nothing is typed in. A small `recorded` block holds results of other commands (deployment cost,
// verification, Envio check) with the date and the command that produced them, because they are not readable from one RPC call.
//
//   node scripts/build-evidence.mjs --tx raw=0xe69c... --tx firm=0xbaca...       (real testnet; uses deployments/10143.json)
//   FIRM_FORK=1 node scripts/build-evidence.mjs ...                                (a local fork; writes *.fork.json)
//
// Needs MONAD_TESTNET_RPC_URL (default: the public RPC). The public RPC allows about 15 requests per second: calls are paced.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT } from "./lib/deployments.mjs";

const { createPublicClient, http, parseEventLogs, formatEther } = createRequire(join(ROOT, "backend", "shared", "package.json"))("viem");

const fork = process.env.FIRM_FORK === "1";
const depPath = join(ROOT, "deployments", fork ? "10143.fork.json" : "10143.json");
const outPath = join(ROOT, "deployments", fork ? "10143.evidence.fork.json" : "10143.evidence.json");
const d = JSON.parse(readFileSync(depPath, "utf8"));
const RPC = process.env.MONAD_TESTNET_RPC_URL || (fork ? "http://127.0.0.1:8546" : "https://testnet-rpc.monad.xyz");
const client = createPublicClient({ transport: http(RPC) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = () => sleep(120);

const args = process.argv.slice(2);
const txArgs = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--tx") txArgs.push(args[++i]);
const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const txSpecs = txArgs.length ? txArgs.map((s) => s.split("=")) : (prev.txs ?? []).map((t) => [t.label, t.hash]);
if (!txSpecs.length) throw new Error("name at least one transaction: --tx raw=0x... --tx firm=0x...");

const poolName = new Map(Object.entries(d.pools.list).map(([n, p]) => [p.poolId.toLowerCase(), n]));
const abi = [...d.abis.FirmRouter, ...d.abis.RawRouter, ...d.abis.Scoreboard];
const TITLES = { raw: "Unprotected router (RawRouter) through the best-quoted cheating pool", firm: "Protected router (FirmRouter): rejects the cheat, falls back, strikes it" };

const txs = [];
for (const [label, hash] of txSpecs) {
  const [r, t] = [await client.getTransactionReceipt({ hash }), await client.getTransaction({ hash })];
  await pace();
  const block = await client.getBlock({ blockNumber: r.blockNumber });
  await pace();
  const events = parseEventLogs({ abi, logs: r.logs, strict: false })
    .filter((l) => ["RawSwap", "LegSkipped", "Rejected", "Filled", "NoFill", "StrikeRecorded", "StatusChanged", "FillRecorded"].includes(l.eventName))
    .map((l) => {
      const a = l.args;
      const e = { name: l.eventName };
      if (a.poolId) e.pool = poolName.get(a.poolId.toLowerCase()) ?? a.poolId;
      if (a.hook) e.hook = a.hook;
      for (const k of ["amountIn", "amountOut", "quotedOut", "settledOut", "shortfallBps"]) if (a[k] !== undefined) e[k] = a[k].toString();
      for (const k of ["execFailed", "reason", "legIndex", "oldStatus", "newStatus"]) if (a[k] !== undefined) e[k] = typeof a[k] === "bigint" ? a[k].toString() : a[k];
      if (e.reason && typeof e.reason === "string" && e.reason.startsWith("0x")) e.reason = Buffer.from(e.reason.slice(2), "hex").toString().replace(/\0+$/, "");
      return e;
    });
  txs.push({ label, title: TITLES[label] ?? label, hash, block: Number(r.blockNumber), timestamp: Number(block.timestamp), status: r.status, gasLimit: t.gas.toString(), events });
}

// ---- gas matrix: eth_estimateGas, the smallest limit that succeeds, from the deployer (holds the tokens and the approvals)
const from = d.owner;
const z = d.pools.zeroForOne;
const key = (n) => ({ currency0: d.pools.currency0, currency1: d.pools.currency1, fee: d.pools.list[n].fee, tickSpacing: d.pools.tickSpacing, hooks: d.pools.list[n].hook });
const route = (n) => ({ key: key(n), zeroForOne: z, hookData: "0x", advertisedOut: 0n });
const dl = BigInt(Math.floor(Date.now() / 1000) + 3600);
const E18 = 10n ** 18n;
const est = async (address, a, functionName, argv) => {
  await pace();
  try {
    return Number(await client.estimateContractGas({ address, abi: a, functionName, args: argv, account: from }));
  } catch (e) {
    return { error: String(e.shortMessage ?? e.message).split("\n")[0].slice(0, 120) };
  }
};
const gasPrice = await client.getGasPrice();
// Gas depends on state: the first swap through a hook touches new storage and costs more, and a BLOCKED hook is skipped by the router.
// So each pool carries its current Scoreboard status, and a protected estimate through a non-UNRATED hook is not reported as comparable.
const STATUS = ["UNRATED", "NORMAL", "WATCH", "BLOCKED"];
const statusOf = async (n) => {
  await pace();
  const hook = d.pools.list[n].hook;
  return hook === "0x0000000000000000000000000000000000000000" ? "NORMAL" : STATUS[Number(await client.readContract({ address: d.core.scoreboard.address, abi: d.abis.Scoreboard, functionName: "statusOf", args: [hook] }))];
};
const amount = 100n * E18;
const pools = {};
const quote = {};
const statuses = {};
for (const n of ["A", "C", "B", "D", "E", "Q"]) {
  statuses[n] = await statusOf(n);
  const blocked = statuses[n] === "BLOCKED";
  pools[n] = {
    status: statuses[n],
    raw: await est(d.core.rawRouter.address, d.abis.RawRouter, "swapExactInRaw", [route(n), amount, 0n, from]),
    protected: blocked ? null : await est(d.core.firmRouter.address, d.abis.FirmRouter, "swapExactIn", [[route(n)], amount, 0n, from, dl]),
    ...(blocked ? { protectedNote: "not measured: the router skips a BLOCKED hook, so the estimate would not include a swap" } : {}),
  };
}
for (const n of ["A", "B", "C", "D", "E", "G", "Q"]) {
  quote[n] = await est(d.infra.v4Quoter, d.abis.V4Quoter, "quoteExactInputSingle", [{ poolKey: key(n), zeroForOne: z, exactAmount: amount, hookData: "0x" }]);
}
const gas = {
  method: "eth_estimateGas on the target network (smallest gas limit that succeeds); includes the 21,000 base cost; one route, 100 tUSD",
  amountIn: amount.toString(),
  pools,
  quotePerCall: quote,
  demoShape: {
    note: "1,000 tUSD, routes [B, C, A]: B rejected, C fills",
    protected: statuses.B === "BLOCKED" ? null : await est(d.core.firmRouter.address, d.abis.FirmRouter, "swapExactIn", [[route("B"), route("C"), route("A")], 1000n * E18, 0n, from, dl]),
    ...(statuses.B === "BLOCKED" ? { protectedNote: "not measured now: Pool B is BLOCKED (struck by the demo swap), so the router would skip it. See recorded.firstTouch for the first-encounter number." } : {}),
  },
  hostileFirst: {
    note: "100 tUSD, routes [G (gas-grief hook), A]: G burns its whole leg cap, is struck, A fills",
    protected: await est(d.core.firmRouter.address, d.abis.FirmRouter, "swapExactIn", [[route("G"), route("A")], amount, 0n, from, dl]),
  },
};

const chain = { head: Number(await client.getBlockNumber()), gasPriceWei: gasPrice.toString(), gasPriceGwei: Number(gasPrice) / 1e9 };

// ---- results of other commands, with date and command (not readable from one RPC call). Edit when you re-run them.
const recorded = prev.recorded ?? {
  deployment: {
    date: "2026-10-11",
    command: "cd contracts && ./script/Redeploy.sh",
    transactions: 37,
    succeeded: 37,
    gasLimitsSent: 22_200_000,
    monSpent: 2.29,
    monSpentNote: "deployer balance 5.0 before, 2.7089 after; the gas price moved slightly during the run",
    verified: "14 of 14 contracts verified on Sourcify (exact_match)",
  },
  envioCheck: { date: "2026-10-11", command: "cd backend/bench && pnpm check-indexer", result: "indexer agrees with the Scoreboard for all 7 hooks (status, fills, strikes, probes)", mode: "Envio HyperSync, real Monad Testnet" },
  // The FIRST swap through a hook touches storage that does not exist yet and costs more than later swaps. These were measured with
  // eth_estimateGas before the demo swap, while every hook and token balance was still zero: what a new user pays on a fresh pool.
  firstTouch: {
    date: "2026-10-11",
    state: "before the demo swap: every hook UNRATED, no fills",
    method: "eth_estimateGas on the public testnet, 100 tUSD, one route (demo shape: 1,000 tUSD)",
    pools: {
      A: { raw: 276219, protected: 397427 },
      C: { raw: 318983, protected: 563354 },
      B: { raw: 319144, protected: 517566 },
      D: { raw: 347884, protected: 546342 },
      E: { raw: 319229, protected: 470109 },
      Q: { raw: 265135, protected: 434705 },
    },
    quotePerCall: { A: 110188, B: 98561, C: 141022, D: 116830, E: 116836, G: 116059, Q: 98055 },
    demoShape: 927759,
    hostileFirst: 998495,
  },
  notRun: "The 20-trial benchmark B1 to B8 (about 560 transactions) was not run on the public testnet: Monad charges the gas limit and the budget was one funded wallet. See docs/RESULTS.md.",
};

const out = { generatedAt: new Date().toISOString(), source: fork ? "fork" : "testnet", chainId: 10143, rpc: fork ? "local fork" : "public Monad Testnet RPC", chain, from, txs, gas, recorded };
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

const bad = [...Object.values(pools).flatMap((p) => [p.raw, p.protected]), ...Object.values(quote), gas.demoShape.protected, gas.hostileFirst.protected].filter((v) => v !== null && typeof v !== "number");
console.log(`wrote ${outPath}: ${txs.length} transactions, ${Object.keys(pools).length} pools measured, gas price ${chain.gasPriceGwei} gwei, head ${chain.head}`);
for (const t of txs) console.log(`  ${t.label}: ${t.status} block ${t.block}, events: ${t.events.map((e) => e.name + (e.pool ? ":" + e.pool : "")).join(", ")}`);
for (const n of Object.keys(pools)) console.log(`  pool ${n} (${pools[n].status}): raw ${pools[n].raw}, protected ${pools[n].protected}`);
console.log(`  demo shape ${gas.demoShape.protected}, hostile first ${gas.hostileFirst.protected}; one protected swap on pool A costs ${formatEther(BigInt(pools.A.protected ?? 0) * gasPrice)} MON at the limit`);
if (bad.length) console.log(`WARNING: ${bad.length} estimates failed:`, JSON.stringify(bad));
