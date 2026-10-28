import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { ServiceWorker } from "@/components/shell/service-worker";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Harmoni", template: "%s · Harmoni" },
  description: "Your music, from everywhere, in one place.",
  applicationName: "Harmoni",
  // Installed to the home screen on iOS: full screen, content under the status bar.
  appleWebApp: { capable: true, title: "Harmoni", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#121212",
  // Draw edge to edge; the shell pads itself with the safe-area insets.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions add attributes to <html>; don't warn about those.
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
