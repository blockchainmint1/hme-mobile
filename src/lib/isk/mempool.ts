/**
 * Minimal client for mempool.iskandercoin.com — Esplora / mempool.space shape.
 * Kept API-compatible with src/lib/txc/mempool.ts so the ISK routes can reuse
 * the same query patterns.
 */
import { ISK_MEMPOOL_API, ISK_MEMPOOL_BASE } from "./network";

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
  const res = await fetch(`${ISK_MEMPOOL_API}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`isk-mempool ${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function getText(path: string): Promise<string> {
  const res = await fetch(`${ISK_MEMPOOL_API}${path}`);
  if (!res.ok) throw new Error(`isk-mempool ${path}: ${res.status} ${res.statusText}`);
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

export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
}

export async function getFeeEstimates(): Promise<FeeEstimates> {
  try {
    return await getJson<FeeEstimates>("/v1/fees/recommended");
  } catch {
    // Some Esplora instances don't expose v1/fees/recommended — use a
    // conservative default so the send flow still works.
    return { fastestFee: 5, halfHourFee: 3, hourFee: 2, minimumFee: 1 };
  }
}

export async function broadcastTx(hex: string): Promise<string> {
  const res = await fetch(`${ISK_MEMPOOL_API}/tx`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: hex,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`isk broadcast failed: ${res.status} ${body}`);
  return body.trim();
}

export function explorerTxUrl(txid: string): string {
  return `${ISK_MEMPOOL_BASE}/tx/${txid}`;
}

export function explorerAddressUrl(address: string): string {
  return `${ISK_MEMPOOL_BASE}/address/${address}`;
}
