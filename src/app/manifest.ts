import type { MetadataRoute } from "next";

/**
 * Web App Manifest — rende l'app installabile sulla home del telefono (PWA).
 * Next.js lo serve automaticamente su /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finanza Personale",
    short_name: "Finanza",
    description:
      "Il tuo budget e i tuoi investimenti, sempre sotto controllo.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6f9fc",
    theme_color: "#0a2540",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
