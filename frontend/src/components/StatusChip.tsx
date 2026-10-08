import { STATUS_HELP, type StatusName } from "@/lib/status";

const STYLE: Record<StatusName, { box: string; dot: string }> = {
  BLOCKED: { box: "border-bad/60 bg-bad/10 text-bad", dot: "bg-bad" },
  WATCH: { box: "border-warn/60 bg-warn/10 text-warn", dot: "bg-warn" },
  UNRATED: { box: "border-idle/50 bg-idle/10 text-idle", dot: "bg-idle" },
  NORMAL: { box: "border-ok/60 bg-ok/10 text-ok", dot: "bg-ok" },
};

/** Status as text AND colour (spec 12.6: colour is never the only signal). */
export function StatusChip({ status }: { status: StatusName }) {
  const s = STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wide ${s.box}`}
      title={STATUS_HELP[status]}
      data-status={status}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}
