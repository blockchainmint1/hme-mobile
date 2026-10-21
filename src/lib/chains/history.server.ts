import type { EvmTransfer } from "./history.functions";
import { syncHistoryPages, type HistoryPayload } from "./history-cache";
import { classifyToken, VERIFIED_CONTRACTS } from "./token-classification";
import { readBoundedText } from "../security/json-proxy.server";

interface AlchemyTransfer {
  uniqueId?: string; hash: string; from: string; to: string | null;
  value: number | null; asset: string | null; category: string; blockNum: string;
  rawContract?: { address?: string | null; value?: string | null; decimal?: string | null };
  metadata?: { blockTimestamp?: string };
}

function decimalValue(t: AlchemyTransfer): string {
  const raw = t.rawContract?.value;
  const decimal = t.rawContract?.decimal;
  if (raw && raw !== "0x" && decimal) {
    try {
      const decimals = Number(BigInt(decimal));
      if (decimals >= 0 && decimals <= 36) {
        const value = BigInt(raw);
        const base = 10n ** BigInt(decimals);
        const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
        return fraction ? `${value / base}.${fraction}` : String(value / base);
      }
    } catch { /* Provider fallback below. */ }
  }
  return t.value == null ? "0" : String(t.value);
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("History provider unavailable");
  const body = JSON.parse(await readBoundedText(response, 2 * 1024 * 1024)) as { result?: unknown; error?: unknown };
  if (body.error || body.result == null) throw new Error("History provider unavailable");
  return body.result;
}

export async function getCachedHistory(data: { chain: "eth" | "base"; address: string; fingerprint?: string; force?: boolean }) {
  // Only public blockchain metadata is cached. No wallet/session/private keys.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const address = data.address.toLowerCase();
  const fingerprint = data.fingerprint ?? "";
  const read = async () => {
    const result = await supabaseAdmin.from("evm_history_cache").select("payload,synced_at")
      .eq("chain", data.chain).eq("address", address).maybeSingle();
    if (result.error) throw new Error("History cache unavailable");
    return result.data;
  };
  const cached = await read();
  const token = crypto.randomUUID();
  const claim = await supabaseAdmin.rpc("claim_evm_history_refresh", {
    p_chain: data.chain, p_address: address, p_fingerprint: fingerprint, p_force: !!data.force, p_token: token,
  });
  if (claim.error) throw new Error("History cache unavailable");
  const previous = (cached?.payload ?? { rows: [], streams: {} }) as unknown as HistoryPayload;
  if (!claim.data) return { transfers: previous.rows, supported: true, cached: true, syncedAt: cached?.synced_at ?? null, unavailable: !cached?.synced_at };
  try {
    const key = process.env.ALCHEMY_KEY;
    if (!key) throw new Error("History provider unavailable");
    const url = `https://${data.chain === "eth" ? "eth" : "base"}-mainnet.g.alchemy.com/v2/${key}`;
    const head = Number(BigInt(String(await rpc(url, "eth_blockNumber", []))));
    const payload = await syncHistoryPages(previous, head, async (stream, from, to, pageKey) => {
      const verified = stream.startsWith("verified-");
      const outgoing = stream.endsWith("from");
      const page = await rpc(url, "alchemy_getAssetTransfers", [{
        fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`,
        [outgoing ? "fromAddress" : "toAddress"]: address,
        category: verified ? ["erc20"] : ["external", "erc20", "internal"],
        ...(verified ? { contractAddresses: [...VERIFIED_CONTRACTS[data.chain]] } : {}),
        // Protected queries exclude poisoning on real contracts, keeping genuine sends reachable.
        excludeZeroValue: verified, withMetadata: true, maxCount: "0xc8", order: "desc",
        ...(pageKey ? { pageKey } : {}),
      }]) as { transfers?: AlchemyTransfer[]; pageKey?: string };
      if (!Array.isArray(page.transfers)) throw new Error("Invalid history page");
      return { pageKey: page.pageKey, transfers: page.transfers.map((t): EvmTransfer => {
        const contract = t.rawContract?.address?.toLowerCase() ?? null;
        const out = t.from.toLowerCase() === address;
        const classified = classifyToken(data.chain, t.category, t.asset, contract, out, t.value);
        return { hash: t.hash, eventId: t.uniqueId, from: t.from, to: t.to, value: decimalValue(t),
          asset: t.asset ?? "ETH", category: t.category, blockNum: parseInt(t.blockNum, 16),
          timestamp: t.metadata?.blockTimestamp ?? null, outgoing: out, contractAddress: contract,
          spam: classified.spam, spamReason: classified.reason };
      }) };
    });
    const save = await supabaseAdmin.rpc("commit_evm_history_refresh", {
      p_chain: data.chain, p_address: address, p_token: token,
      p_payload: JSON.parse(JSON.stringify(payload)), p_fingerprint: fingerprint,
    });
    if (save.error || !save.data) throw new Error("History save failed");
    return { transfers: payload.rows, supported: true, cached: false, syncedAt: new Date().toISOString() };
  } catch {
    // A failed page/save never advances any stream. Keep previous payments readable.
    return { transfers: previous.rows, supported: true, cached: true, unavailable: true, syncedAt: cached?.synced_at ?? null };
  } finally {
    await supabaseAdmin.from("evm_history_cache").update({ lease_token: null, lease_until: null })
      .eq("chain", data.chain).eq("address", address).eq("lease_token", token);
  }
}