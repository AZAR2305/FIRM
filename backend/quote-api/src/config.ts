import { z } from "zod";

const schema = z.object({
  QUOTE_API_PORT: z.coerce.number().int().positive().default(8787),
  ENVIO_GRAPHQL_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  /** Directory with canary-agent reports: <dir>/<hook>.json */
  REPORTS_DIR: z.string().default("./reports"),
  QUOTE_CACHE_MS: z.coerce.number().int().min(0).default(1500),
  CORS_ORIGIN: z.string().default("*"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
