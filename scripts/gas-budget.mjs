// Preflight budget for contracts/script/Redeploy.sh: how many MON a full deployment needs.
//
//   node scripts/gas-budget.mjs --gas-price-wei <wei> [--scale-pct 100] [--json]
//
// Monad charges the gas LIMIT of every transaction, so the budget is the sum of the explicit limits in
// contracts/script/GasLimits.sol times the number of transactions of each kind, times the gas price, plus a buffer for
// the price moving between this check and the last transaction. FORK-MEASURED limits, not Monad-measured.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/deployments.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const src = readFileSync(join(ROOT, "contracts", "script", "GasLimits.sol"), "utf8");
export const LIMITS = Object.fromEntries(
  [...src.matchAll(/uint256 internal constant (\w+) = ([\d_]+);/g)].map(([, k, v]) => [k, Number(v.replaceAll("_", ""))]),
);

/** How many transactions of each kind a full Redeploy sends (Deploy + DeployFixtures + SeedPools). Keep in sync with the scripts;
 *  gas-report.mjs compares this with what was really sent. */
export const COUNTS = {
  CREATE_SCOREBOARD: 1,
  CREATE_FIRM_ROUTER: 1,
  CREATE_CANARY_RUNNER: 1,
  CREATE_RAW_ROUTER: 1,
  SET_REPORTER: 2,
  SET_PARAMS: 1,
  CREATE_MOCK_TOKEN: 2,
  CREATE_LIQUIDITY_HELPER: 1,
  CREATE_HOOK: 7,
  OWNER_MINT: 2,
  APPROVE: 2,
  INITIALIZE_POOL: 8,
  ADD_LIQUIDITY: 8,
};

export function budgetGas(scalePct = 100) {
  let total = 0;
  for (const [k, n] of Object.entries(COUNTS)) {
    if (!(k in LIMITS)) throw new Error(`GasLimits.sol has no constant ${k}`);
    total += Math.floor((LIMITS[k] * scalePct) / 100) * n;
  }
  return total;
}

if (process.argv[1] && process.argv[1].endsWith("gas-budget.mjs")) {
  const gasPrice = BigInt(arg("gas-price-wei", "0"));
  const scale = Number(arg("scale-pct", "100"));
  const bufferPct = Number(arg("buffer-pct", "25"));
  const gas = BigInt(budgetGas(scale));
  const needWei = (gas * gasPrice * BigInt(100 + bufferPct)) / 100n;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ gas: gas.toString(), gasPriceWei: gasPrice.toString(), bufferPct, needWei: needWei.toString() }));
  } else {
    console.log(`${gas} gas of limits x ${Number(gasPrice) / 1e9} gwei + ${bufferPct}% buffer = ${Number(needWei) / 1e18} MON`);
  }
}
