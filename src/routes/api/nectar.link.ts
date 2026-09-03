/**
 * Same-origin proxy for the Nectar Pay wallet-link protocol.
 *
 * The wallet never talks to app.nectar-pay.com directly: the strict CSP
 * `connect-src` only allows same-origin + our own chain endpoints, and this
 * keeps one place to pin the trusted relying party.
 *
 * Usage: /api/nectar/link?url=<url-encoded absolute https URL on the
 * trusted host>. GET reads the manifest, POST claims it.
 */
import { createFileRoute } from "@tanstack/react-router";

/** The ONLY host the wallet will exchange xpubs with. */
const TRUSTED_HOST = "app.nectar-pay.com";

function targetFrom(request: Request): URL | null {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return null;
  try {
    const target = new URL(raw);
    if (target.protocol !== "https:") return null;
    if (target.hostname !== TRUSTED_HOST) return null;
    return target;
  } catch {
    return null;
  }
}

async function forward(request: Request, init: RequestInit): Promise<Response> {
  const target = targetFrom(request);
  if (!target) {
    return new Response(JSON.stringify({ error: "untrusted_url" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const res = await fetch(target.toString(), init);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/nectar/link")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        forward(request, { method: "GET", headers: { Accept: "application/json" } }),
      POST: async ({ request }) => {
        const body = await request.text();
        return forward(request, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body,
        });
      },
    },
  },
});
