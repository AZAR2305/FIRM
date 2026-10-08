import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { monadTestnet, RPC_URL } from "./config";

/**
 * Spec 12.1: Monad Testnet as a custom chain. Browser wallets only (EIP-1193 `injected`); WalletConnect is deliberately not
 * used, so no project id is needed and nothing is sent to a third party.
 */
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: { [monadTestnet.id]: http(RPC_URL, { batch: true, retryCount: 2 }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
