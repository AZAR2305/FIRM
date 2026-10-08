import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { TestnetBanner } from "@/components/TestnetBanner";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "FIRM: quotes that keep their word",
  description: "A Uniswap v4 router for Monad that checks each pool's quote against its real fill in the same transaction.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <TestnetBanner />
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-mute">
            Testnet demo. The misbehaving hooks shown here are our own test fixtures; this site does not claim to catch any real
            third-party hook. Built with AI coding tools (Claude Code).
          </footer>
        </Providers>
      </body>
    </html>
  );
}
