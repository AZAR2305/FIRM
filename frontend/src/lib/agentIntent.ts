import { isAddress } from "viem";

/**
 * The agent page turns a chat message into a swap order. A language model may PROPOSE the order (it reads free text well), but this file decides
 * whether it is acceptable: the amount and the recipient must literally appear in the user's message, the tokens come from a fixed list, and
 * the size is capped. Nothing here moves funds: the user's own wallet signs the swap on the Swap screen.
 */
export type TokenSymbol = "tUSD" | "tUSDC";

export interface SwapIntent {
  amount: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  /** null = the user's own wallet */
  recipient: string | null;
}

export type IntentResult =
  | { ok: true; intent: SwapIntent }
  | { ok: false; reason: string };

export const MAX_AMOUNT = 100_000;
export const MAX_MESSAGE = 300;

const norm = (s: string) => s.replace(/,/g, "").toLowerCase();

/** "1k" and "2.5k" are common in chat. Returns a plain decimal string, or null. */
function expandAmount(raw: string): string | null {
  const m = /^(\d+(?:\.\d+)?)(k)?$/i.exec(raw.replace(/,/g, ""));
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  if (!Number.isFinite(n)) return null;
  return String(Number(n.toFixed(6)));
}

/** Accepts a proposed order only if the message really contains what it says. */
export function validateIntent(message: string, proposed: { amount?: unknown; tokenIn?: unknown; recipient?: unknown }): IntentResult {
  const text = message.slice(0, MAX_MESSAGE);
  const amount = typeof proposed.amount === "string" || typeof proposed.amount === "number" ? String(proposed.amount).replace(/,/g, "") : "";
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount)) return { ok: false, reason: "I could not find a clear amount in your message." };
  const value = Number(amount);
  if (!(value > 0)) return { ok: false, reason: "The amount must be above zero." };
  if (value > MAX_AMOUNT) return { ok: false, reason: `Please ask for at most ${MAX_AMOUNT.toLocaleString("en-US")} tokens: the demo pools are small.` };

  // the number must be in the message, as written ("250", "1,000", "1k" for 1000)
  const mentioned = [...norm(text).matchAll(/\d+(?:\.\d+)?k?/g)].map((m) => expandAmount(m[0]));
  if (!mentioned.some((a) => a != null && Number(a) === value)) return { ok: false, reason: "The amount I understood is not in your message, so I will not use it." };

  const tokenIn = proposed.tokenIn === "tUSD" || proposed.tokenIn === "tUSDC" ? proposed.tokenIn : null;
  if (!tokenIn) return { ok: false, reason: "Only tUSD and tUSDC exist here. Say which one you want to sell." };
  const tokenOut: TokenSymbol = tokenIn === "tUSD" ? "tUSDC" : "tUSD";

  let recipient: string | null = null;
  if (proposed.recipient != null && proposed.recipient !== "") {
    const r = String(proposed.recipient);
    if (!isAddress(r) || !text.toLowerCase().includes(r.toLowerCase())) return { ok: false, reason: "The recipient address is not one that appears in your message." };
    recipient = r;
  } else if (/\b(to|for)\s+(him|her|them|someone|my friend|a friend)\b/i.test(text) || /\bsend (it|them|the)\b/i.test(text)) {
    // asked to send it somewhere, but gave no address: ask, do not guess
    if (!/0x[0-9a-fA-F]{40}/.test(text)) return { ok: false, reason: "Who should receive it? Paste their 0x wallet address in your message." };
  }
  return { ok: true, intent: { amount: String(value), tokenIn, tokenOut, recipient } };
}

/** The same extraction with plain rules, used when no model is configured or the model fails. It is stricter, not smarter. */
export function parseIntentWithRules(message: string): IntentResult {
  const text = message.slice(0, MAX_MESSAGE);
  const amountMatch = /(\d[\d,]*(?:\.\d+)?\s?k?)\s*(tusdc|tusd)\b/i.exec(text) ?? /\b(swap|sell|trade|exchange|convert)\s+(\d[\d,]*(?:\.\d+)?\s?k?)\b/i.exec(text);
  if (!amountMatch) return { ok: false, reason: "Try: \"Swap 250 tUSD to tUSDC\"." };
  const rawAmount = (amountMatch.length === 3 && /^(tusdc|tusd)$/i.test(amountMatch[2] ?? "") ? amountMatch[1] : amountMatch[2])!.replace(/\s/g, "");
  const amount = expandAmount(rawAmount);
  const lower = text.toLowerCase();
  const first = [...lower.matchAll(/tusdc|tusd/g)][0]?.[0];
  const tokenIn = /(\d[\d,.]*\s?k?)\s*tusdc\b/.test(lower) ? "tUSDC" : /(\d[\d,.]*\s?k?)\s*tusd\b/.test(lower) ? "tUSD" : first === "tusdc" ? "tUSDC" : first === "tusd" ? "tUSD" : null;
  const address = /0x[0-9a-fA-F]{40}/.exec(text)?.[0] ?? null;
  return validateIntent(message, { amount, tokenIn, recipient: address });
}
