import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Harmoni", template: "%s · Harmoni" },
  description: "Your music, from everywhere, in one place.",
};

export const viewport: Viewport = { themeColor: "#121212" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions add attributes to <html>; don't warn about those.
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
