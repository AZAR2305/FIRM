// Prints the gas LIMIT and the gas USED of every transaction in the last deployment, per script, and what the limits cost.
// Monad charges the gas limit, so "limit" is what you pay; "used" shows how much slack is left in each limit.
//
//   node scripts/gas-report.mjs [--gas-price-wei <wei>] [--json <file>]
//
// Numbers from a local fork are FORK-MEASURED (Ethereum gas schedule), not Monad-measured.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BROADCAST, STAGE, CHAIN_ID, CREATE2_DEPLOYER, IS_FORK } from "./lib/deployments.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const gasPrice = BigInt(arg("gas-price-wei") ?? process.env.GAS_PRICE_WEI ?? 0);
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const lc = (a) => (a ?? "").toLowerCase();

// address -> name, for labelling creations and calls
const names = new Map();
for (const f of ["core.json", "fixtures.json"]) {
  const j = readJson(join(STAGE, f));
  for (const [k, v] of Object.entries(j ?? {})) if (typeof v === "string" && v.startsWith("0x") && v.length === 42) names.set(lc(v), k);
}

let totalLimit = 0n;
let totalUsed = 0n;
const rows = [];
for (const script of ["Deploy", "DeployFixtures", "SeedPools"]) {
  const run = readJson(join(BROADCAST, `${script}.s.sol`, String(CHAIN_ID), "run-latest.json"));
  if (!run) continue;
  const used = new Map(run.receipts.map((r) => [lc(r.transactionHash), BigInt(r.gasUsed)]));
  for (const tx of run.transactions) {
    const limit = BigInt(tx.transaction.gas);
    const u = used.get(lc(tx.hash)) ?? 0n;
    const target = lc(tx.transaction.to);
    const what =
      tx.transactionType === "CREATE2" || target === CREATE2_DEPLOYER
        ? `create ${names.get(lc(tx.contractAddress)) ?? tx.contractName ?? "?"}`
        : `${(tx.function ?? "call").split("(")[0]} -> ${names.get(target) ?? (target === "0x451d64ab3b650040d2ae1886602b97ed6edc643d" ? "PoolManager" : target.slice(0, 10))}`;
    rows.push({ script, what, limit, used: u });
    totalLimit += limit;
    totalUsed += u;
  }
}
if (!rows.length) {
  console.error("no broadcast found under contracts/broadcast: run contracts/script/Redeploy.sh first");
  process.exit(1);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("script", 15)}${pad("tx", 52)}${pad("gas limit", 12)}${pad("gas used", 12)}limit/used`);
for (const r of rows) {
  console.log(`${pad(r.script, 15)}${pad(r.what, 52)}${pad(r.limit, 12)}${pad(r.used, 12)}${r.used ? (Number(r.limit) / Number(r.used)).toFixed(2) : "n/a"}`);
}
const ratio = (Number(totalLimit) / Number(totalUsed)).toFixed(2);
console.log(`${pad("TOTAL", 15)}${pad(`${rows.length} transactions`, 52)}${pad(totalLimit, 12)}${pad(totalUsed, 12)}${ratio}`);
if (gasPrice > 0n) {
  const mon = (w) => (Number(w) / 1e18).toFixed(4);
  console.log(`cost of the limits at ${Number(gasPrice) / 1e9} gwei: ${mon(totalLimit * gasPrice)} MON (what Monad charges); cost of gas used: ${mon(totalUsed * gasPrice)} MON`);
}
const budgetGas = arg("budget-gas");
if (budgetGas) {
  const ok = totalLimit <= BigInt(budgetGas);
  console.log(`preflight budget ${budgetGas} gas vs limits actually sent ${totalLimit}: ${ok ? "within budget" : "OVER BUDGET: update COUNTS in scripts/gas-budget.mjs"}`);
}
console.log(`(${IS_FORK ? "FORK-MEASURED" : "measured on the target network"}; if this was a fork it is not Monad-measured)`);

const out = arg("json");
if (out) writeFileSync(out, JSON.stringify({ totalLimit: totalLimit.toString(), totalUsed: totalUsed.toString(), rows: rows.map((r) => ({ ...r, limit: r.limit.toString(), used: r.used.toString() })) }, null, 2));
