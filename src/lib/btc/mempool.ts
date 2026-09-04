/**
 * mempool.space REST client. Same Esplora / mempool.space shape as the
 * TXC and ISK clients — kept API-compatible so scan.ts and route code reuse
 * the same query patterns.
 */
import { cleanUpstreamBody } from "@/lib/broadcast-error";
import { BTC_MEMPOOL_API, BTC_MEMPOOL_BASE } from "./network";

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
    prevout: { scriptpubkey: string; scriptpubkey_address?: string; value: number } | null;
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
  const res = await fetch(`${BTC_MEMPOOL_API}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`btc-mempool ${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function getText(path: string): Promise<string> {
  const res = await fetch(`${BTC_MEMPOOL_API}${path}`);
  if (!res.ok) throw new Error(`btc-mempool ${path}: ${res.status} ${res.statusText}`);
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

/**
 * Bitcoin's relay minimum is 1 sat/vB. mempool.space's estimator is reliable;
 * we only guard against zero/garbage values and fall back to a modest tier.
 */
const BTC_MIN_RELAY_SAT_VB = 1;

export async function getFeeEstimates(): Promise<FeeEstimates> {
  const floor = (v: number | undefined, fallback: number) =>
    Math.max(BTC_MIN_RELAY_SAT_VB, Math.ceil(Number(v) || fallback));
  try {
    const raw = await getJson<FeeEstimates>("/v1/fees/recommended");
    return {
      fastestFee: floor(raw.fastestFee, 10),
      halfHourFee: floor(raw.halfHourFee, 6),
      hourFee: floor(raw.hourFee, 3),
      minimumFee: floor(raw.minimumFee, 1),
    };
  } catch {
    return { fastestFee: 10, halfHourFee: 6, hourFee: 3, minimumFee: 1 };
  }
}


export async function broadcastTx(hex: string): Promise<string> {
  const res = await fetch(`${BTC_MEMPOOL_API}/tx`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: hex,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`btc broadcast failed: ${res.status} ${cleanUpstreamBody(body)}`);
  return body.trim();
}

export function explorerTxUrl(txid: string): string {
  return `${BTC_MEMPOOL_BASE}/tx/${txid}`;
}

export function explorerAddressUrl(address: string): string {
  return `${BTC_MEMPOOL_BASE}/address/${address}`;
}
