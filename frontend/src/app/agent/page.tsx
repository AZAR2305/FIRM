import { AgentChat } from "@/components/AgentChat";

export const metadata = { title: "Agent | FIRM", description: "Tell the FIRM agent what to swap. It reads your message, checks every pool, and prepares a protected swap for your wallet to sign." };

export default function AgentPage() {
  return (
    <div className="space-y-12">
      <div className="page-head">
        <h1 className="page-title">Swap by message</h1>
        <p className="page-lead">
          Write what you want, in plain words. The agent reads it, quotes every pool through FIRM and prepares the swap. An AI agent that trades for a user is exactly the case where a
          faked quote costs the most, and the agent&apos;s only swap path here is FIRM.
        </p>
      </div>
      <AgentChat />
    </div>
  );
}
