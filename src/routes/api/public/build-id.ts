/**
 * Build freshness probe.
 *
 * Returns the BUILD_ID of the *currently deployed* bundle. The app compares it
 * against its own baked-in __BUILD_ID__ to detect a stale cached webview/tab —
 * far more reliable than scraping index.html for hashed script URLs.
 */
import { createFileRoute } from "@tanstack/react-router";

declare const __BUILD_ID__: string;

export const Route = createFileRoute("/api/public/build-id")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      GET: async () =>
        new Response(
          JSON.stringify({
            buildId: typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate",
              "Access-Control-Allow-Origin": "*",
            },
          },
        ),
    },
  },
});
