import type { Candidate, RoutePlan, RouteRow } from "./routes";
import { MAX_LEGS } from "./routes";
import { floorOf } from "./format";

/**
 * Demo presets. The "villains" are OUR OWN test fixtures (contracts/test-fixtures), deliberately misbehaving hooks, named by the pool letter
 * the seeding script gives them (deployments/10143.json pools.list). They exist so a judge can see the router catch a cheat live, more than
 * once: after the first strike a hook is BLOCKED for everybody, so there are three different cheats to try. Not real third-party hooks.
 */
export const DEMO_VILLAINS: Record<string, { cheat: string; how: string }> = {
  B: { cheat: "Hidden fee", how: "Quotes the best price, then takes about 18% of the output when it really executes. The router sees delivered < quoted and rejects it." },
  G: { cheat: "Burns all gas", how: "Quotes fine, then burns all the gas it is given. The router caps the gas of each leg, so the swap survives; the hook is struck." },
  R: { cheat: "Reverts", how: "Quotes fine, then reverts on the real path. The router isolates the failure, nothing is lost, and it tries the next pool." },
};

/**
 * "As if a naive aggregator ranked this pool first": the protected route with `villain` moved to the front. Only the ORDER is forced; the router
 * still re-quotes and re-checks everything on-chain. Returns null if the villain cannot be quoted. A villain that is already BLOCKED is
 * still placed first, so the timeline shows the router skipping it (LegSkipped), which is exactly what protects the next user.
 */
export function routeWithVillain(plan: RoutePlan, candidates: Candidate[], villain: string): RouteRow[] | null {
  const c = candidates.find((x) => x.name === villain);
  if (!c || c.quotedOut == null || c.quotedOut === 0n) return null;
  const row: RouteRow = {
    name: c.name,
    description: c.description,
    poolId: c.poolId,
    key: c.key,
    hook: c.key.hooks,
    status: c.status,
    quotedOut: c.quotedOut,
    floor: floorOf(c.quotedOut, c.toleranceBps),
    toleranceBps: c.toleranceBps,
  };
  const rest = plan.routes.filter((r) => r.name !== villain);
  return [row, ...rest].slice(0, MAX_LEGS);
}

/** Which demo villains can still be caught live (not yet BLOCKED), in the order the guide recommends. */
export function freshVillains(candidates: Candidate[]): string[] {
  return Object.keys(DEMO_VILLAINS).filter((n) => {
    const c = candidates.find((x) => x.name === n);
    return c && c.status !== "BLOCKED" && c.quotedOut != null;
  });
}
