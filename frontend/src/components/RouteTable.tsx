import type { RoutePlan } from "@/lib/routes";
import { fmt, shortAddress } from "@/lib/format";
import { AddressLink } from "./TxLink";
import { StatusChip } from "./StatusChip";

const SKIP_TEXT: Record<string, string> = {
  BLOCKED: "BLOCKED on the Scoreboard: not tried",
  UNRATED_CAP: "UNRATED and the trade is above its cap: not tried",
  QUOTE_FAILED: "could not be quoted",
  NOT_IN_TOP_LEGS: "outside the best 4: not tried",
};

/** Route preview (spec 12.2): quote, floor, hook badge and status for each pool, in the order FirmRouter will try them. */
export function RouteTable({ plan, symbolOut }: { plan: RoutePlan; symbolOut: string }) {
  return (
    <div className="table-wrap">
      <table className="t" data-testid="route-table">
        <caption className="sr-only">Candidate pools in the order the protected router will try them</caption>
        <thead>
          <tr>
            <th scope="col">Try</th>
            <th scope="col">Pool</th>
            <th scope="col">Hook</th>
            <th scope="col">Status</th>
            <th scope="col" className="text-right">
              Quote ({symbolOut})
            </th>
            <th scope="col" className="text-right">
              Floor
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.routes.map((r, i) => (
            <tr key={r.poolId}>
              <td className="mono">#{i + 1}</td>
              <td>
                <strong>Pool {r.name}</strong>
                <div className="text-xs text-mute">{r.description}</div>
              </td>
              <td>{r.hook === "0x0000000000000000000000000000000000000000" ? <span className="text-mute">none</span> : <AddressLink address={r.hook} />}</td>
              <td>
                <StatusChip status={r.status} />
              </td>
              <td className="mono text-right">{fmt(r.quotedOut, 2)}</td>
              <td className="mono text-right" title={`Quote minus the ${r.toleranceBps} bps tolerance of a ${r.status} hook`}>
                {fmt(r.floor, 2)}
              </td>
            </tr>
          ))}
          {plan.skipped.map((s) => (
            <tr key={s.poolId} className="text-mute">
              <td className="mono">-</td>
              <td>
                <strong>Pool {s.name}</strong>
                <div className="text-xs">{s.description}</div>
              </td>
              <td>{s.hook === "0x0000000000000000000000000000000000000000" ? "none" : shortAddress(s.hook)}</td>
              <td colSpan={3} className="text-xs">
                {SKIP_TEXT[s.reason]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
