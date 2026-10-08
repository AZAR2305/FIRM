// Copies ../deployments/10143.json (the single source of truth for addresses AND ABIs) into src/generated/ so the app can import
// it. Nothing else supplies addresses to the frontend.
//
//   node scripts/sync-deployments.mjs                       real testnet file: ../deployments/10143.json
//   FIRM_FORK=1 node scripts/sync-deployments.mjs           local fork file:   ../deployments/10143.fork.json (never committed)
//   FIRM_DEPLOYMENTS_PATH=/path/to.json node ...            any other file
//
// If the file does not exist yet (FIRM is not deployed to the public testnet until a funded wallet runs Redeploy.sh), a stub
// { "deployed": false } is written and the app shows a clear "not deployed yet" state instead of failing.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const fork = process.env.FIRM_FORK === "1";
const src = resolve(process.env.FIRM_DEPLOYMENTS_PATH ?? join(root, "deployments", fork ? "10143.fork.json" : "10143.json"));
const out = join(here, "..", "src", "generated", "deployments.json");
mkdirSync(dirname(out), { recursive: true });

if (!existsSync(src)) {
  writeFileSync(out, JSON.stringify({ deployed: false, reason: `deployments file not found: ${src}` }, null, 2) + "\n");
  console.warn(`[sync-deployments] ${src} not found: the app will show "not deployed yet". Run contracts/script/Redeploy.sh.`);
  process.exit(0);
}

const d = JSON.parse(readFileSync(src, "utf8"));
const problems = [];
if (d.chainId !== 10143) problems.push(`chainId is ${d.chainId}, expected 10143`);
for (const k of ["scoreboard", "firmRouter", "rawRouter", "canaryRunner"]) if (!d.core?.[k]?.address) problems.push(`core.${k}.address missing`);
for (const k of ["Scoreboard", "FirmRouter", "RawRouter", "MockToken", "V4Quoter"]) if (!Array.isArray(d.abis?.[k])) problems.push(`abis.${k} missing (re-run Redeploy.sh)`);
if (!d.fixtures?.tUSD || !d.pools?.list) problems.push("fixtures/pools missing (the demo needs the seeded pools)");
if (problems.length) {
  console.error(`[sync-deployments] ${src} is not usable:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

// "source" lets the UI show a loud ribbon when the build points at a fork instead of the real testnet.
writeFileSync(out, JSON.stringify({ ...d, deployed: true, source: fork || src.includes(".fork.") ? "fork" : "testnet" }, null, 2) + "\n");
console.log(`[sync-deployments] ${src} -> src/generated/deployments.json (${fork || src.includes(".fork.") ? "FORK" : "testnet"})`);
