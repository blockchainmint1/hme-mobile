/**
 * APK download endpoint with correct Android headers.
 *
 *   GET /api/public/apk
 *
 * Why this proxies instead of redirecting:
 *
 * The pinned CDN asset is served as `application/zip` (an APK *is* a zip), with
 * no `Accept-Ranges`. Chrome therefore saves it as a ".zip" that can't be
 * tapped to install, and Android's download manager — with no length it trusts
 * and no resume support — can sit at "99%" forever.
 *
 * So we stream the same bytes ourselves and copy upstream's `Content-Length`
 * verbatim, while overriding the type/filename to the official Android package
 * MIME type. A known length plus a matching byte count is exactly what the
 * download manager needs to flip to "complete" and offer Install.
 */
import { createFileRoute } from "@tanstack/react-router";

const APK_SOURCE_URL =
  "https://txc.mypinata.cloud/ipfs/QmY1PWEwEL8c1dzfuQWUXUQDcDyyuHRfDDSe2xuwDpP8jy?filename=hme-wallet-0.1.202609191118-release.apk&download=true";
const APK_FILENAME = "hme-wallet-0.1.202609191118-release.apk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length, Content-Disposition, Accept-Ranges",
  "Access-Control-Max-Age": "86400",
} as const;

function downloadHeaders(length: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": `attachment; filename="${APK_FILENAME}"`,
    // No transformation/ranging surprises between us and the phone.
    "Cache-Control": "public, max-age=300",
    "Accept-Ranges": "none",
    ...corsHeaders,
  };
  if (length) h["Content-Length"] = length;
  return h;
}

/** Ask the CDN for the byte length without pulling the body. */
async function upstreamLength(): Promise<string | null> {
  try {
    const res = await fetch(APK_SOURCE_URL, { method: "HEAD" });
    return res.headers.get("content-length");
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/apk")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      HEAD: async () =>
        new Response(null, { status: 200, headers: downloadHeaders(await upstreamLength()) }),

      GET: async () => {
        const upstream = await fetch(APK_SOURCE_URL, {
          // Identity encoding keeps upstream's Content-Length byte-accurate.
          headers: { "Accept-Encoding": "identity" },
        });
        if (!upstream.ok || !upstream.body) {
          return new Response("Download unavailable", { status: 502, headers: corsHeaders });
        }
        return new Response(upstream.body, {
          status: 200,
          headers: downloadHeaders(upstream.headers.get("content-length")),
        });
      },
    },
  },
});
