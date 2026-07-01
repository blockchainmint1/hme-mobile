import type { BIP32Interface } from "bip32";

/**
 * Browser-safe root fingerprint formatter.
 *
 * `Buffer.from(...).toString("hex")` works in some dev/browser bundles but can
 * be missing in Capacitor's iOS WebView, which crashes the wallet route during
 * session restore. Keep this tiny and Web-standard only.
 */
export function rootFingerprintHex(root: BIP32Interface): string {
  const bytes = root.fingerprint;
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}