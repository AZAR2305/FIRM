import { defineChain } from "viem";

// None of these is a contract address: contract addresses and ABIs come only from deployments/10143.json (see deployments.ts).

/** Spec 12.1. Override with NEXT_PUBLIC_RPC_URL to point the app at a local fork. */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL = "https://testnet.monadvision.com";
export const FAUCET_URL = "https://faucet.monad.xyz";
/** Optional: quote-api for server-side route previews. The app computes the same preview itself, so it works without it. */
export const QUOTE_API_URL = process.env.NEXT_PUBLIC_QUOTE_API_URL || "";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "MonadVision", url: EXPLORER_URL } },
  testnet: true,
});

/** How often the leaderboard and the route preview refresh. */
export const REFRESH_MS = 4_000;

/**
 * Explicit gas limits (Monad charges the gas LIMIT, spec 12.3). FORK-MEASURED, NOT MONAD-MEASURED: used only as the fallback when
 * eth_estimateGas is unavailable, and as the mint limit (about 34k used on a fork, x2 margin).
 */
export const GAS = {
  mint: 100_000n,
  approve: 100_000n,
  /** estimate + this percent, because the limit is what is charged */
  estimateBufferPct: 20n,
} as const;
