/**
 * EVM transaction history via Alchemy `alchemy_getAssetTransfers`.
 * Runs server-side so the API key stays hidden. Supports ETH + Base.
 * BSC is not supported by alchemy_getAssetTransfers — we return empty and
 * the UI shows an "open in explorer" link instead.
 */
import { createServerFn } from "@tanstack/react-start";

export type EvmChainId = "eth" | "base" | "bsc";

export interface EvmTransfer {
  hash: string;
  from: string;
  to: string | null;
  /** Decimal value string, already scaled (e.g. "0.05"). */
  value: string;
  asset: string; // "ETH", "USDC", etc.
  category: string; // "external" | "erc20" | "internal"
  blockNum: number;
  /** ISO timestamp when available. */
  timestamp: string | null;
  /** true if this address was the sender. */
  outgoing: boolean;
}

const ALCHEMY_URL: Record<EvmChainId, (k: string) => string | null> = {
  eth: (k) => `https://eth-mainnet.g.alchemy.com/v2/${k}`,
  base: (k) => `https://base-mainnet.g.alchemy.com/v2/${k}`,
  // getAssetTransfers unsupported on BSC through Alchemy.
  bsc: () => null,
};

interface AlchemyTransfer {
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  blockNum: string;
  metadata?: { blockTimestamp?: string };
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Alchemy ${method} ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result;
}

async function fetchTransfers(
  url: string,
  address: string,
  direction: "from" | "to",
): Promise<AlchemyTransfer[]> {
  const params = [
    {
      fromBlock: "0x0",
      toBlock: "latest",
      [direction === "from" ? "fromAddress" : "toAddress"]: address,
      category: ["external", "erc20", "internal"],
      withMetadata: true,
      excludeZeroValue: true,
      maxCount: "0x19", // 25
      order: "desc",
    },
  ];
  const result = (await rpc(url, "alchemy_getAssetTransfers", params)) as {
    transfers?: AlchemyTransfer[];
  };
  return result.transfers ?? [];
}

export const getEvmHistory = createServerFn({ method: "POST" })
  .inputValidator((input: { chain: EvmChainId; address: string }) => {
    if (!input?.chain || !input?.address) throw new Error("chain and address required");
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.address)) throw new Error("invalid address");
    return input;
  })
  .handler(async ({ data }): Promise<{ transfers: EvmTransfer[]; supported: boolean }> => {
    const key = process.env.ALCHEMY_KEY;
    const builder = ALCHEMY_URL[data.chain];
    const url = key ? builder(key) : null;
    if (!url) return { transfers: [], supported: false };

    try {
      const addrLower = data.address.toLowerCase();
      const [outgoing, incoming] = await Promise.all([
        fetchTransfers(url, data.address, "from"),
        fetchTransfers(url, data.address, "to"),
      ]);

      const map = new Map<string, EvmTransfer>();
      const push = (t: AlchemyTransfer, out: boolean) => {
        const key = `${t.hash}:${t.category}:${t.asset ?? ""}:${out ? "o" : "i"}`;
        if (map.has(key)) return;
        map.set(key, {
          hash: t.hash,
          from: t.from,
          to: t.to,
          value: t.value != null ? String(t.value) : "0",
          asset: t.asset ?? "ETH",
          category: t.category,
          blockNum: parseInt(t.blockNum, 16),
          timestamp: t.metadata?.blockTimestamp ?? null,
          outgoing: out,
        });
      };
      for (const t of outgoing) push(t, t.from.toLowerCase() === addrLower);
      for (const t of incoming) push(t, t.from.toLowerCase() === addrLower);

      const list = [...map.values()].sort((a, b) => b.blockNum - a.blockNum).slice(0, 50);
      return { transfers: list, supported: true };
    } catch {
      return { transfers: [], supported: true };
    }
  });
