// Re-arms the demo: moves the named cheating fixtures from BLOCKED back to WATCH (Scoreboard.reinstate, owner only), so the next
// protected swap can reject and strike them LIVE again instead of just skipping them. It does not hide anything: the earlier strikes stay
// in the Scoreboard's counters and in the transaction history, and a reinstated hook that cheats again is BLOCKED again by its next strike.
//
//   node scripts/demo-reset.mjs --dry-run                 show what would be sent, send nothing
//   node scripts/demo-reset.mjs --hooks B,G,R             send one reinstate per BLOCKED hook among them (default: B)
//
// Uses DEPLOYER_PRIVATE_KEY from .env (the Scoreboard owner). Each transaction has an explicit gas limit (Monad charges the limit):
// eth_estimateGas for reinstate was 45,439 on 2026-10-11, the limit is 80,000, about 0.008 MON at 102 gwei.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT } from "./lib/deployments.mjs";

const { createPublicClient, createWalletClient, http, formatEther } = createRequire(join(ROOT, "backend", "shared", "package.json"))("viem");
const { privateKeyToAccount } = createRequire(join(ROOT, "backend", "shared", "package.json"))("viem/accounts");

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dry = process.argv.includes("--dry-run");
const fork = process.env.FIRM_FORK === "1";
const d = JSON.parse(readFileSync(join(ROOT, "deployments", fork ? "10143.fork.json" : "10143.json"), "utf8"));
const RPC = process.env.MONAD_TESTNET_RPC_URL || (fork ? "http://127.0.0.1:8546" : "https://testnet-rpc.monad.xyz");
const GAS_LIMIT = 80_000n;
const STATUS = ["UNRATED", "NORMAL", "WATCH", "BLOCKED"];

const env = {};
if (existsSync(join(ROOT, ".env"))) for (const l of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) env[m[1]] = m[2].replace(/\s+#.*$/, "").trim(); }
const key = process.env.DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;

const pub = createPublicClient({ transport: http(RPC) });
const names = (arg("hooks") ?? "B").split(",").map((s) => s.trim().toUpperCase());
const sb = d.core.scoreboard.address;

const owner = await pub.readContract({ address: sb, abi: d.abis.Scoreboard, functionName: "owner" });
const account = key ? privateKeyToAccount(key) : null;
if (!dry) {
  if (!account) throw new Error("DEPLOYER_PRIVATE_KEY is not set (.env)");
  if (account.address.toLowerCase() !== owner.toLowerCase()) throw new Error(`this key is ${account.address}, the Scoreboard owner is ${owner}: only the owner can reinstate`);
}
console.log(`${fork ? "FORK" : "Monad Testnet"} via ${RPC}; Scoreboard ${sb}; owner ${owner}${dry ? "; DRY RUN" : ""}`);

const todo = [];
for (const n of names) {
  const p = d.pools.list[n];
  if (!p || p.hook === "0x0000000000000000000000000000000000000000") { console.log(`  Pool ${n}: not a hooked pool, skipped`); continue; }
  const st = STATUS[Number(await pub.readContract({ address: sb, abi: d.abis.Scoreboard, functionName: "statusOf", args: [p.hook] }))];
  console.log(`  Pool ${n} (${p.hook}): ${st}${st === "BLOCKED" ? "" : " (nothing to do: reinstate only applies to BLOCKED hooks)"}`);
  if (st === "BLOCKED") todo.push([n, p.hook]);
}
if (!todo.length) process.exit(0);
const price = await pub.getGasPrice();
const cost = BigInt(todo.length) * GAS_LIMIT * price;
console.log(`  ${todo.length} transaction(s), gas limit ${GAS_LIMIT} each, about ${formatEther(cost)} MON at ${Number(price) / 1e9} gwei`);
if (dry) process.exit(0);

const bal = await pub.getBalance({ address: account.address });
if (bal < cost * 2n) throw new Error(`balance ${formatEther(bal)} MON is below twice the cost ${formatEther(cost)} MON`);
const wallet = createWalletClient({ account, transport: http(RPC) });
for (const [n, hook] of todo) {
  const hash = await wallet.writeContract({ address: sb, abi: d.abis.Scoreboard, functionName: "reinstate", args: [hook], gas: GAS_LIMIT, chain: undefined });
  let r;
  for (let i = 0; i < 120 && !r; i++) {
    r = await pub.getTransactionReceipt({ hash }).catch(() => null);
    if (!r) await new Promise((x) => setTimeout(x, 700));
  }
  const after = STATUS[Number(await pub.readContract({ address: sb, abi: d.abis.Scoreboard, functionName: "statusOf", args: [hook] }))];
  console.log(`  Pool ${n}: ${r?.status ?? "pending"}, now ${after}: https://testnet.monadexplorer.com/tx/${hash}`);
}
