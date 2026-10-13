import type { Metadata } from "next";
import { PitchDeck } from "@/components/PitchDeck";

export const metadata: Metadata = {
  title: "Pitch | FIRM",
  description: "FIRM in six slides: the problem, the fix, the proof on Monad Testnet, and the limits.",
};

export default function PitchPage() {
  return <PitchDeck />;
}
