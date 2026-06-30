/**
 * JSON-RPC proxy for EVM networks. The Alchemy API key stays server-side;
 * the client points viem at /api/evm/<chain> instead of the upstream RPC.
 *
 * Allowed chains: eth, bsc, base.
 */
import { createFileRoute } from "@tanstack/react-router";

const UPSTREAM: Record<string, (key: string) => string> = {
  eth: (k) => `https://eth-mainnet.g.alchemy.com/v2/${k}`,
  base: (k) => `https://base-mainnet.g.alchemy.com/v2/${k}`,
  bsc: (k) => `https://bnb-mainnet.g.alchemy.com/v2/${k}`,
};

// Public fallbacks if Alchemy doesn't have a given network on the plan.
const FALLBACK: Record<string, string> = {
  bsc: "https://bsc-dataseed.binance.org",
};

// Only allow safe read + raw send methods. Blocks `eth_accounts`,
// `eth_sign`, wallet_*, etc. so the proxy can't be abused as a wallet.
const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_sendRawTransaction",
  "net_version",
  // Alchemy helpers used by the token list
  "alchemy_getTokenBalances",
  "alchemy_getTokenMetadata",
]);

type RpcCall = { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown };

export const Route = createFileRoute("/api/evm/$chain")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const chain = params.chain;
        const builder = UPSTREAM[chain];
        if (!builder) return new Response("Unknown chain", { status: 404 });

        const key = process.env.ALCHEMY_KEY;
        const url = key ? builder(key) : FALLBACK[chain];
        if (!url) return new Response("RPC not configured", { status: 500 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const calls = Array.isArray(body) ? (body as RpcCall[]) : [body as RpcCall];
        for (const c of calls) {
          if (!c || typeof c.method !== "string" || !ALLOWED.has(c.method)) {
            return new Response(`Method not allowed: ${c?.method ?? "?"}`, { status: 403 });
          }
        }

        const upstream = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

        const text = await upstream.text();
        return new Response(text, {
          status: upstream.status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
