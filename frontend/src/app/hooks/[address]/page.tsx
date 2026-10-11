import { HookDetail } from "@/components/HookDetail";
import { deployments } from "@/lib/deployments";

export const metadata = { title: "Hook | FIRM" };

// pre-render the hooks of the seeded pools; any other address is rendered on demand and says it is not tracked
export function generateStaticParams() {
  return deployments ? Object.values(deployments.pools.list).filter((p) => p.hook !== "0x0000000000000000000000000000000000000000").map((p) => ({ address: p.hook })) : [];
}

export default async function HookPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <HookDetail address={address} />;
}
