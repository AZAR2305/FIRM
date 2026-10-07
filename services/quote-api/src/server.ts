import { serve } from "@hono/node-server";
import { createLogger, createRpcPool, loadDeployments } from "@firm/shared";
import { createApp } from "./app";
import { ViemChainReader } from "./chainReader";
import { loadConfig } from "./config";
import { DeploymentsPoolSource, FallbackPoolSource, IndexerPoolSource } from "./pools";
import { fileReportReader } from "./reports";

const log = createLogger("quote-api");
const config = loadConfig();
const dep = loadDeployments();
const rpc = createRpcPool();

const staticSource = new DeploymentsPoolSource(dep);
const source = config.ENVIO_GRAPHQL_URL
  ? new FallbackPoolSource(new IndexerPoolSource(config.ENVIO_GRAPHQL_URL), staticSource, log)
  : staticSource;

const app = createApp({
  chain: new ViemChainReader(rpc.client, dep, rpc.inUse),
  source,
  dep,
  log,
  reports: fileReportReader(config.REPORTS_DIR),
  client: rpc.client,
  cacheMs: config.QUOTE_CACHE_MS,
  corsOrigin: config.CORS_ORIGIN,
});

serve({ fetch: app.fetch, port: config.QUOTE_API_PORT }, (info) => {
  log.info("quote-api listening", {
    port: info.port,
    indexer: config.ENVIO_GRAPHQL_URL ? "envio + deployments fallback" : "deployments only",
    rpcs: rpc.endpoints.map((e) => e.url),
  });
});
