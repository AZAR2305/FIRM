import Link from "next/link";
import { EmptyState } from "@/components/States";

export default function NotFound() {
  return (
    <EmptyState title="Page not found">
      <Link href="/">Back to the start</Link>
    </EmptyState>
  );
}
