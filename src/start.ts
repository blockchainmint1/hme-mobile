import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { SECURITY_HEADERS } from "./lib/security/headers";

const IS_PROD = process.env.NODE_ENV === "production";

/** Best-effort: attach security headers to a Headers object, in place. */
function setSecurityHeaders(headers: Headers): void {
  if (!IS_PROD) return; // avoid breaking Vite HMR / dev tooling
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  } catch {
    /* immutable headers on some runtimes — leave the response untouched */
  }
}

const securityMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    const result = await next();
    setSecurityHeaders(result.response.headers);
    return result;
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    const res = new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    setSecurityHeaders(res.headers);
    return res;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityMiddleware],
}));
