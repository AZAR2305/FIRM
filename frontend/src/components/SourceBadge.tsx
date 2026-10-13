import type { Board } from "@/hooks/useBoard";

/** Says where the numbers came from. Envio is a bounty requirement and a claim, so the page proves it on screen instead of asserting it. */
export function SourceBadge({ board }: { board: Board }) {
  const envio = board.source === "envio";
  const behind = envio && board.indexedBlock != null && board.headBlock != null ? Math.max(0, board.headBlock - board.indexedBlock) : null;
  return (
    <div
      className={`card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs ${envio ? "border-ok/50" : "border-warn/50"}`}
      data-testid="source-badge"
      data-source={board.source}
    >
      <strong className={envio ? "text-ok" : "text-warn"}>{envio ? "Data source: Envio HyperIndex" : "Data source: direct Scoreboard read (Envio not used)"}</strong>
      <span className="text-mute">{board.note}</span>
      {envio && board.indexedBlock == null ? (
        <span className="text-mute" data-testid="no-lag">this endpoint does not report how far behind the chain it is, answered in {board.ms} ms</span>
      ) : null}
      {envio && board.indexedBlock != null ? (
        <span className="mono text-mute" data-testid="indexed-block">
          indexed to block {board.indexedBlock.toLocaleString("en-US")}
          {behind != null ? `, ${behind} behind the chain` : ""}, answered in {board.ms} ms
        </span>
      ) : null}
    </div>
  );
}
