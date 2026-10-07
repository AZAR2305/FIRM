# FIRM - project instructions for Claude Code

## What this is
FIRM is a Uniswap v4 router for Monad that checks each pool's quote against its real fill
inside the same transaction, rejects and publicly strikes pools that break the quote, and
falls back to the next pool. A Scoreboard contract records hook honesty. A canary agent
probes new hooks with dust swaps. Hackathon: Monad Metropolis, Track 1 (one track only).
Network: Monad Testnet (chain 10143). The full spec is in docs/FIRM-spec.pdf (v1.1). Follow it.

## Rules
- Work in milestone order (spec section 16) and follow the 7-day plan (16.1). Do the spikes
  in M0 first. Log in docs/SPIKES.md. Cut P1/P2 before P0. Never cut M7 or M8.
- Never invent addresses, ABIs, event signatures. Use deployments/10143.json and the spec's
  verified addresses. Confirm [A] items by reading v4-core / v4-periphery.
- Testnet only. No secrets in git. Use .env (see .env.example) or the Foundry keystore.
- Deterministic contracts decide money and status. LLMs only write prose or drive demo agents.
- Misbehaving test hooks live ONLY in contracts/test-fixtures. Never deploy to mainnet,
  never register in any hook registry.
- Every contract and service ships with tests. Run before commit. Commit small and often.
- Keep README.md, DEPLOYMENTS.md, RESULTS.md, THREAT_MODEL.md, docs/SPIKES.md current.
- README MUST state that AI coding tools (Claude Code) were used (hackathon rule).
- Be honest in docs about limits; do not round benchmark numbers in our favour.
- Do not replace the V4 Quoter with a self-simulation through FirmRouter (spec 4.2).

## Commands
- contracts: cd contracts && forge build && forge test -vvv
- deploy: cd contracts && ./script/Redeploy.sh
- backend: cd backend && pnpm install && pnpm -r build && pnpm -r test
- envio (run under WSL, it does not run on native Windows): cd envio && npm install && npx envio codegen
- benchmark: cd backend && pnpm bench

## Key facts
- Foundry v1.8.0 pinned by spec (local is 1.7.1), Solidity 0.8.26, EVM cancun. Gas on Monad is charged on the gas limit.
- Testnet Uniswap v4 is Monad-maintained, not official.
  PoolManager 0x451D64ab3b650040d2aE1886602b97ed6eDc643d
  V4Quoter    0x869834d127b230283fe63E0d0A9bEB67216a94C7
- Envio HyperSync for testnet: https://monad-testnet.hypersync.xyz
- Deadline: 13 Oct 2026, 11:59 PM ET. Submit by 12 Oct.
