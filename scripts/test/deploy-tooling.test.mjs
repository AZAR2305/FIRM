// Guards for the deployment tooling. Run: node --test scripts/test/deploy-tooling.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/deployments.mjs";
import { LIMITS, COUNTS, budgetGas } from "../gas-budget.mjs";

const scriptDir = join(ROOT, "contracts", "script");
const solScripts = readdirSync(scriptDir)
  .filter((f) => f.endsWith(".s.sol"))
  .map((f) => readFileSync(join(scriptDir, f), "utf8"));
const redeploy = readFileSync(join(scriptDir, "Redeploy.sh"), "utf8");

test("every transaction kind counted in the budget has a limit in GasLimits.sol", () => {
  for (const k of Object.keys(COUNTS)) assert.ok(k in LIMITS, `${k} missing from GasLimits.sol`);
});

test("every limit in GasLimits.sol is used by a script", () => {
  const all = solScripts.join("\n");
  for (const k of Object.keys(LIMITS)) assert.ok(all.includes(`GasLimits.${k}`), `GasLimits.${k} is not referenced by any script`);
});

test("budget is the sum of limit x count and scales with FIRM_GAS_SCALE_PCT", () => {
  const sum = Object.entries(COUNTS).reduce((a, [k, n]) => a + LIMITS[k] * n, 0);
  assert.equal(budgetGas(100), sum);
  assert.equal(budgetGas(150), Math.floor(sum * 1.5));
});

test("no limit is a placeholder-sized default (every limit is below 3M)", () => {
  for (const [k, v] of Object.entries(LIMITS)) assert.ok(v < 3_000_000, `${k} = ${v} looks like an unmeasured default`);
});

test("no broadcasting script creates a contract with a bare new (creation goes through _create2 with a gas limit)", () => {
  const bareNew = /\bnew\s+[A-Z]\w*\s*[({]/;
  for (const src of solScripts.filter((x) => x.includes("vm.startBroadcast"))) {
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(!bareNew.test(code), "bare `new Contract(...)` in a broadcasting script");
  }
});

test("Redeploy.sh sends explicit limits only and checks the balance before building", () => {
  assert.ok(redeploy.includes("--skip-simulation"), "the first tx would get Foundry's estimate");
  assert.ok(!redeploy.includes("--gas-estimate-multiplier"), "an estimate multiplier means a limit that is not explicit");
  const buildAt = redeploy.search(/^forge build$/m);
  assert.ok(buildAt > 0 && redeploy.indexOf("preflight: OK") < buildAt, "balance check must come before anything is built or sent");
  assert.ok(redeploy.includes("Verify.sh"), "Redeploy must run Verify.sh");
});

test("readBroadcasts ignores non-deployment scripts and failed runs without hashes or receipts (found on the real testnet)", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { readBroadcasts } = await import("../lib/deployments.mjs");
  const dir = mkdtempSync(join(tmpdir(), "bc-"));
  const put = (script, run) => {
    mkdirSync(join(dir, `${script}.s.sol`, "10143"), { recursive: true });
    writeFileSync(join(dir, `${script}.s.sol`, "10143", "run-latest.json"), JSON.stringify(run));
  };
  // a failed DemoSwap: the pending transaction has a null hash and there is no receipt for it
  put("DemoSwap", { transactions: [{ hash: null, transaction: { to: "0x0000000000000000000000000000000000000001", input: "0x" } }], receipts: [{ transactionHash: null, blockNumber: null }] });
  // a deployment script with a normal creation
  put("Deploy", { transactions: [{ hash: "0xabc", contractAddress: "0x00000000000000000000000000000000000000AA", transaction: {} }], receipts: [{ transactionHash: "0xabc", blockNumber: "0x10" }] });
  const map = readBroadcasts(dir);
  assert.deepEqual(map.get("0x00000000000000000000000000000000000000aa"), { hash: "0xabc", blockNumber: 16 });
  assert.equal(map.size, 1);
});
