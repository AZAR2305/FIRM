import { JudgeFlow } from "@/components/JudgeFlow";

export const metadata = { title: "Demo: the judge walkthrough | FIRM" };

export default function DemoPage() {
  return (
    <div className="space-y-12">
      <div className="page-head">
        <h1 className="page-title">Guided walkthrough: the problem, then the fix</h1>
        <p className="page-lead">
          Seven steps, about three minutes, in the order that makes the point. Everything runs on Monad Testnet with test tokens. The cheating pools are our own test fixtures:
          nothing here is mocked, and nothing claims to catch third-party hooks.
        </p>
      </div>
      <JudgeFlow />
    </div>
  );
}
