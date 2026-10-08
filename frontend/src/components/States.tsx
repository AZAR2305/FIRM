import type { ReactNode } from "react";
import { notDeployedReason } from "@/lib/deployments";

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <div role="status" aria-live="polite" className="card flex items-center gap-3 p-4 text-sm text-mute">
      <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-brand" />
      {what}...
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-mute">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", error, onRetry }: { title?: string; error?: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : error ? String(error) : "";
  return (
    <div role="alert" className="card border-bad/50 p-4">
      <p className="font-semibold text-bad">{title}</p>
      {msg ? <p className="mt-1 break-words text-sm text-mute">{msg.split("\n")[0]}</p> : null}
      {onRetry ? (
        <button type="button" className="btn mt-3" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Shown on every data page while deployments/10143.json does not exist. */
export function NotDeployed() {
  return (
    <EmptyState title="FIRM is not deployed to Monad Testnet yet">
      <p>
        This app reads every address and ABI from <code className="mono">deployments/10143.json</code>, which does not exist until
        the contracts are deployed (<code className="mono">contracts/script/Redeploy.sh</code>).
      </p>
      <p className="mt-2 mono text-xs">{notDeployedReason}</p>
    </EmptyState>
  );
}
