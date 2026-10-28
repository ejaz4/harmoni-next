import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harmoni",
  description: "Self-hosted, multi-provider music server",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions add attributes to <html>; don't warn about those.
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
