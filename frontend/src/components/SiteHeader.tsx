import Link from "next/link";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/pitch", label: "Pitch" },
  { href: "/demo", label: "Demo" },
  { href: "/swap", label: "Swap" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/proof", label: "Proof" },
  { href: "/integrate", label: "Integrate" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink no-underline" aria-label="FIRM home">
          <svg aria-hidden width="30" height="30" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill="#f4f4f5" />
            <path d="M9 8h14v4.5H14.2v3h7.6v4.3h-7.6V25H9z" fill="#08080a" />
            <circle cx="24.5" cy="23.5" r="3.2" fill="#3ecf8e" />
          </svg>
          FIRM
        </Link>
        <nav aria-label="Main" className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="mono rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-mute no-underline hover:bg-panel2 hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
