import type { TimelineStep } from "@/lib/timeline";

const ICON: Record<TimelineStep["kind"], { glyph: string; tone: string; label: string }> = {
  skipped: { glyph: "-", tone: "border-idle/60 text-idle", label: "Skipped" },
  rejected: { glyph: "x", tone: "border-bad/70 text-bad", label: "Rejected" },
  filled: { glyph: "+", tone: "border-ok/70 text-ok", label: "Filled" },
  nofill: { glyph: "!", tone: "border-warn/70 text-warn", label: "No fill" },
  raw: { glyph: "?", tone: "border-bad/70 text-bad", label: "Raw swap" },
};

/** Spec 12.4: one line per router event, in log order. Text AND an icon label, never colour alone. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-mute">The transaction emitted no FIRM events.</p>;
  }
  return (
    <ol className="space-y-2" aria-label="Swap timeline" data-testid="timeline">
      {steps.map((s, i) => {
        const ic = ICON[s.kind];
        return (
          <li key={i} className="flex items-start gap-3" data-kind={s.kind}>
            <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-bold ${ic.tone}`}>
              {ic.glyph}
            </span>
            <span className="text-sm">
              <span className={`mr-2 text-xs font-bold uppercase tracking-wide ${ic.tone.split(" ")[1]}`}>{ic.label}</span>
              {s.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
