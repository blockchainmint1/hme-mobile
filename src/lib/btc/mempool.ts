/**
 * Blockbook v2 → Esplora-shape adapter for Bitcoin. Exported surface is
 * identical to src/lib/ltc/mempool.ts and src/lib/doge/mempool.ts so scan.ts
 * and the send/receive routes reuse the same query patterns.
 *
 * Backend: NowNodes (keyed, no rate limits) with Trezor's public Blockbook as
 * failover — both proxied through /api/utxo/btc.
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

export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BTC_MEMPOOL_API}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`btc-blockbook ${path}: ${res.status} ${res.statusText}`);
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
  vin: Array<{ txid?: string; vout?: number; addresses?: string[]; value?: string }>;
  vout: Array<{ n: number; value?: string; addresses?: string[]; hex?: string }>;
  blockHeight?: number;
  blockTime?: number;
  size?: number;
  vsize?: number;
  fees?: string;
  hex?: string;
};

function mapTx(raw: BbTx): MempoolTx {
  const size = raw.size ?? 0;
  return {
    txid: raw.txid,
    version: raw.version ?? 1,
    size,
    weight: (raw.vsize ?? size) * 4,
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

type BbUtxo = { txid: string; vout: number; value: string; height?: number };

export async function getAddressUtxos(address: string): Promise<MempoolUtxo[]> {
  const raw = await getJson<BbUtxo[]>(`/utxo/${address}`);
  return raw.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    value: Number(u.value),
    status: { confirmed: !!u.height && u.height > 0, block_height: u.height },
  }));
}

export async function getTxHex(txid: string): Promise<string> {
  const raw = await getJson<{ hex?: string }>(`/tx/${txid}`);
  if (!raw.hex) throw new Error(`btc-blockbook /tx/${txid}: missing hex`);
  return raw.hex;
}

/** Bitcoin's relay minimum is 1 sat/vB; clamp wild estimator values. */
const BTC_MIN_RELAY_SAT_VB = 1;
const BTC_MAX_SAT_VB = 1000;

export async function getFeeEstimates(): Promise<FeeEstimates> {
  // Blockbook /estimatefee/{blocks} returns BTC per kB → sat/vB is *1e8/1000.
  async function rate(blocks: number, fallback: number): Promise<number> {
    try {
      const raw = await getJson<{ result?: string }>(`/estimatefee/${blocks}`);
      const perKb = Number(raw.result ?? "0");
      if (!Number.isFinite(perKb) || perKb <= 0) return fallback;
      return Math.round((perKb * 1e8) / 1000);
    } catch {
      return fallback;
    }
  }
  const clamp = (v: number) => Math.min(BTC_MAX_SAT_VB, Math.max(BTC_MIN_RELAY_SAT_VB, v));
  const [fastest, half, hour] = await Promise.all([rate(1, 10), rate(3, 6), rate(6, 3)]);
  const slow = clamp(hour);
  const medium = clamp(Math.max(half, slow));
  const fast = clamp(Math.max(fastest, medium));
  return {
    fastestFee: fast,
    halfHourFee: medium,
    hourFee: slow,
    minimumFee: BTC_MIN_RELAY_SAT_VB,
  };
}

export async function broadcastTx(hex: string): Promise<string> {
  // GET /sendtx/{hex} — the body form doesn't survive every proxy / native
  // bridge hop, which shows up upstream as "Missing tx blob".
  const res = await fetch(`${BTC_MEMPOOL_API}/sendtx/${hex}`, {
    headers: { accept: "application/json" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`btc broadcast failed: ${res.status} ${cleanUpstreamBody(body)}`);

  type SendTxBody = { result?: string; error?: string | { message?: string } };
  let parsed: SendTxBody | null = null;
  try {
    parsed = JSON.parse(body) as SendTxBody;
  } catch {
    parsed = null;
  }
  if (parsed) {
    const errMsg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    if (errMsg) throw new Error(`btc broadcast rejected: ${errMsg}`);
    if (parsed.result) return parsed.result;
  }
  return cleanUpstreamBody(body, 120);
}

export function explorerTxUrl(txid: string): string {
  return `${BTC_MEMPOOL_BASE}/tx/${txid}`;
}

export function explorerAddressUrl(address: string): string {
  return `${BTC_MEMPOOL_BASE}/address/${address}`;
}
