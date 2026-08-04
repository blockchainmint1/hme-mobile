/**
 * Local labels for Tron transactions we originated in-app (e.g. bridge
 * approval vs. bridge deposit), so history can explain why a single user
 * action produced more than one on-chain transaction.
 */

const KEY = "hme.tron.txlabels.v1";
const MAX = 200;

export type TronTxLabel = "bridge-approval" | "bridge-deposit" | "swap-approval";

export const TRON_TX_LABEL_TEXT: Record<TronTxLabel, string> = {
  "bridge-approval": "Bridge approval",
  "bridge-deposit": "Bridge deposit",
  "swap-approval": "Swap approval",
};

type Store = Record<string, TronTxLabel>;

const listeners = new Set<() => void>();
let cache: Store | null = null;

function read(): Store {
  if (cache) return cache;
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function getTronTxLabel(txid: string): TronTxLabel | null {
  return read()[txid.toLowerCase()] ?? null;
}

export function setTronTxLabel(txid: string, label: TronTxLabel) {
  if (typeof window === "undefined") return;
  const next: Store = { ...read(), [txid.toLowerCase()]: label };
  const keys = Object.keys(next);
  if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete next[k];
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / disabled — labels are cosmetic */
  }
  for (const l of listeners) l();
}

export function subscribeTronTxLabels(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
