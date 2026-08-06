/**
 * litecoinspace.org REST client. Same Esplora / mempool.space shape as the
 * TXC and ISK clients — kept API-compatible so scan.ts and route code reuse
 * the same query patterns.
 */
import { cleanUpstreamBody } from "@/lib/broadcast-error";
import { LTC_MEMPOOL_API, LTC_MEMPOOL_BASE } from "./network";

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
  const res = await fetch(`${LTC_MEMPOOL_API}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ltc-mempool ${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function getText(path: string): Promise<string> {
  const res = await fetch(`${LTC_MEMPOOL_API}${path}`);
  if (!res.ok) throw new Error(`ltc-mempool ${path}: ${res.status} ${res.statusText}`);
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
 * Litecoin Core's default minrelaytxfee is 0.001 LTC/kB = 100 sat/vB, but the
 * Esplora estimator often reports 1-5 sat/vB, which nodes reject with
 * "min relay fee not met". Floor every tier at the real relay minimum.
 */
const LTC_MIN_RELAY_SAT_VB = 100;

export async function getFeeEstimates(): Promise<FeeEstimates> {
  const floor = (v: number | undefined, fallback: number) =>
    Math.max(LTC_MIN_RELAY_SAT_VB, Math.ceil(Number(v) || fallback));
  try {
    const raw = await getJson<FeeEstimates>("/v1/fees/recommended");
    return {
      fastestFee: floor(raw.fastestFee, 5),
      halfHourFee: floor(raw.halfHourFee, 3),
      hourFee: floor(raw.hourFee, 2),
      minimumFee: floor(raw.minimumFee, 1),
    };
  } catch {
    return {
      fastestFee: LTC_MIN_RELAY_SAT_VB,
      halfHourFee: LTC_MIN_RELAY_SAT_VB,
      hourFee: LTC_MIN_RELAY_SAT_VB,
      minimumFee: LTC_MIN_RELAY_SAT_VB,
    };
  }
}

export async function broadcastTx(hex: string): Promise<string> {
  const res = await fetch(`${LTC_MEMPOOL_API}/tx`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: hex,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`ltc broadcast failed: ${res.status} ${cleanUpstreamBody(body)}`);
  return body.trim();
}

export function explorerTxUrl(txid: string): string {
  return `${LTC_MEMPOOL_BASE}/tx/${txid}`;
}

export function explorerAddressUrl(address: string): string {
  return `${LTC_MEMPOOL_BASE}/address/${address}`;
}
