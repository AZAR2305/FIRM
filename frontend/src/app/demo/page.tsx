import { JudgeFlow } from "@/components/JudgeFlow";

export const metadata = { title: "Demo: the judge walkthrough | FIRM" };

export default function DemoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Demo: see the problem, then the fix</h1>
        <p className="mt-1 max-w-3xl text-sm text-mute">
          Seven steps, about three minutes, in the order that makes the point. Everything runs on Monad Testnet with test tokens. The cheating pools are our own test fixtures:
          nothing here is mocked, and nothing claims to catch third-party hooks.
        </p>
      </div>
      <JudgeFlow />
    </div>
  );
}
