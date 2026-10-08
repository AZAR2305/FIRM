import { Suspense } from "react";
import { SwapPanel } from "@/components/SwapPanel";
import { Loading } from "@/components/States";

export const metadata = { title: "Swap: protected vs raw | FIRM" };

export default function SwapPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Swap</h1>
        <p className="mt-1 max-w-3xl text-sm text-mute">
          The same trade through the protected router and through an unprotected comparator. The protected one compares every pool&apos;s quote
          with its real fill inside the transaction and falls back when a hook breaks its word.
        </p>
      </div>
      <Suspense fallback={<Loading what="Loading the swap screen" />}>
        <SwapPanel />
      </Suspense>
    </div>
  );
}
