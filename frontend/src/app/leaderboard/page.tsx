import { LeaderboardTable } from "@/components/LeaderboardTable";
import { StatusChip } from "@/components/StatusChip";
import { STATUS_NAMES, STATUS_HELP } from "@/lib/status";

export const metadata = { title: "Leaderboard | FIRM" };

export default function LeaderboardPage() {
  return (
    <div className="space-y-12">
      <div className="page-head">
        <h1 className="page-title">Hook leaderboard</h1>
        <p className="page-lead">
          Every hook the protected router and the canary have measured. A strike is recorded when a pool&apos;s real fill falls short of its own quote,
          and anyone can read it on-chain. The hooks listed here are our own test fixtures.
        </p>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-mute" aria-label="Status legend">
        {[...STATUS_NAMES].reverse().map((s) => (
          <li key={s} className="flex items-center gap-2">
            <StatusChip status={s} />
            <span>{STATUS_HELP[s]}</span>
          </li>
        ))}
      </ul>
      <LeaderboardTable />
    </div>
  );
}
