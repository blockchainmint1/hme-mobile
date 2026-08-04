/**
 * Minimal client for the mempool.texitcoin.org REST API.
 * Assumes the mempool.space-compatible endpoint shape used by the public instance.
 */
import { cleanUpstreamBody } from "@/lib/broadcast-error";
import { MEMPOOL_API, MEMPOOL_BASE } from "./network";

export interface MempoolAddressStats {
  address: string;
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}

export interface MempoolTx {
  txid: string;
  version: number;
  size: number;
  weight: number;
  fee: number;
  vin: {
    txid: string;
    vout: number;
    prevout: { scriptpubkey: string; scriptpubkey_address?: string; value: number };
  }[];
  vout: { scriptpubkey: string; scriptpubkey_address?: string; value: number }[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export interface MempoolUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MEMPOOL_API}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mempool ${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function getText(path: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_API}${path}`);
  if (!res.ok) throw new Error(`mempool ${path}: ${res.status} ${res.statusText}`);
  return res.text();
}

export function getAddressStats(address: string): Promise<MempoolAddressStats> {
  return getJson<MempoolAddressStats>(`/address/${address}`);
}

export function getAddressTxs(address: string): Promise<MempoolTx[]> {
  return getJson<MempoolTx[]>(`/address/${address}/txs`);
}

export function getAddressUtxos(address: string): Promise<MempoolUtxo[]> {
  return getJson<MempoolUtxo[]>(`/address/${address}/utxo`);
}

export function getTxHex(txid: string): Promise<string> {
  return getText(`/tx/${txid}/hex`);
}

/**
 * Raw transaction hex is immutable once a txid exists, so it never needs to be
 * re-fetched. Legacy (bip44) inputs require the full previous transaction to
 * sign, and on a busy T… wallet that was one HTTP round trip per UTXO on every
 * single refresh. Cache it in memory + localStorage.
 */
const TXHEX_PREFIX = "hme.txhex.";
const TXHEX_MAX_BYTES = 40_000; // don't persist giant consolidation txs
const txHexMemo = new Map<string, string>();

export async function getTxHexCached(txid: string): Promise<string> {
  const memo = txHexMemo.get(txid);
  if (memo) return memo;
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(TXHEX_PREFIX + txid);
      if (stored) {
        txHexMemo.set(txid, stored);
        return stored;
      }
    } catch {
      // storage disabled — fall through to network
    }
  }
  const hex = await getTxHex(txid);
  txHexMemo.set(txid, hex);
  if (typeof localStorage !== "undefined" && hex.length <= TXHEX_MAX_BYTES) {
    try {
      localStorage.setItem(TXHEX_PREFIX + txid, hex);
    } catch {
      // quota — memory cache still helps for this session
    }
  }
  return hex;
}

export interface Outspend {
  spent: boolean;
  txid?: string;
  vin?: number;
  status?: { confirmed: boolean; block_height?: number };
}

/** Is this specific output still unspent (including by anything in the mempool)? */
export function getOutspend(txid: string, vout: number): Promise<Outspend> {
  return getJson<Outspend>(`/tx/${txid}/outspend/${vout}`);
}

export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
}

export function getFeeEstimates(): Promise<FeeEstimates> {
  return getJson<FeeEstimates>("/v1/fees/recommended");
}

export async function broadcastTx(hex: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_API}/tx`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: hex,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`broadcast failed: ${res.status} ${cleanUpstreamBody(body)}`);
  return body.trim();
}

export function explorerTxUrl(txid: string): string {
  return `${MEMPOOL_BASE}/tx/${txid}`;
}

export function explorerAddressUrl(address: string): string {
  return `${MEMPOOL_BASE}/address/${address}`;
}
