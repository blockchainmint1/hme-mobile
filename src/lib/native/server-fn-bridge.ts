/**
 * In the native Capacitor app the WebView serves the bundled web assets from
 * the configured hostname (mobile.honest.money). Any relative fetch — including
 * TanStack Start's `/_serverFn/*` RPCs and `/api/*` server routes — is
 * intercepted by Capacitor's local web server and 404s because those endpoints
 * only exist on the deployed origin.
 *
 * Patch window.fetch once at startup to forward those requests to the real
 * production origin so prices, history, and other server functions work
 * inside the APK/IPA.
 */
import { isNative } from "./platform";

const PROD_ORIGIN = "https://hme-mobile.lovable.app";
const FORWARD_PREFIXES = ["/_serverFn/", "/api/"];

let patched = false;

export function installNativeServerFnBridge() {
  if (patched || typeof window === "undefined") return;
  if (!isNative()) return;
  patched = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      let url: string | null = null;
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.toString();
      else if (input instanceof Request) url = input.url;

      if (url) {
        // Handle absolute URLs pointing at the local webview origin as well as
        // plain relative paths ("/_serverFn/...").
        let path: string | null = null;
        if (url.startsWith("/")) {
          path = url;
        } else {
          try {
            const parsed = new URL(url, window.location.href);
            if (parsed.origin === window.location.origin) path = parsed.pathname + parsed.search;
          } catch {
            /* ignore */
          }
        }

        if (path && FORWARD_PREFIXES.some((p) => path!.startsWith(p))) {
          const forwarded = PROD_ORIGIN + path;
          if (input instanceof Request) {
            return originalFetch(new Request(forwarded, input));
          }
          return originalFetch(forwarded, init);
        }
      }
    } catch {
      /* fall through to original fetch */
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
}
