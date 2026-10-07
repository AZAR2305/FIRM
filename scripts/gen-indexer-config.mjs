// Rewrites addresses and start blocks in envio/config.yaml from the deployments file, so that a redeploy after a testnet
// reset is one command.
//
//   node scripts/gen-indexer-config.mjs
//   node scripts/gen-indexer-config.mjs --deployments deployments/10143.fork.json --out /tmp/config.yaml --rpc http://127.0.0.1:8546
//
// --deployments  deployments file (default: FIRM_DEPLOYMENTS_PATH or deployments/10143.json)
// --config       template to read (default: envio/config.yaml)
// --out          where to write (default: overwrite the template in place)
// --rpc          also pin chain 10143 to this RPC (used for local forks: HyperSync does not index them)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const depPath = resolve(arg("deployments") ?? process.env.FIRM_DEPLOYMENTS_PATH ?? join(root, "deployments", "10143.json"));
const cfgPath = resolve(arg("config") ?? join(root, "envio", "config.yaml"));
const outPath = resolve(arg("out") ?? cfgPath);
const rpc = arg("rpc");

const dep = JSON.parse(readFileSync(depPath, "utf8"));
let yaml = readFileSync(cfgPath, "utf8");

const addr = {
  PoolManager: dep.infra.poolManager,
  Scoreboard: dep.core.scoreboard.address,
  FirmRouter: dep.core.firmRouter.address,
  CanaryRunner: dep.core.canaryRunner.address,
};

for (const [name, a] of Object.entries(addr)) {
  // the `address:` line directly after `- name: <Name>`
  const re = new RegExp(`(- name: ${name}\\n\\s+address: )"?0x[0-9a-fA-F]{40}"?`);
  if (!re.test(yaml)) throw new Error(`could not find ${name} in ${cfgPath}`);
  yaml = yaml.replace(re, `$1"${a}"`);
}
if (dep.startBlock != null) yaml = yaml.replace(/start_block: \d+/, `start_block: ${dep.startBlock}`);
// `for: sync` makes this RPC the main source for historical AND live data (HyperSync would otherwise stay primary)
if (rpc && !/^\s+rpc:/m.test(yaml)) {
  yaml = yaml.replace(/(  - id: 10143\n)/, `$1    rpc:\n      - url: ${rpc}\n        for: sync\n`);
}

writeFileSync(outPath, yaml);
console.log(`${outPath} updated from ${depPath}: start_block ${dep.startBlock}, ${Object.keys(addr).length} contracts${rpc ? `, rpc ${rpc}` : ""}`);
