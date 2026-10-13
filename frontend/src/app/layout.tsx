import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { TestnetBanner } from "@/components/TestnetBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const sora = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-sora", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "FIRM: quotes that keep their word",
  description: "A Uniswap v4 router for Monad that checks each pool's quote against its real fill in the same transaction.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${plexMono.variable}`}>
      <body>
        <Providers>
          <TestnetBanner />
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl px-4 py-10">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
