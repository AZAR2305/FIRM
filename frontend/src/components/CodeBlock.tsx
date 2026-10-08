"use client";

import { useState } from "react";

/** A code sample with a copy button. */
export function CodeBlock({ code, language, label }: { code: string; language: string; label: string }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  }
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-mute">
        <span>
          {label} <span className="mono">({language})</span>
        </span>
        <button type="button" className="btn !px-2 !py-0.5 !text-xs" onClick={copy} aria-label={`Copy ${label}`}>
          {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre className="mono overflow-x-auto p-4 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
