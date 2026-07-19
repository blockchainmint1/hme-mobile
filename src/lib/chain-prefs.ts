/**
 * Chain preferences: which chains from the single HD seed to show tiles for.
 * Stored in localStorage so it persists across sessions on-device.
 */
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";

export type ChainId = "txc" | EvmChainId | "isk" | "ltc" | "doge" | "zcu";

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
  isk: { id: "isk", name: "IskanderCoin", shortName: "ISK", accent: "#22C55E" },
  ltc: { id: "ltc", name: "Litecoin", shortName: "LTC", accent: "#345D9D" },
  doge: { id: "doge", name: "Dogecoin", shortName: "DOGE", accent: "#C2A633" },
  zcu: { id: "zcu", name: "Zero Chill Units", shortName: "ZCU", soon: true, accent: "#0EA5E9" },
};

export const CHAIN_ORDER: ChainId[] = ["txc", "eth", "base", "bsc", "isk", "ltc", "doge", "zcu"];

const ORDER_KEY = "hme.chains.order.v1";

function readOrder(): ChainId[] {
  if (typeof localStorage === "undefined") return [...CHAIN_ORDER];
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...CHAIN_ORDER];
    const parsed = JSON.parse(raw) as string[];
    const seen = new Set<ChainId>();
    const out: ChainId[] = [];
    for (const id of parsed) {
      if ((CHAIN_ORDER as string[]).includes(id) && !seen.has(id as ChainId)) {
        out.push(id as ChainId);
        seen.add(id as ChainId);
      }
    }
    // Append any chains missing from the saved order (new chains added later).
    for (const id of CHAIN_ORDER) if (!seen.has(id)) out.push(id);
    return out;
  } catch {
    return [...CHAIN_ORDER];
  }
}

export function getChainOrder(): ChainId[] {
  return readOrder();
}

export function setChainOrder(order: ChainId[]): void {
  // Normalize: keep only valid ids, dedupe, append missing.
  const seen = new Set<ChainId>();
  const normalized: ChainId[] = [];
  for (const id of order) {
    if ((CHAIN_ORDER as string[]).includes(id) && !seen.has(id)) {
      normalized.push(id);
      seen.add(id);
    }
  }
  for (const id of CHAIN_ORDER) if (!seen.has(id)) normalized.push(id);
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("hme:chains-changed"));
  } catch {
    /* ignore */
  }
}

const STORAGE_KEY = "hme.chains.enabled.v1";
const DEFAULT_ENABLED: Record<ChainId, boolean> = {
  txc: true,
  eth: false,
  base: false,
  bsc: false,
  isk: false,
  ltc: false,
  doge: false,
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
  return readOrder().filter((c) => prefs[c]);
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
