/**
 * Chain adapter for watch-only wallets.
 *
 * Watch-only entries are a single public address on a UTXO chain. Every chain
 * we support here exposes an Esplora-compatible client (getAddressStats /
 * getAddressTxs / explorer URLs) plus its own unit formatters, so one lookup
 * table keeps the wallet home screen chain-agnostic.
 */
import * as txc from "@/lib/txc/mempool";
import * as isk from "@/lib/isk/mempool";
import * as btc from "@/lib/btc/mempool";
import * as ltc from "@/lib/ltc/mempool";
import * as doge from "@/lib/doge/mempool";
import { satsToTxc, formatTxc, formatTxcCompact } from "@/lib/txc/units";
import { satsToIsk, formatIsk, formatIskCompact } from "@/lib/isk/units";
import { satsToBtc, formatBtc, formatBtcCompact } from "@/lib/btc/units";
import { satsToLtc, formatLtc, formatLtcCompact } from "@/lib/ltc/units";
import { satsToDoge, formatDoge, formatDogeCompact } from "@/lib/doge/units";

/** Chains a watch-only address can be tracked on. */
export const WATCH_CHAINS = ["txc", "isk", "btc", "ltc", "doge"] as const;
export type WatchChain = (typeof WATCH_CHAINS)[number];

export function isWatchChain(v: unknown): v is WatchChain {
  return typeof v === "string" && (WATCH_CHAINS as readonly string[]).includes(v);
}

interface WatchChainMeta {
  ticker: string;
  label: string;
  /** Placeholder shown in the address field. */
  placeholder: string;
  toCoin: (sats: number | bigint) => number;
  format: (sats: number | bigint) => string;
  formatCompact: (sats: number | bigint) => string;
  api: typeof txc | typeof isk | typeof btc | typeof ltc | typeof doge;
}

export const WATCH_CHAIN_META: Record<WatchChain, WatchChainMeta> = {
  txc: {
    ticker: "TXC",
    label: "TEXITcoin (TXC)",
    placeholder: "txc1... or T...",
    toCoin: satsToTxc,
    format: (s) => formatTxc(s),
    formatCompact: formatTxcCompact,
    api: txc,
  },
  isk: {
    ticker: "ISK",
    label: "IskanderCoin (ISK)",
    placeholder: "is1... or i...",
    toCoin: satsToIsk,
    format: (s) => formatIsk(s),
    formatCompact: formatIskCompact,
    api: isk,
  },
  btc: {
    ticker: "BTC",
    label: "Bitcoin (BTC)",
    placeholder: "bc1... or 1.../3...",
    toCoin: satsToBtc,
    format: (s) => formatBtc(s),
    formatCompact: formatBtcCompact,
    api: btc,
  },
  ltc: {
    ticker: "LTC",
    label: "Litecoin (LTC)",
    placeholder: "ltc1... or L.../M...",
    toCoin: satsToLtc,
    format: (s) => formatLtc(s),
    formatCompact: formatLtcCompact,
    api: ltc,
  },
  doge: {
    ticker: "DOGE",
    label: "Dogecoin (DOGE)",
    placeholder: "D...",
    toCoin: satsToDoge,
    format: (s) => formatDoge(s),
    formatCompact: formatDogeCompact,
    api: doge,
  },
};

export function watchApi(chain: WatchChain) {
  return WATCH_CHAIN_META[chain].api;
}
