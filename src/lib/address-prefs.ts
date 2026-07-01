/**
 * User preferences and per-account state for TXC receive-address rotation.
 *
 * "Multi-address" for TXC = deriving a new external address (m/.../0/i)
 * for each incoming payment while balances/history aggregate across every
 * used index. This module owns the policy toggle and the per-account
 * displayed-index bookkeeping. Aggregation itself already lives in
 * `src/lib/txc/scan.ts` (gap-limit scan).
 *
 * Storage:
 *   - `hme.rotation-policy`               → RotationPolicy (global)
 *   - `hme.display-index.<accountId>.<kind>` → number (per account + address kind)
 *
 * `accountId` is a short prefix of the neutered BIP32 xpub — deterministic
 * per seed, contains no private material, safe for localStorage.
 */

export type RotationPolicy = "manual" | "on-load" | "on-receive" | "never";

const POLICY_KEY = "hme.rotation-policy";
const DEFAULT_POLICY: RotationPolicy = "on-receive";

export function getRotationPolicy(): RotationPolicy {
  if (typeof window === "undefined") return DEFAULT_POLICY;
  const v = window.localStorage.getItem(POLICY_KEY);
  if (v === "manual" || v === "on-load" || v === "on-receive" || v === "never") return v;
  return DEFAULT_POLICY;
}

export function setRotationPolicy(p: RotationPolicy): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POLICY_KEY, p);
}

function indexKey(accountId: string, kind: string): string {
  return `hme.display-index.${accountId}.${kind}`;
}

export function getDisplayIndex(accountId: string, kind: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(indexKey(accountId, kind));
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setDisplayIndex(accountId: string, kind: string, i: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(indexKey(accountId, kind), String(Math.max(0, i | 0)));
}

/**
 * Given the current stored displayIndex and the wallet's firstUnusedIndex
 * (from a gap-limit scan), return the index to actually show.
 *
 * - never:      always 0
 * - on-load:    always firstUnusedIndex (advance every visit)
 * - on-receive: advance only when the current index has been used
 * - manual:     stick at displayIndex regardless of on-chain activity
 */
export function resolveDisplayIndex(
  policy: RotationPolicy,
  displayIndex: number,
  firstUnusedIndex: number,
): number {
  switch (policy) {
    case "never":
      return 0;
    case "on-load":
      return firstUnusedIndex;
    case "on-receive":
      return Math.max(displayIndex, firstUnusedIndex);
    case "manual":
      return displayIndex;
  }
}

export const ROTATION_POLICY_LABELS: Record<RotationPolicy, { title: string; description: string }> = {
  "on-receive": {
    title: "After each payment",
    description: "Show a fresh address only once the current one receives funds. Best privacy without surprises.",
  },
  "on-load": {
    title: "Every time I open Receive",
    description: "Maximum privacy — a new address every visit. Standard Bitcoin wallet behavior.",
  },
  manual: {
    title: "Only when I tap 'New address'",
    description: "The address stays the same until you ask for a new one.",
  },
  never: {
    title: "Never rotate",
    description: "Always show the first address. Familiar, but reduces on-chain privacy.",
  },
};
