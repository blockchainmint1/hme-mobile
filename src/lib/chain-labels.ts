/**
 * Per-chain wallet tile labels. TXC uses the mnemonic-wallet label
 * (managed by wallet-context); every other chain uses this store so
 * renaming one tile doesn't rename them all.
 */
import { useEffect, useState } from "react";
import type { ChainId } from "./chain-prefs";

const STORAGE_KEY = "hme.chain-labels.v1";
export const CHAIN_LABEL_EVENT = "hme:chain-label-changed";

export const CHAIN_LABEL_DEFAULTS: Partial<Record<ChainId, string>> = {
  isk: "Iskander Coin",
};

function read(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getChainLabel(chain: ChainId): string {
  const all = read();
  return (all[chain] ?? CHAIN_LABEL_DEFAULTS[chain] ?? chain.toUpperCase()).toString();
}

export function setChainLabel(chain: ChainId, label: string): void {
  const all = read();
  const clean = (label ?? "").trim();
  if (!clean) delete all[chain];
  else all[chain] = clean.slice(0, 40);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(CHAIN_LABEL_EVENT));
  } catch {
    /* ignore */
  }
}

export function useChainLabel(chain: ChainId): [string, (v: string) => void] {
  const [label, set] = useState<string>(() => getChainLabel(chain));
  useEffect(() => {
    const h = () => set(getChainLabel(chain));
    window.addEventListener(CHAIN_LABEL_EVENT, h);
    return () => window.removeEventListener(CHAIN_LABEL_EVENT, h);
  }, [chain]);
  return [label, (v: string) => setChainLabel(chain, v)];
}
