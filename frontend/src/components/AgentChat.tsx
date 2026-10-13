"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { MAX_MESSAGE, type SwapIntent } from "@/lib/agentIntent";
import { deployments } from "@/lib/deployments";
import { fmt, parseAmount, shortAddress } from "@/lib/format";
import { useRoutePlan } from "@/hooks/useChainData";
import { NotDeployed } from "./States";
import { RouteTable } from "./RouteTable";

type Parser = { kind: "llm"; model: string } | { kind: "rules"; note?: string };
type ApiAnswer = ({ ok: true; intent: SwapIntent } | { ok: false; reason: string }) & { parser: Parser; error?: string };

interface Turn {
  id: number;
  user: string;
  answer?: ApiAnswer;
  failure?: string;
}

const EXAMPLES = [
  "Swap 250 tUSD to tUSDC",
  "Sell 1,500 tUSDC for tUSD",
  "Swap 100 tUSD to tUSDC and send it to 0x000000000000000000000000000000000000dEaD",
];

export function AgentChat() {
  if (!deployments) return <NotDeployed />;
  return <Chat />;
}

function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const next = useRef(1);
  const end = useRef<HTMLDivElement>(null);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    const id = next.current++;
    setTurns((t) => [...t, { id, user: trimmed }]);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: trimmed }) });
      const json = (await res.json()) as ApiAnswer;
      setTurns((t) => t.map((x) => (x.id === id ? (res.ok ? { ...x, answer: json } : { ...x, failure: json.error ?? `The agent answered HTTP ${res.status}.` }) : x)));
    } catch {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, failure: "Could not reach the agent. Check your connection." } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-5" aria-live="polite" data-testid="agent-thread">
        {turns.length === 0 ? (
          <div className="card space-y-4 p-7">
            <p className="font-semibold">Tell the agent what to swap.</p>
            <p className="copy">
              It reads your message, checks every pool through FIRM, and prepares the swap. You sign it in your own wallet: the agent never holds your keys or your funds.
            </p>
            <ul className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <li key={e}>
                  <button type="button" className="pill cursor-pointer text-left hover:border-ink" onClick={() => void send(e)}>
                    {e.length > 60 ? `${e.slice(0, 57)}...` : e}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {turns.map((t) => (
          <div key={t.id} className="space-y-3">
            <p className="ml-auto w-fit max-w-[85%] break-words rounded-2xl rounded-br-sm border border-line bg-panel2 px-4 py-2.5 text-sm [overflow-wrap:anywhere]">{t.user}</p>
            <div className="card space-y-4 p-6" data-testid="agent-reply">
              {t.failure ? <p className="text-sm text-bad">{t.failure}</p> : null}
              {!t.answer && !t.failure ? <p className="text-sm text-mute">Reading your message and checking the pools...</p> : null}
              {t.answer && !t.answer.ok ? <p className="text-sm">{t.answer.reason}</p> : null}
              {t.answer?.ok ? <Plan intent={t.answer.intent} /> : null}
              {t.answer ? (
                <p className="mono text-[0.7rem] uppercase tracking-wider text-mute" data-testid="agent-parser">
                  {t.answer.parser.kind === "llm" ? `Message read by ${t.answer.parser.model}, then checked by fixed rules` : "Message read by plain rules (no model)"}
                  {t.answer.parser.kind === "rules" && t.answer.parser.note ? ` · ${t.answer.parser.note}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <form onSubmit={onSubmit} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center" aria-label="Message the agent">
        <label htmlFor="agent-input" className="sr-only">Your message</label>
        <input
          id="agent-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_MESSAGE}
          placeholder="Swap 250 tUSD to tUSDC and send it to 0x..."
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-4 py-3 text-sm outline-none focus:border-ink"
          autoComplete="off"
          data-testid="agent-input"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()} data-testid="agent-send">
          {busy ? "Reading..." : "Send"}
        </button>
      </form>
    </div>
  );
}

/** What FIRM will do for this order, read from the chain now: the pools it will try, in order, and what each quotes. */
function Plan({ intent }: { intent: SwapIntent }) {
  const d = deployments!;
  const amountIn = parseAmount(intent.amount);
  const zeroForOne = intent.tokenIn === "tUSD" ? d.pools.zeroForOne : !d.pools.zeroForOne;
  const plan = useRoutePlan(zeroForOne, amountIn);
  const best = plan.data?.routes[0];
  const qs = new URLSearchParams({ amount: intent.amount, from: intent.tokenIn });
  if (intent.recipient) qs.set("to", intent.recipient);

  return (
    <div className="space-y-4" data-testid="agent-plan">
      <p className="text-sm leading-relaxed">
        <strong>Understood:</strong> swap <span className="mono">{Number(intent.amount).toLocaleString("en-US")} {intent.tokenIn}</span> for {intent.tokenOut}
        {intent.recipient ? <> and send the {intent.tokenOut} to <span className="mono">{shortAddress(intent.recipient as `0x${string}`)}</span></> : <>, paid to your wallet</>}.
      </p>
      {plan.isLoading ? <p className="text-sm text-mute">Quoting every pool on Monad Testnet...</p> : null}
      {plan.error ? <p className="text-sm text-bad">Could not read the pools right now. Try again in a moment.</p> : null}
      {plan.data && best ? (
        <>
          <p className="copy">
            FIRM will try {plan.data.routes.length} pool{plan.data.routes.length === 1 ? "" : "s"} in this order, quoting each one inside the transaction. The highest quote right now is{" "}
            <strong className="text-ink">{fmt(best.quotedOut, 2)} {intent.tokenOut}</strong>. A quote can be wrong, which is why each one is checked: if a pool delivers less than it quoted, that leg is undone, the hook is struck, and the next pool is tried.
            {plan.data.skipped.length > 0 ? ` ${plan.data.skipped.length} pool${plan.data.skipped.length === 1 ? " is" : "s are"} skipped (see the table).` : ""}
          </p>
          <RouteTable plan={plan.data} symbolOut={intent.tokenOut} />
        </>
      ) : null}
      {plan.data && !best ? <p className="text-sm text-warn">No pool can fill this size right now. Try a smaller amount.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/swap?${qs.toString()}`} className="btn btn-primary no-underline" data-testid="agent-open-swap">Review and sign in your wallet</Link>
        <span className="text-xs text-mute">You approve and confirm on the Swap screen. Nothing is sent until you sign.</span>
      </div>
    </div>
  );
}
