/**
 * Persist non-sensitive TanStack Query cache entries to localStorage so the
 * wallet renders last-known balances / prices / tx history instantly on open,
 * then refreshes in the background once the user unlocks.
 *
 * Safety rules:
 *  - Only runs in the browser.
 *  - Allowlist of query-key prefixes — never persists anything derived from
 *    the mnemonic or private keys.
 *  - Custom (de)serializer handles bigint values (EVM balances).
 */
import type { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

// Keys allowed to persist. Everything else stays in-memory only.
const PERSIST_ALLOWLIST = new Set([
  "account",       // derived addresses / xpub (no secrets)
  "txs",           // TXC tx history keyed by address
  "txc-price",
  "all-prices",
  "evm-balance",
  "evm-history",
  "erc20-usdc",
]);

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return { __t: "bigint", v: value.toString() };
  return value;
}
function reviver(_key: string, value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    (value as { __t?: string }).__t === "bigint" &&
    typeof (value as { v?: string }).v === "string"
  ) {
    return BigInt((value as { v: string }).v);
  }
  return value;
}

export function installQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined") return;
  try {
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: "hme-query-cache-v1",
      throttleTime: 1000,
      serialize: (data) => JSON.stringify(data, replacer),
      deserialize: (raw) => JSON.parse(raw, reviver),
    });

    persistQueryClient({
      // Cast bypasses a spurious duplicate-symbol type mismatch between the
      // versions of @tanstack/query-core resolved for react-query vs the
      // persist-client packages. Runtime is a single 5.101.2 install.
      queryClient: queryClient as unknown as Parameters<typeof persistQueryClient>[0]["queryClient"],
      persister,
      maxAge: 24 * 60 * 60 * 1000, // 24h
      buster: "v2",
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          const head = query.queryKey?.[0];
          if (typeof head !== "string") return false;
          if (!PERSIST_ALLOWLIST.has(head)) return false;
          return query.state.status === "success";
        },
      },
    });
  } catch {
    // localStorage disabled (private mode, quota) — silently fall back to memory-only.
  }
}
