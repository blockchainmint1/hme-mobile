/**
 * Chain preferences: which chains from the single HD seed to show tiles for.
 * Stored in localStorage so it persists across sessions on-device.
 */
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";

export type ChainId = "txc" | EvmChainId | "isk" | "zcu";

export interface ChainMeta {
  id: ChainId;
  name: string;
  shortName: string;
  /** Not yet launched — toggle stays disabled/off. */
  soon?: boolean;
  /** Hex accent used by the tile gradient. */
  accent: string;
}

export const CHAIN_META: Record<ChainId, ChainMeta> = {
  txc: { id: "txc", name: "TEXITcoin", shortName: "TXC", accent: "#B45309" },
  eth: {
    id: "eth",
    name: "Ethereum",
    shortName: EVM_CHAINS.eth.shortName,
    accent: EVM_CHAINS.eth.accent,
  },
  base: {
    id: "base",
    name: "Base",
    shortName: EVM_CHAINS.base.shortName,
    accent: EVM_CHAINS.base.accent,
  },
  bsc: {
    id: "bsc",
    name: "Binance Chain",
    shortName: EVM_CHAINS.bsc.shortName,
    accent: EVM_CHAINS.bsc.accent,
  },
  isk: { id: "isk", name: "IskanderCoin", shortName: "ISK", soon: true, accent: "#22C55E" },
  zcu: { id: "zcu", name: "Zero Chill Units", shortName: "ZCU", soon: true, accent: "#0EA5E9" },
};

export const CHAIN_ORDER: ChainId[] = ["txc", "eth", "base", "bsc", "isk", "zcu"];

const STORAGE_KEY = "hme.chains.enabled.v1";
const DEFAULT_ENABLED: Record<ChainId, boolean> = {
  txc: true,
  eth: false,
  base: false,
  bsc: false,
  isk: false,
  zcu: false,
};

function read(): Record<ChainId, boolean> {
  if (typeof localStorage === "undefined") return { ...DEFAULT_ENABLED };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ENABLED };
    const parsed = JSON.parse(raw) as Partial<Record<ChainId, boolean>>;
    const out = { ...DEFAULT_ENABLED };
    for (const k of CHAIN_ORDER) if (typeof parsed[k] === "boolean") out[k] = parsed[k]!;
    // "soon" chains can never be enabled.
    for (const k of CHAIN_ORDER) if (CHAIN_META[k].soon) out[k] = false;
    // TXC is always on.
    out.txc = true;
    return out;
  } catch {
    return { ...DEFAULT_ENABLED };
  }
}

export function getChainPrefs(): Record<ChainId, boolean> {
  return read();
}

export function getEnabledChains(): ChainId[] {
  const prefs = read();
  return CHAIN_ORDER.filter((c) => prefs[c]);
}

export function setChainEnabled(id: ChainId, enabled: boolean): void {
  if (CHAIN_META[id].soon) return;
  if (id === "txc") return; // TXC is always on
  const prefs = read();
  prefs[id] = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent("hme:chains-changed"));
  } catch {
    /* ignore */
  }
}
