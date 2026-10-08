/** Scoreboard.Status, by enum index. Colour is never the only signal: every status also has its text label (spec 12.6). */
export const STATUS_NAMES = ["UNRATED", "NORMAL", "WATCH", "BLOCKED"] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

export function statusName(i: number | bigint): StatusName {
  return STATUS_NAMES[Number(i)] ?? "UNRATED";
}

/** BLOCKED first, then WATCH, UNRATED, NORMAL (spec 12.2: "sorted by status then strikes") */
export const STATUS_ORDER: Record<StatusName, number> = { BLOCKED: 0, WATCH: 1, UNRATED: 2, NORMAL: 3 };

export const STATUS_HELP: Record<StatusName, string> = {
  BLOCKED: "Struck hard or repeatedly: routers skip this hook.",
  WATCH: "Recently struck: allowed with a stricter tolerance.",
  UNRATED: "Not enough evidence yet: allowed only for small trades.",
  NORMAL: "Rated clean: quotes have matched fills.",
};

/** Router skip reasons, FirmRouter.LegSkipped(reason). */
export const SKIP_REASONS: Record<number, string> = {
  0: "BLOCKED",
  1: "UNRATED_CAP",
  2: "QUOTE_FAILED",
  3: "BELOW_MIN_OUT",
  4: "ADVERTISED_MISMATCH",
};
