import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { TestnetBanner } from "@/components/TestnetBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

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
          <main className="mx-auto w-full max-w-6xl px-4 py-10">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
