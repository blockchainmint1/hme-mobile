import type { EvmTransfer } from "./history.functions";
import { classifyToken } from "./token-classification";

// -------------------- BSC via NOWNodes Blockbook --------------------
// Alchemy doesn't index BNB Chain transfers, so BSC history comes from the
// NOWNodes-hosted Blockbook indexer (NOWNODES_API_KEY stays server-side).

interface BlockbookTx {
  txid: string;
  blockHeight: number;
  blockTime?: number;
  vin?: { addresses?: string[]; value?: string }[];
  vout?: { addresses?: string[]; value?: string }[];
  tokenTransfers?: {
    /** Newer Blockbook builds use `contract`; older ones used `token`. */
    contract?: string;
    token?: string;
    symbol?: string;
    decimals?: number;
    from?: string;
    to?: string;
    value?: string;
  }[];
}

async function blockbookJson(base: string, apiKey: string, path: string): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    headers: { accept: "application/json", "api-key": apiKey },
  });
  if (!res.ok) throw new Error(`blockbook ${res.status}`);
  return res.json();
}

function scaledWei(raw: string, decimals: number): string {
  try {
    const v = BigInt(raw);
    const d = BigInt(10) ** BigInt(decimals);
    const whole = v / d;
    const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return "0";
  }
}

export async function fetchBscHistory(address: string): Promise<EvmTransfer[]> {
  const apiKey = process.env.NOWNODES_API_KEY;
  if (!apiKey) throw new Error("NOWNODES_API_KEY not configured");
  const base = "https://bsc-blockbook.nownodes.io";
  const lower = address.toLowerCase();

  // Step 1: recent tx ids touching this address.
  const addrBody = (await blockbookJson(
    base,
    apiKey,
    `/api/v2/address/${address}?details=txslight&pageSize=25`,
  )) as { transactions?: (string | { txid?: string })[] };
  const txids = (Array.isArray(addrBody?.transactions) ? addrBody.transactions : [])
    .map((t) => (typeof t === "string" ? t : t?.txid))
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, 25);
  if (txids.length === 0) return [];

  // Step 2: fetch each tx for value/token detail (best-effort, parallel).
  const results = await Promise.allSettled(
    txids.map((id) => blockbookJson(base, apiKey, `/api/v2/tx/${id}`)),
  );

  const rows: EvmTransfer[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const tx = r.value as BlockbookTx;
    if (!tx?.txid) continue;
    try {
    const timestamp = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;

    // Native BNB movement.
    const vinMine = (tx.vin ?? []).some((i) =>
      (i.addresses ?? []).some((a) => a.toLowerCase() === lower),
    );
    const received = (tx.vout ?? []).reduce((sum, o) => {
      const mine = (o.addresses ?? []).some((a) => a.toLowerCase() === lower);
      return mine ? sum + BigInt(o.value ?? "0") : sum;
    }, BigInt(0));
    const sent = (tx.vin ?? []).reduce((sum, i) => {
      const mine = (i.addresses ?? []).some((a) => a.toLowerCase() === lower);
      return mine ? sum + BigInt(i.value ?? "0") : sum;
    }, BigInt(0));
    const net = received - sent;
    // Skip zero-net rows unless the user paid in (contract call with no BNB out).
    if (net !== BigInt(0)) {
      const outgoing = net < 0;
      const amount = net < 0 ? -net : net;
      const from = tx.vin?.[0]?.addresses?.[0] ?? "";
      const to = tx.vout?.find((o) =>
        (o.addresses ?? []).some((a) => a.toLowerCase() === (outgoing ? a.toLowerCase() : lower)),
      )?.addresses?.[0] ?? null;
      rows.push({
        hash: tx.txid,
        from,
        to,
        value: scaledWei(amount.toString(), 18),
        asset: "BNB",
        category: "external",
        blockNum: tx.blockHeight ?? 0,
        timestamp,
        outgoing,
        contractAddress: null,
        spam: false,
        spamReason: null,
      });
    } else if (vinMine && (tx.tokenTransfers ?? []).length === 0) {
      // Pure outgoing contract interaction / fee-only — skip to avoid noise.
    }

    // BEP-20 token transfers.
    for (const t of tx.tokenTransfers ?? []) {
      const from = t.from ?? "";
      const to = t.to ?? "";
      const outgoing = from.toLowerCase() === lower;
      const incoming = to.toLowerCase() === lower;
      if (!outgoing && !incoming) continue;
      const decimals = t.decimals ?? 18;
      const valueStr = scaledWei(t.value ?? "0", decimals);
      const contractRaw = t.contract ?? t.token ?? null;
      const contract = contractRaw ? contractRaw.toLowerCase() : null;
      const { spam, reason } = classifyToken(
        "bsc",
        "erc20",
        t.symbol ?? null,
        contract,
        outgoing,
        Number(valueStr) || null,
      );
      rows.push({
        hash: tx.txid,
        from,
        to,
        value: valueStr,
        asset: t.symbol ?? "TOKEN",
        category: "erc20",
        blockNum: tx.blockHeight ?? 0,
        timestamp,
        outgoing,
        contractAddress: contract,
        spam,
        spamReason: reason,
      });
    }
    } catch {
      // One malformed tx shouldn't blank out the whole activity list.
      continue;
    }
  }

  return rows.sort((a, b) => b.blockNum - a.blockNum).slice(0, 50);
}

