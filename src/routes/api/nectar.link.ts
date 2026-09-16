/**
 * Same-origin proxy for the wallet-link and website sign-in protocols.
 *
 * The wallet never talks to other hosts directly: the strict CSP `connect-src`
 * only allows same-origin + our own chain endpoints, so this route forwards the
 * two sign-in calls (read the challenge, post the signature).
 *
 * Any public HTTPS host is allowed — sign-in is open by design — so this MUST
 * NOT become a general-purpose open relay. Guards below: public DNS names only
 * (no IP literals, localhost, .internal/.local), https + default port, GET/POST
 * only, no cookies or inbound auth headers forwarded, no redirect following,
 * size cap on both directions, and a fixed timeout.
 *
 * Usage: /api/nectar/link?url=<url-encoded absolute https URL>.
 */
import { createFileRoute } from "@tanstack/react-router";
import { isPublicHostname } from "@/lib/web-login-hosts";

const MAX_BODY_BYTES = 32 * 1024;
const TIMEOUT_MS = 10_000;

function targetFrom(request: Request): URL | null {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw || raw.length > 2048) return null;
  try {
    const target = new URL(raw);
    if (target.protocol !== "https:") return null;
    if (target.port || target.username || target.password) return null;
    if (!isPublicHostname(target.hostname)) return null;
    return target;
  } catch {
    return null;
  }
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function forward(request: Request, method: "GET" | "POST", body?: string): Promise<Response> {
  const target = targetFrom(request);
  if (!target) return jsonError("untrusted_url", 400);
  if (body !== undefined && body.length > MAX_BODY_BYTES) return jsonError("payload_too_large", 413);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      method,
      // Only these headers are forwarded — never cookies, Authorization, or
      // anything else from the incoming request.
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) return jsonError("redirect_not_allowed", 502);
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return jsonError("response_too_large", 502);
    const contentType = res.headers.get("content-type") ?? "application/json";
    if (!/^application\/(json|[a-z.+-]*\+json)/i.test(contentType)) {
      return jsonError("unexpected_response_type", 502);
    }
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return jsonError("upstream_unreachable", 504);
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute("/api/nectar/link")({
  server: {
    handlers: {
      GET: async ({ request }) => forward(request, "GET"),
      POST: async ({ request }) => {
        const body = await request.text();
        return forward(request, "POST", body);
      },
    },
  },
});
