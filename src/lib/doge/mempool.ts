/**
 * Blockbook v2 → Esplora-shape adapter for Dogecoin. Keeps this module's
 * exported surface identical to src/lib/txc/mempool.ts and src/lib/isk/mempool.ts
 * so scan.ts and the send/receive routes reuse the same query patterns.
 *
 * Backend: Trezor's public Blockbook (rate-limited free tier). This is
 * knowingly temporary — see plan/instructions.
 */
import { DOGE_BLOCKBOOK_API, DOGE_EXPLORER_BASE } from "./network";

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

export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DOGE_BLOCKBOOK_API}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`doge-blockbook ${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

type BbAddrBasic = {
  txs?: number;
  unconfirmedTxs?: number;
  balance?: string;
  unconfirmedBalance?: string;
  totalReceived?: string;
  totalSent?: string;
};

export async function getAddressStats(address: string): Promise<MempoolAddressStats> {
  const raw = await getJson<BbAddrBasic>(`/address/${address}?details=basic`);
  const totalReceived = Number(raw.totalReceived ?? "0");
  const totalSent = Number(raw.totalSent ?? "0");
  const unconf = Number(raw.unconfirmedBalance ?? "0");
  return {
    address,
    chain_stats: {
      funded_txo_sum: totalReceived,
      spent_txo_sum: totalSent,
      tx_count: raw.txs ?? 0,
    },
    mempool_stats: {
      funded_txo_sum: Math.max(0, unconf),
      spent_txo_sum: Math.max(0, -unconf),
      tx_count: raw.unconfirmedTxs ?? 0,
    },
  };
}

type BbTx = {
  txid: string;
  version?: number;
  vin: Array<{
    txid?: string;
    vout?: number;
    addresses?: string[];
    value?: string;
    isAddress?: boolean;
  }>;
  vout: Array<{
    n: number;
    value?: string;
    addresses?: string[];
    hex?: string;
  }>;
  blockHeight?: number;
  blockTime?: number;
  size?: number;
  fees?: string;
  hex?: string;
};

function mapTx(raw: BbTx): MempoolTx {
  const size = raw.size ?? 0;
  return {
    txid: raw.txid,
    version: raw.version ?? 1,
    size,
    weight: size * 4,
    fee: Number(raw.fees ?? "0"),
    vin: raw.vin.map((v) => ({
      txid: v.txid ?? "",
      vout: v.vout ?? 0,
      prevout: {
        scriptpubkey: "",
        scriptpubkey_address: v.addresses?.[0],
        value: Number(v.value ?? "0"),
      },
    })),
    vout: raw.vout.map((o) => ({
      scriptpubkey: o.hex ?? "",
      scriptpubkey_address: o.addresses?.[0],
      value: Number(o.value ?? "0"),
    })),
    status: {
      confirmed: !!raw.blockHeight && raw.blockHeight > 0,
      block_height: raw.blockHeight,
      block_time: raw.blockTime,
    },
  };
}

export async function getAddressTxs(address: string): Promise<MempoolTx[]> {
  const raw = await getJson<{ transactions?: BbTx[] }>(
    `/address/${address}?details=txs&pageSize=50`,
  );
  return (raw.transactions ?? []).map(mapTx);
}

type BbUtxo = {
  txid: string;
  vout: number;
  value: string;
  height?: number;
  confirmations?: number;
};

export async function getAddressUtxos(address: string): Promise<MempoolUtxo[]> {
  const raw = await getJson<BbUtxo[]>(`/utxo/${address}`);
  return raw.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    value: Number(u.value),
    status: {
      confirmed: !!u.height && u.height > 0,
      block_height: u.height,
    },
  }));
}

export async function getTxHex(txid: string): Promise<string> {
  const raw = await getJson<{ hex?: string }>(`/tx/${txid}`);
  if (!raw.hex) throw new Error(`doge-blockbook /tx/${txid}: missing hex`);
  return raw.hex;
}

export async function getFeeEstimates(): Promise<FeeEstimates> {
  // Blockbook /estimatefee/{blocks} returns `{ result: "0.01000000" }` in
  // DOGE per KB. Convert to sat/vB: DOGE * 1e8 / 1000.
  async function rate(blocks: number, fallback: number): Promise<number> {
    try {
      const raw = await getJson<{ result?: string }>(`/estimatefee/${blocks}`);
      const perKb = Number(raw.result ?? "0");
      if (!Number.isFinite(perKb) || perKb <= 0) return fallback;
      return Math.max(1, Math.round((perKb * 1e8) / 1000));
    } catch {
      return fallback;
    }
  }
  // DOGE min relay is high vs BTC — the safe floor is ~1000 sat/vB
  // (1 DOGE per KB = 1000 sat/vB). Under-paying just leaves the tx
  // stuck in the mempool.
  const FLOOR = 1000;
  const [fastest, half, hour] = await Promise.all([
    rate(1, 2000),
    rate(3, 1500),
    rate(6, 1000),
  ]);
  return {
    fastestFee: Math.max(FLOOR, fastest),
    halfHourFee: Math.max(FLOOR, half),
    hourFee: Math.max(FLOOR, hour),
    minimumFee: FLOOR,
  };
}

export async function broadcastTx(hex: string): Promise<string> {
  const res = await fetch(`${DOGE_BLOCKBOOK_API}/sendtx/`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: hex,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`doge broadcast failed: ${res.status} ${body}`);
  try {
    const parsed = JSON.parse(body) as { result?: string; error?: { message?: string } };
    if (parsed.error?.message) throw new Error(parsed.error.message);
    if (parsed.result) return parsed.result;
  } catch (err) {
    if (err instanceof Error && err.message !== `Unexpected token '<'`) throw err;
  }
  return body.trim();
}

export function explorerTxUrl(txid: string): string {
  return `${DOGE_EXPLORER_BASE}/tx/${txid}`;
}

export function explorerAddressUrl(address: string): string {
  return `${DOGE_EXPLORER_BASE}/address/${address}`;
}
