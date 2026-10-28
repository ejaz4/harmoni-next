import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Dev server runs on a headless box and is opened from the LAN.
  allowedDevOrigins: ["192.168.0.182"],
  serverExternalPackages: ["youtubei.js"],
};

export default nextConfig;
