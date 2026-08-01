/**
 * Chain-authoritative Omni token metadata.
 *
 * Divisibility is fixed at issuance. Locally-stored metadata (built-ins or
 * user-added customs) can disagree with the chain, and getting it wrong shifts
 * the decimal point by 10^8 — e.g. POP #37 (indivisible) rendering as
 * 1000000000 instead of 10. This hook fetches the real flag from the node and
 * hands back a resolver that overrides local metadata whenever the node
 * answers.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTxcTokenProperties } from "./tokens.functions";
import type { TxcTokenMeta } from "./tokens";

export function useTxcTokenProps(tokens: TxcTokenMeta[]) {
  const fetchProps = useServerFn(getTxcTokenProperties);
  const ids = tokens.map((t) => t.id);
  const key = ids.slice().sort((a, b) => a - b).join(",");
  const query = useQuery({
    queryKey: ["txc-token-props", key],
    enabled: ids.length > 0,
    queryFn: () => fetchProps({ data: { propertyIds: ids } }),
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  return useMemo(() => {
    const data = query.data;
    const resolve = (t: TxcTokenMeta): TxcTokenMeta => {
      const p = data?.[t.id];
      if (!p) return t;
      return { ...t, divisible: p.divisible, name: t.name ?? p.name };
    };
    return {
      resolve,
      resolved: tokens.map(resolve),
      isLoading: query.isLoading,
    };
    // tokens identity changes on each render of the caller's hook; key is stable
    // enough for the resolver, and mapping is cheap.
  }, [query.data, query.isLoading, tokens]);
}
