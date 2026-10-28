import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harmoni",
  description: "Self-hosted, multi-provider music server",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
