// Checks that an Envio GraphQL endpoint (hosted or local) is usable by the FIRM web app, before you put it into the build.
//
//   node scripts/check-envio-endpoint.mjs <graphql url> [--origin https://your-live-site] [--secret <hasura admin secret>]
//
// What it checks, and why it matters:
//   1. the queries the app sends work (Hook list, activity tables)
//   2. CORS: a browser on --origin may read the answer (a POST with Origin, and the OPTIONS preflight)
//   3. chain_metadata is exposed (optional: without it the app says it cannot report the lag)
//   4. the index AGREES with the Scoreboard contract for every hook (status, fills, strikes, probes), read from the chain
// Exit code 1 if anything the app depends on fails. Uses deployments/10143.json (FIRM_FORK=1 for the fork file).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT } from "./lib/deployments.mjs";

const { createPublicClient, http } = createRequire(join(ROOT, "backend", "shared", "package.json"))("viem");
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = process.argv[2];
if (!url || url.startsWith("--")) {
  console.error("usage: node scripts/check-envio-endpoint.mjs <graphql url> [--origin <site>] [--secret <admin secret>]");
  process.exit(2);
}
const origin = arg("origin") ?? "http://localhost:3000";
const secret = arg("secret");
const fork = process.env.FIRM_FORK === "1";
const d = JSON.parse(readFileSync(join(ROOT, "deployments", fork ? "10143.fork.json" : "10143.json"), "utf8"));
const RPC = process.env.MONAD_TESTNET_RPC_URL || (fork ? "http://127.0.0.1:8546" : "https://testnet-rpc.monad.xyz");
const client = createPublicClient({ transport: http(RPC) });

let failed = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failed++;
  console.log(`  FAIL  ${m}`);
};
const info = (m) => console.log(`  note  ${m}`);

async function post(query, headers = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-hasura-admin-secret": secret } : {}), ...headers }, body: JSON.stringify({ query }) });
  const body = await res.json().catch(() => ({}));
  return { res, body, ms: Date.now() - t0 };
}

console.log(`endpoint ${url}\norigin   ${origin}\nchain    ${RPC}${secret ? "\n(using an admin secret: the browser will NOT have one, so also run without --secret)" : ""}\n`);

// reachability first, with a clear message instead of a stack trace
try {
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ __typename }" }) });
} catch (e) {
  console.log(`  FAIL  cannot reach ${url}: ${e.cause?.code ?? e.message}. Is the indexer running, and is the URL the /v1/graphql one?`);
  process.exit(1);
}

// 1. queries the app sends
const hooks = await post("{ Hook { id status fills strikes probes probeStrikes avgShortfallBps lastStrikeAt flags } }", { origin });
if (hooks.body.errors) bad(`Hook query: ${hooks.body.errors[0].message}`);
else if (!hooks.body.data?.Hook) bad("Hook query returned no data");
else ok(`Hook query: ${hooks.body.data.Hook.length} hook(s) in ${hooks.ms} ms`);
for (const [t, f] of [["Fill", "id ts txHash"], ["Strike", "id ts txHash shortfallBps"], ["Probe", "id ts txHash"], ["StatusChange", "id ts oldStatus newStatus"], ["Skip", "id ts txHash reason"]]) {
  const r = await post(`{ ${t}(limit: 1, order_by: {ts: desc}) { ${f} } }`, { origin });
  if (r.body.errors) bad(`${t} table: ${r.body.errors[0].message}`);
  else ok(`${t} table readable (${r.body.data[t].length} row)`);
}

// 2. CORS, as a browser sees it
const acao = hooks.res.headers.get("access-control-allow-origin");
if (acao === "*" || acao === origin) ok(`CORS on the answer: access-control-allow-origin = ${acao}`);
else bad(`CORS: a browser on ${origin} would be blocked (access-control-allow-origin = ${acao ?? "absent"}). Add the site to the endpoint's allowed domains.`);
try {
  const pre = await fetch(url, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
  const pa = pre.headers.get("access-control-allow-origin");
  if (pre.status < 300 && (pa === "*" || pa === origin)) ok(`CORS preflight: HTTP ${pre.status}, allow-origin ${pa}`);
  else bad(`CORS preflight: HTTP ${pre.status}, allow-origin ${pa ?? "absent"}`);
} catch (e) {
  bad(`CORS preflight failed: ${e.message}`);
}

// 3. lag
const meta = await post("{ chain_metadata { latest_processed_block block_height is_hyper_sync } }", { origin });
const m = meta.body.data?.chain_metadata?.[0];
if (m) {
  const head = Number(await client.getBlockNumber());
  const lag = head - Number(m.latest_processed_block);
  ok(`chain_metadata exposed: indexed to ${m.latest_processed_block}, chain head ${head}, ${lag} block(s) behind, hyperSync=${m.is_hyper_sync}`);
  if (lag > 300) bad(`the index is ${lag} blocks behind: still syncing, or stuck`);
} else info("chain_metadata is not exposed: the app still works and says it cannot report the lag");

// 4. agreement with the chain
if (hooks.body.data?.Hook) {
  const byHook = new Map(hooks.body.data.Hook.map((h) => [h.id.toLowerCase(), h]));
  const STATUS = ["UNRATED", "NORMAL", "WATCH", "BLOCKED"];
  let compared = 0;
  for (const [pool, p] of Object.entries(d.pools.list)) {
    if (p.hook === "0x0000000000000000000000000000000000000000") continue;
    const s = await client.readContract({ address: d.core.scoreboard.address, abi: d.abis.Scoreboard, functionName: "stats", args: [p.hook] });
    const e = byHook.get(p.hook.toLowerCase());
    const chain = { status: STATUS[Number(s.status)], fills: Number(s.fills), strikes: Number(s.strikes), probes: Number(s.probes) };
    const idx = e ? { status: e.status, fills: e.fills, strikes: e.strikes, probes: e.probes } : { status: "UNRATED", fills: 0, strikes: 0, probes: 0 };
    compared++;
    const same = JSON.stringify(chain) === JSON.stringify(idx);
    if (same) ok(`Pool ${pool}: index = chain (${chain.status}, fills ${chain.fills}, strikes ${chain.strikes}, probes ${chain.probes})`);
    else bad(`Pool ${pool}: index ${JSON.stringify(idx)} but chain ${JSON.stringify(chain)} (still syncing?)`);
  }
  info(`${compared} hooked pools compared with the Scoreboard contract`);
}

console.log(failed ? `\n${failed} check(s) failed: do not put this endpoint into the live build yet.` : "\nAll checks passed: this endpoint can power the live site.");
process.exit(failed ? 1 : 0);
