import type { EvmTransfer } from "./history.functions";

export interface HistoryStream {
  block: number;
  pageKey?: string;
  toBlock?: number;
  fromBlock?: number;
}
export interface HistoryPayload {
  rows: EvmTransfer[];
  streams: Record<string, HistoryStream>;
  incomplete?: boolean;
}
export interface TransferPage {
  transfers: EvmTransfer[];
  pageKey?: string;
}

/** Fixed block bounds survive pagination; never skip a page during a spam flood. */
export async function syncHistoryPages(
  previous: HistoryPayload,
  head: number,
  fetchPage: (stream: string, from: number, to: number, pageKey?: string) => Promise<TransferPage>,
): Promise<HistoryPayload> {
  const rows = new Map(previous.rows.map((row) => [transferIdentity(row), row]));
  const streams = { ...previous.streams };
  await Promise.all(["from", "to", "verified-from", "verified-to"].map(async (name) => {
    const old = streams[name] ?? { block: 0 };
    const from = old.pageKey ? (old.fromBlock ?? 0) : Math.max(0, old.block - 12);
    const to = old.pageKey ? (old.toBlock ?? head) : head;
    let pageKey = old.pageKey;
    for (let page = 0; page < 2; page++) {
      const result = await fetchPage(name, from, to, pageKey);
      for (const row of result.transfers) rows.set(transferIdentity(row), row);
      pageKey = result.pageKey;
      if (!pageKey) break;
    }
    streams[name] = pageKey
      ? { block: old.block, fromBlock: from, toBlock: to, pageKey }
      : { block: to };
  }));
  // Separate budgets: counterfeit and zero-value events cannot evict real payments.
  const all = [...rows.values()].sort((a, b) => b.blockNum - a.blockNum);
  const real = all.filter((row) => !row.spam && !(row.category === "erc20" && Number(row.value) === 0)).slice(0, 100);
  const suspicious = all.filter((row) => row.spam || (row.category === "erc20" && Number(row.value) === 0)).slice(0, 100);
  return { rows: [...real, ...suspicious].sort((a, b) => b.blockNum - a.blockNum), streams,
    incomplete: Object.values(streams).some((stream) => !!stream.pageKey) };
}

export function transferIdentity(row: EvmTransfer): string {
  return row.eventId ?? [row.hash, row.category, row.contractAddress, row.from.toLowerCase(), row.to?.toLowerCase(), row.value, row.outgoing].join(":");
}

/** Signer mismatch and today's allowance cannot invalidate a historical payment. */
export function zeroValueTokenReason(row: EvmTransfer): string | null {
  return row.category === "erc20" && /^0(?:\.0*)?$/.test(row.value)
    ? "Zero-value token transfer — possible address poisoning" : null;
}