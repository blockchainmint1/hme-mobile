type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
  }
}

// A seed phrase, WIF, private key, or password must NEVER be forwarded to a
// third-party telemetry sink. Error messages/stacks can incidentally contain
// user input, so we scrub anything that looks like secret material and cap
// string length before the payload leaves the device.
const SECRET_PATTERNS: RegExp[] = [
  // 12-24 lowercase words in a row (BIP39 mnemonic).
  /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi,
  // WIF (base58, TXC/ISK prefixes) and long base58 blobs.
  /\b[5KLc9ADPatT][1-9A-HJ-NP-Za-km-z]{50,51}\b/g,
  // xprv / hex private keys / long hex.
  /\bxprv[0-9A-Za-z]+\b/g,
  /\b[0-9a-fA-F]{64,}\b/g,
];

function scrubString(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out.length > 2000 ? out.slice(0, 2000) + "…[truncated]" : out;
}

function scrubValue(v: unknown): unknown {
  if (typeof v === "string") return scrubString(v);
  if (v instanceof Error) {
    const e = new Error(scrubString(v.message));
    e.name = v.name;
    if (v.stack) e.stack = scrubString(v.stack);
    return e;
  }
  return v;
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  // Allowlist context keys and scrub their values; never spread arbitrary
  // context straight into third-party telemetry.
  const safeContext: Record<string, unknown> = {
    source: "react_error_boundary",
    route: window.location.pathname,
  };
  for (const key of ["boundary", "mechanism", "component"]) {
    if (key in context) safeContext[key] = scrubValue(context[key]);
  }
  window.__lovableEvents?.captureException?.(scrubValue(error), safeContext, {
    mechanism: "react_error_boundary",
    handled: false,
    severity: "error",
  });
}
