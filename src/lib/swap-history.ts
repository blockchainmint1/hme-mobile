/**
 * Locally-recorded LTC/DOGE → stablecoin swaps.
 *
 * Once a swap is broadcast, everything needed to keep tracking it is public
 * data (deposit txid, provider order id, FixedFloat order token). We keep
 * that in localStorage so the user can leave the swap screen, lock the
 * wallet, or close the app entirely and still come back to watch progress —
 * the provider keeps working regardless.
 *
 * No key material is stored here.
 */
import { useEffect, useState } from "react";
import type { StableDestination, UtxoSwapCoin } from "@/lib/thorchain/assets";
import type { SwapProviderId } from "@/lib/swap-providers/types";

export interface SavedSwap {
  /** Deposit transaction id — unique per swap. */
  txid: string;
  coin: UtxoSwapCoin;
  provider: SwapProviderId;
  /** Provider order id (SideShift / FixedFloat). */
  orderId: string | null;
  /** FixedFloat order token, needed to poll status. */
  token: string | null;
  /** Sats sent to the deposit address. */
  amountSats: number;
  /** Expected payout in destination units. */
  amountOut: number;
  dest: StableDestination;
  /** Wallet address receiving the payout. */
  destination: string;
  createdAt: number;
  /** Set once the payout has been sent on the destination chain. */
  done: boolean;
  /** Set if the provider reports the order failed/refunded. */
  failed: boolean;
  /** Payout txid on the destination chain, once known. */
  outboundTxid: string | null;
}

const KEY = "hme.swap-history.v1";
const EVENT = "hme:swap-history";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;

function readAll(): SavedSwap[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SavedSwap[];
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list.filter((s) => s && s.txid && now - s.createdAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeAll(list: SavedSwap[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function recordSwap(
  swap: Omit<SavedSwap, "createdAt" | "done" | "failed" | "outboundTxid">,
): void {
  const entry: SavedSwap = {
    ...swap,
    createdAt: Date.now(),
    done: false,
    failed: false,
    outboundTxid: null,
  };
  writeAll([entry, ...readAll().filter((s) => s.txid !== swap.txid)]);
}

export function updateSwap(txid: string, patch: Partial<SavedSwap>): void {
  writeAll(readAll().map((s) => (s.txid === txid ? { ...s, ...patch } : s)));
}

export function removeSwap(txid: string): void {
  writeAll(readAll().filter((s) => s.txid !== txid));
}

/** All locally recorded swaps, newest first. Re-renders on any change. */
export function useSwapHistory(): SavedSwap[] {
  const [swaps, setSwaps] = useState<SavedSwap[]>([]);
  useEffect(() => {
    const sync = () => setSwaps(readAll());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return swaps;
}
