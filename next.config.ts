import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Self-contained server for the Docker image (node .next/standalone/server.js).
  output: "standalone",
  // Dev server runs on a headless box and is opened from the LAN.
  allowedDevOrigins: ["192.168.0.182", "127.0.0.1", "localhost"],
  // kuromoji loads its dictionary files from its own package directory at runtime.
  serverExternalPackages: ["youtubei.js", "kuroshiro", "kuroshiro-analyzer-kuromoji"],
  // ...which file tracing can't see, so ship them explicitly.
  outputFileTracingIncludes: { "/**": ["./node_modules/kuromoji/dict/**"] },
};

export default nextConfig;
