/**
 * Watch-only wallets.
 *
 * These hold no keys — we only track a public address (or in future, an xpub)
 * so people with Cold Storage Coins, paper wallets, or offline signers can see
 * balance & history in the app without ever exposing their seed.
 *
 * v1: single TXC address per entry. xpub / EVM support can extend the union.
 * Persisted in localStorage keyed by a random UUID so entries survive rename.
 * Nothing here is sensitive — addresses are public.
 */

export type WatchChain = "txc";

export interface WatchWallet {
  id: string;
  label: string;
  chain: WatchChain;
  address: string;
  createdAt: number;
}

const STORAGE_KEY = "hme.watch-only.v1";
const EVENT = "hme:watch-changed";

function safeParse(raw: string | null): WatchWallet[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is WatchWallet =>
        !!w && typeof w.id === "string" && typeof w.address === "string" && w.chain === "txc",
    );
  } catch {
    return [];
  }
}

export function listWatchWallets(): WatchWallet[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

function persist(list: WatchWallet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function addWatchWallet(input: { label: string; chain: WatchChain; address: string }): WatchWallet {
  const list = listWatchWallets();
  // Dedupe on address per chain — silently return the existing entry if it's
  // already tracked so users don't end up with two identical tiles.
  const existing = list.find((w) => w.chain === input.chain && w.address === input.address);
  if (existing) return existing;
  const entry: WatchWallet = {
    id: newId(),
    label: input.label.trim() || "Watch-only",
    chain: input.chain,
    address: input.address,
    createdAt: Date.now(),
  };
  persist([...list, entry]);
  return entry;
}

export function renameWatchWallet(id: string, label: string): void {
  const list = listWatchWallets().map((w) => (w.id === id ? { ...w, label: label.trim() || w.label } : w));
  persist(list);
}

export function removeWatchWallet(id: string): void {
  persist(listWatchWallets().filter((w) => w.id !== id));
}

export function watchChangedEvent(): string {
  return EVENT;
}
