/**
 * THORNode REST helpers. Server-only: these hit public THORNode instances with
 * failover, so a single flaky provider can't break swapping.
 */
import {
  STABLE_DESTINATIONS,
  THOR_SOURCE_ASSET,
  type StableDestination,
  type ThorQuote,
  type ThorTxStatus,
} from "./assets";
import type { ThorQuoteInput } from "./schemas";

/**
 * Public THORNode endpoints, tried in order.
 * NineRealms was retired in 2026; Liquify's gateway is the current public one.
 */
const NODES = [
  "https://gateway.liquify.com/chain/thorchain_api",
  "https://thornode.thorchain.network",
  "https://thornode.thorchain.liquify.com",
];

/** Transient node states worth retrying on another endpoint. */
const RETRYABLE = /invalid height|context did not contain|unavailable|timeout|fetch|abort|502|503/i;

async function nodeGet<T>(path: string): Promise<T> {
  let lastErr: unknown = null;
  for (const base of NODES) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { accept: "application/json", "x-client-id": "hme-wallet" },
        signal: AbortSignal.timeout(12_000),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        lastErr = new Error(`Swap node returned an unreadable response (${res.status})`);
        continue;
      }
      // THORNode reports most errors as a 200 with a { code, message } body,
      // so status alone isn't enough to tell success from failure.
      const asErr = json as { code?: number; message?: string; error?: string };
      const msg = asErr?.message ?? asErr?.error ?? null;
      const failed = !res.ok || (typeof asErr?.code === "number" && !!msg);
      if (failed) {
        const message = msg ?? `Swap node error ${res.status}`;
        if (RETRYABLE.test(message)) {
          lastErr = new Error(message);
          continue;
        }
        // A real, user-meaningful answer (amount too small, trading halted).
        throw new Error(message);
      }
      return json as T;
    } catch (err) {
      if (err instanceof Error && !RETRYABLE.test(err.message)) throw err;
      lastErr = err;
    }
  }
  throw new Error(
    lastErr instanceof Error
      ? `Swap network unreachable: ${lastErr.message}`
      : "Swap network unreachable",
  );
}

/** THORChain chain codes for our source coins and destination chains. */
const HALT_CHAIN_CODE: Record<string, string> = {
  ltc: "LTC",
  doge: "DOGE",
  eth: "ETH",
  base: "BASE",
  bsc: "BSC",
};

/** Stablecoin pools that are currently live and tradeable. */
export async function fetchAvailableStables(
  from: keyof typeof THOR_SOURCE_ASSET,
): Promise<StableDestination[]> {
  const [pools, mimir] = await Promise.all([
    nodeGet<Array<{ asset: string; status: string }>>("/thorchain/pools"),
    nodeGet<Record<string, number>>("/thorchain/mimir").catch(
      () => ({}) as Record<string, number>,
    ),
  ]);
  const live = new Set(
    pools.filter((p) => p.status === "Available").map((p) => p.asset.toUpperCase()),
  );
  const halted = (chain: string) =>
    mimir[`HALT${chain}TRADING`] === 1 || mimir[`SOLVENCYHALT${chain}CHAIN`] === 1;

  if (mimir["HALTTRADING"] === 1) {
    throw new Error("THORChain has paused trading network-wide. Try again a bit later.");
  }
  // The source pool must be live too, or nothing can be swapped.
  if (!live.has(THOR_SOURCE_ASSET[from].toUpperCase()) || halted(HALT_CHAIN_CODE[from]!)) {
    throw new Error(`${from.toUpperCase()} swaps are paused on THORChain right now.`);
  }
  const available = STABLE_DESTINATIONS.filter(
    (d) => live.has(d.asset.toUpperCase()) && !halted(HALT_CHAIN_CODE[d.chain]!),
  );
  if (!available.length) {
    throw new Error("Every stablecoin route is paused on THORChain right now. Try again later.");
  }
  return available;
}


export async function fetchQuote(input: ThorQuoteInput): Promise<ThorQuote> {
  const params = new URLSearchParams({
    from_asset: THOR_SOURCE_ASSET[input.coin],
    to_asset: input.toAsset,
    amount: input.amountSats,
    destination: input.destination,
    tolerance_bps: String(input.toleranceBps ?? 300),
  });
  // Streaming swaps split the trade into per-block chunks, which cuts the
  // slip fee dramatically on anything but the smallest amounts.
  const interval = input.streamingInterval ?? 1;
  if (interval > 0) {
    params.set("streaming_interval", String(interval));
    params.set("streaming_quantity", "0"); // 0 = let the network pick the optimal count
  }

  const affiliate = process.env["THOR_AFFILIATE"];
  const affiliateBps = process.env["THOR_AFFILIATE_BPS"];
  if (affiliate && affiliateBps) {
    params.set("affiliate", affiliate);
    params.set("affiliate_bps", affiliateBps);
  }

  return nodeGet<ThorQuote>(`/thorchain/quote/swap?${params.toString()}`);
}

interface RawStatus {
  stages?: {
    inbound_observed?: { completed?: boolean; final_count?: number };
    inbound_finalised?: { completed?: boolean; remaining_confirmation_seconds?: number };
    swap_finalised?: { completed?: boolean };
    outbound_signed?: { completed?: boolean };
    outbound_delay?: { remaining_delay_seconds?: number };
  };
  out_txs?: Array<{ chain?: string; id?: string }>;
  planned_out_txs?: Array<{ chain?: string; refund?: boolean }>;
}

export async function fetchTxStatus(txid: string): Promise<ThorTxStatus> {
  const raw = await nodeGet<RawStatus>(`/thorchain/tx/status/${txid}`);
  const out = raw.out_txs?.find((t) => t.id && t.id !== "0".repeat(64));
  const remaining =
    raw.stages?.inbound_finalised?.remaining_confirmation_seconds ??
    raw.stages?.outbound_delay?.remaining_delay_seconds ??
    null;
  return {
    observed: !!raw.stages?.inbound_observed?.completed,
    finalised: !!raw.stages?.swap_finalised?.completed,
    outboundSent: !!out?.id,
    outboundTxid: out?.id ?? null,
    outboundChain: out?.chain ?? raw.planned_out_txs?.[0]?.chain ?? null,
    secondsRemaining: typeof remaining === "number" ? remaining : null,
  };
}
