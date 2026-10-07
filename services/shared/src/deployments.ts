import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Address, Hex } from "viem";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<Address>;
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as unknown as z.ZodType<Hex>;

const entry = z.object({
  address: addr,
  contract: z.string(),
  deployTx: z.string().nullable(),
  blockNumber: z.number().nullable(),
  verification: z.string(),
});

const poolEntry = z.object({
  description: z.string(),
  poolId: hex32,
  hook: addr,
  fee: z.number(),
});

/** Shape of deployments/10143.json (written by scripts/build-deployments.mjs). */
export const deploymentsSchema = z.object({
  chainId: z.literal(10143),
  network: z.string(),
  generatedAt: z.string(),
  owner: addr,
  infra: z.object({
    poolManager: addr,
    v4Quoter: addr,
    stateView: addr,
    universalRouter: addr,
    positionManager: addr,
    permit2: addr,
    multicall3: addr,
    wrappedMon: addr,
  }),
  core: z.object({
    scoreboard: entry,
    firmRouter: entry,
    canaryRunner: entry,
    rawRouter: entry,
  }),
  fixtures: z
    .object({
      tUSD: entry,
      tUSDC: entry,
      liquidityHelper: entry,
      hookContext: entry,
      hookHonest: entry,
      hookRandomFee: entry,
      hookSenderAware: entry,
      hookGasGrief: entry,
      hookRevert: entry,
      hookQuoteOnly: entry,
    })
    .nullable(),
  pools: z
    .object({
      currency0: addr,
      currency1: addr,
      zeroForOne: z.boolean(),
      tickSpacing: z.number(),
      list: z.record(poolEntry),
    })
    .nullable(),
  startBlock: z.number().nullable(),
});

export type Deployments = z.infer<typeof deploymentsSchema>;

/** deployments/10143.json is the single source of truth for addresses. Override with FIRM_DEPLOYMENTS_PATH. */
export function deploymentsPath(): string {
  if (process.env.FIRM_DEPLOYMENTS_PATH) return process.env.FIRM_DEPLOYMENTS_PATH;
  // services/shared/src -> repo root
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "deployments", "10143.json");
}

export function loadDeployments(path = deploymentsPath()): Deployments {
  if (!existsSync(path)) {
    throw new Error(`deployments file not found at ${path}. Run contracts/script/Redeploy.sh (or set FIRM_DEPLOYMENTS_PATH).`);
  }
  return deploymentsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
