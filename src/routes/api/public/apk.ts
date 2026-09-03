/**
 * APK download endpoint with correct Android headers.
 *
 * The raw CDN asset is served with a generic binary content-type, which makes
 * Chrome save the APK as a ".zip" (an APK is a zip archive internally), so
 * users can't tap-to-install it. This route streams the same bytes with the
 * official Android MIME type and an attachment filename so the browser treats
 * it as an installable package.
 *
 *   GET /api/public/apk
 */
import { createFileRoute } from "@tanstack/react-router";

const APK_SOURCE_URL =
  "https://txc.mypinata.cloud/ipfs/bafybeiavh4ws3ap2dh3xlt5my5rsl7ji4j43estaxexmifxud4fll3llcy?filename=hme-wallet-0.1.202609032314-release.apk";
const APK_FILENAME = "hme-wallet-0.1.202609032314-release.apk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Max-Age": "86400",
} as const;

export const Route = createFileRoute("/api/public/apk")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      HEAD: async () =>
        new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.android.package-archive",
            "Content-Disposition": `attachment; filename="${APK_FILENAME}"`,
            ...corsHeaders,
          },
        }),

      GET: async () => {
        const upstream = await fetch(APK_SOURCE_URL, { cache: "no-store" });
        if (!upstream.ok || !upstream.body) {
          return new Response(JSON.stringify({ error: "download unavailable" }), {
            status: 502,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", "application/vnd.android.package-archive");
        headers.set("Content-Disposition", `attachment; filename="${APK_FILENAME}"`);
        const len = upstream.headers.get("content-length");
        if (len) headers.set("Content-Length", len);
        headers.set("Cache-Control", "public, max-age=3600");

        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
