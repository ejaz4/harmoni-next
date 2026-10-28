import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Harmoni",
    short_name: "Harmoni",
    description: "Your music, from everywhere, in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#121212",
    theme_color: "#121212",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Search", url: "/search", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Liked Songs", url: "/liked", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
