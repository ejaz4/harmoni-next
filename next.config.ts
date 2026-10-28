import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Dev server runs on a headless box and is opened from the LAN.
  allowedDevOrigins: ["192.168.0.182"],
  // kuromoji loads its dictionary files from its own package directory at runtime.
  serverExternalPackages: ["youtubei.js", "kuroshiro", "kuroshiro-analyzer-kuromoji"],
};

export default nextConfig;
