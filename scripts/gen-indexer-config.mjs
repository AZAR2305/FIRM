// Rewrites addresses and start blocks in indexer/config.yaml from deployments/10143.json, so that a redeploy after a
// testnet reset is one command:  node scripts/gen-indexer-config.mjs  (or: pnpm --dir indexer run config)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(join(root, "deployments", "10143.json"), "utf8"));
const cfgPath = join(root, "indexer", "config.yaml");
let yaml = readFileSync(cfgPath, "utf8");

const addr = {
  PoolManager: dep.infra.poolManager,
  Scoreboard: dep.core.scoreboard.address,
  FirmRouter: dep.core.firmRouter.address,
  CanaryRunner: dep.core.canaryRunner.address,
};

for (const [name, a] of Object.entries(addr)) {
  // the `address:` line directly after `- name: <Name>`
  const re = new RegExp(`(- name: ${name}\\n\\s+address: )0x[0-9a-fA-F]{40}`);
  if (!re.test(yaml)) throw new Error(`could not find ${name} in indexer/config.yaml`);
  yaml = yaml.replace(re, `$1${a}`);
}
if (dep.startBlock != null) yaml = yaml.replace(/start_block: \d+/, `start_block: ${dep.startBlock}`);

writeFileSync(cfgPath, yaml);
console.log(`indexer/config.yaml updated: start_block ${dep.startBlock}, ${Object.keys(addr).length} contracts`);
