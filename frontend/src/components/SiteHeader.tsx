import Link from "next/link";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/swap", label: "Swap" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/proof", label: "Proof" },
  { href: "/integrate", label: "Developers" },
  { href: "/pitch", label: "Pitch" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3 sm:flex-nowrap sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink no-underline" aria-label="FIRM home">
          <svg aria-hidden width="30" height="30" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill="#f4f4f5" />
            <path d="M9 8h14v4.5H14.2v3h7.6v4.3h-7.6V25H9z" fill="#08080a" />
            <circle cx="24.5" cy="23.5" r="3.2" fill="#3ecf8e" />
          </svg>
          FIRM
        </Link>
        <nav aria-label="Main" className="-mx-1 order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="mono shrink-0 rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-mute no-underline hover:bg-panel2 hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="shrink-0">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
