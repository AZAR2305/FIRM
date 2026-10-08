// Shared model for the deployment tooling: merges the Foundry stage files and broadcast receipts into one
// description of what is deployed. Used by build-deployments.mjs and list-contracts.mjs.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STAGE = join(ROOT, "deployments", ".stage");
export const BROADCAST = join(ROOT, "contracts", "broadcast");
// FIRM_FORK=1 (local anvil forks) writes *.fork.* files that are git-ignored, so a fork deployment can never be
// committed as if it were the real testnet one.
export const IS_FORK = process.env.FIRM_FORK === "1";
export const OUT_JSON = join(ROOT, "deployments", IS_FORK ? "10143.fork.json" : "10143.json");
export const OUT_MD = join(ROOT, IS_FORK ? join("deployments", "DEPLOYMENTS.fork.md") : "DEPLOYMENTS.md");

export const CHAIN_ID = 10143;

// viem lives in the backend workspace; the deployment tooling only needs its CREATE2 address helper.
const { getCreate2Address, keccak256 } = createRequire(join(ROOT, "backend", "shared", "package.json"))("viem");

/** The deployer every contract is created through (explicit gas limit per creation, see contracts/script/DeployBase.sol). */
export const CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";

// Verified against docs.monad.xyz and the Monad hooks guide (spec 5.2, 5.3). Monad-maintained, not official.
export const INFRA = {
  poolManager: "0x451D64ab3b650040d2aE1886602b97ed6eDc643d",
  v4Quoter: "0x869834d127b230283fe63E0d0A9bEB67216a94C7",
  stateView: "0xB639209539c61BaF67AC04876315786F8D0b153c",
  universalRouter: "0x1b7bFCd2870329B987191910D85c22C7287f3c22",
  positionManager: "0x3Bb14E3D0Cd50aBe3EdACa06d06c29C78676C31A",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  wrappedMon: "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541",
};

// stage key -> Foundry contract identifier (for verification)
const CORE = {
  scoreboard: "src/Scoreboard.sol:Scoreboard",
  firmRouter: "src/FirmRouter.sol:FirmRouter",
  canaryRunner: "src/CanaryRunner.sol:CanaryRunner",
  rawRouter: "src/RawRouter.sol:RawRouter",
};
const FIXTURES = {
  tUSD: "test-fixtures/MockToken.sol:MockToken",
  tUSDC: "test-fixtures/MockToken.sol:MockToken",
  liquidityHelper: "test-fixtures/FixtureLiquidityHelper.sol:FixtureLiquidityHelper",
  hookContext: "test-fixtures/FixtureHooks.sol:FixtureContextHook",
  hookHonest: "test-fixtures/FixtureHooks.sol:FixtureHonestHook",
  hookRandomFee: "test-fixtures/FixtureHooks.sol:FixtureRandomFeeHook",
  hookSenderAware: "test-fixtures/FixtureHooks.sol:FixtureSenderAwareHook",
  hookGasGrief: "test-fixtures/FixtureHooks.sol:FixtureGasGriefHook",
  hookRevert: "test-fixtures/FixtureHooks.sol:FixtureRevertHook",
  hookQuoteOnly: "test-fixtures/FixtureHooks.sol:FixtureQuoteOnlyHook",
};
export const POOL_NAMES = {
  A: "hookless baseline",
  B: "FixtureContextHook (best quote, hidden fee on real path)",
  C: "FixtureHonestHook",
  D: "FixtureRandomFeeHook",
  E: "FixtureSenderAwareHook",
  G: "FixtureGasGriefHook",
  R: "FixtureRevertHook",
  Q: "FixtureQuoteOnlyHook (dynamic fee)",
};

// ABIs that ship inside deployments/10143.json so a frontend needs nothing but that one file (artifact file, contract name)
const ABI_SOURCES = {
  Scoreboard: ["Scoreboard.sol", "Scoreboard"],
  FirmRouter: ["FirmRouter.sol", "FirmRouter"],
  RawRouter: ["RawRouter.sol", "RawRouter"],
  CanaryRunner: ["CanaryRunner.sol", "CanaryRunner"],
  MockToken: ["MockToken.sol", "MockToken"],
  V4Quoter: ["IV4Quoter.sol", "IV4Quoter"],
};
function readAbis() {
  const out = {};
  for (const [name, [file, contract]] of Object.entries(ABI_SOURCES)) {
    const p = join(ROOT, "contracts", "out", file, `${contract}.json`);
    if (!existsSync(p)) throw new Error(`ABI for ${name} not found at ${p}: run forge build in contracts/`);
    out[name] = JSON.parse(readFileSync(p, "utf8")).abi;
  }
  return out;
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const lc = (a) => a.toLowerCase();

/** address (lowercase) -> { hash, blockNumber } from every Foundry broadcast run on chain 10143 */
export function readBroadcasts() {
  const map = new Map();
  if (!existsSync(BROADCAST)) return map;
  for (const script of readdirSync(BROADCAST)) {
    const run = readJson(join(BROADCAST, script, String(CHAIN_ID), "run-latest.json"));
    if (!run) continue;
    const blocks = new Map((run.receipts ?? []).map((r) => [lc(r.transactionHash), Number(BigInt(r.blockNumber))]));
    for (const tx of run.transactions ?? []) {
      let created = tx.contractAddress;
      const t = tx.transaction ?? {};
      if (!created && t.to && lc(t.to) === CREATE2_DEPLOYER && t.input) {
        // creation sent as a plain call to the CREATE2 deployer: input = salt (32 bytes) ++ init code
        const salt = "0x" + t.input.slice(2, 66);
        created = getCreate2Address({ from: CREATE2_DEPLOYER, salt, bytecodeHash: keccak256("0x" + t.input.slice(66)) });
      }
      if (!created) continue;
      map.set(lc(created), { hash: tx.hash, blockNumber: blocks.get(lc(tx.hash)) ?? null });
    }
  }
  return map;
}

export function buildModel() {
  const core = readJson(join(STAGE, "core.json"));
  const fx = readJson(join(STAGE, "fixtures.json"));
  const pools = readJson(join(STAGE, "pools.json"));
  const verified = readJson(join(STAGE, "verified.json")) ?? {};
  if (!core) throw new Error("deployments/.stage/core.json missing: run contracts/script/Redeploy.sh first");
  const tx = readBroadcasts();

  const entry = (address, contract) => {
    const t = tx.get(lc(address));
    return {
      address,
      contract,
      deployTx: t?.hash ?? null,
      blockNumber: t?.blockNumber ?? null,
      verification: verified[address] ?? verified[lc(address)] ?? "not attempted",
    };
  };

  const model = {
    chainId: CHAIN_ID,
    network: "Monad Testnet",
    generatedAt: new Date().toISOString(),
    owner: core.owner,
    runId: core.runId ?? null,
    infra: INFRA,
    core: Object.fromEntries(Object.entries(CORE).map(([k, c]) => [k, entry(core[k], c)])),
    fixtures: fx ? Object.fromEntries(Object.entries(FIXTURES).map(([k, c]) => [k, entry(fx[k], c)])) : null,
    pools: null,
  };

  if (pools) {
    const tUSD = fx.tUSD.toLowerCase();
    const c0 = pools.currency0;
    model.pools = {
      currency0: c0,
      currency1: pools.currency1,
      // direction of the demo trade tUSD -> tUSDC
      zeroForOne: lc(c0) === tUSD,
      tickSpacing: 60,
      list: Object.fromEntries(
        Object.keys(POOL_NAMES).map((n) => [
          n,
          { description: POOL_NAMES[n], poolId: pools[`${n}_id`], hook: pools[`${n}_hook`], fee: Number(pools[`${n}_fee`]) },
        ]),
      ),
    };
  }
  model.abis = readAbis();
  const blocks = Object.values(model.core).map((e) => e.blockNumber).filter((b) => b != null);
  model.startBlock = blocks.length ? Math.min(...blocks) : null;
  return model;
}

/** lines of `<address> <path:Contract>` for Verify.sh */
export function listContracts(model) {
  const rows = [];
  for (const group of [model.core, model.fixtures ?? {}]) {
    for (const e of Object.values(group)) rows.push([e.address, e.contract]);
  }
  return rows;
}
