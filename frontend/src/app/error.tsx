"use client";

import { ErrorState } from "@/components/States";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="This page failed to load" error={error} onRetry={reset} />;
}
