/**
 * Same-origin proxy for Nectar.Pay invoice endpoints.
 *
 * Why proxy instead of calling nectar-pay.com directly from the client:
 *  - One place to change the upstream host (staging vs prod).
 *  - Avoid any CORS surprises from a third party.
 *  - Lets us add request logging / rate limiting later without touching the UI.
 *
 * Only GET and POST are supported, matching the spec. The `?t=<nonce>` query
 * is forwarded verbatim. The body for POST is passed through as-is.
 */
import { createFileRoute } from "@tanstack/react-router";

const UPSTREAM = "https://nectar-pay.com";

function buildUpstreamUrl(invoiceId: string, search: string): string {
  const safeId = encodeURIComponent(invoiceId);
  // Forward the entire query string (carries `t=<nonce>`).
  const qs = search && search !== "?" ? search : "";
  return `${UPSTREAM}/api/public/v1/pay/${safeId}${qs}`;
}

async function forward(req: Request, invoiceId: string, init: RequestInit): Promise<Response> {
  const url = new URL(req.url);
  const upstream = buildUpstreamUrl(invoiceId, url.search);
  const res = await fetch(upstream, init);
  // Re-emit the response with a permissive content-type passthrough.
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/nectar/pay/$invoiceId")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        forward(request, params.invoiceId, {
          method: "GET",
          headers: { Accept: "application/json" },
        }),
      POST: async ({ request, params }) => {
        const body = await request.text();
        return forward(request, params.invoiceId, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body,
        });
      },
    },
  },
});
