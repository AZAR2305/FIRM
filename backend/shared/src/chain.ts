import { defineChain } from "viem";

/** Monad Testnet (spec 5.1). Gas is charged on the gas LIMIT, so always set explicit gas limits. */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** Public RPCs from spec 5.1, with a conservative requests-per-second budget each (below the documented limits). */
export const DEFAULT_RPCS: { url: string; rps: number }[] = [
  { url: "https://testnet-rpc.monad.xyz", rps: 20 }, // QuickNode: 50 rps, 25 for eth_call
  { url: "https://rpc.ankr.com/monad_testnet", rps: 25 }, // 300 req / 10 s
  { url: "https://rpc-testnet.monadinfra.com", rps: 15 }, // 20 rps, batch not allowed
];
