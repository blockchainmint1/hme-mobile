/**
 * Keep Omni token-holding addresses stocked with a small TXC reserve.
 *
 * Omni derives the *sending* address from a transaction's first input, so a
 * token send must spend a coin owned by the address that holds the token. When
 * that address has no TXC we have to broadcast a funding transaction first and
 * chain the transfer onto it — two sequential broadcasts, right when someone is
 * standing at a merchant terminal waiting.
 *
 * This module moves that work off the critical path: whenever the wallet is
 * open and idle, any token-holding address below the reserve gets topped up
 * quietly in the background, so the payment itself is a single broadcast.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { BIP32Interface } from "bip32";
import type { AccountSnapshot } from "./scan";
import { buildAndSignTx } from "./wallet";
import { broadcastTx, getFeeEstimates } from "./mempool";
import { scriptKindOf, DERIVATION_PATHS, type DerivationKind } from "./network";
import { getTxcTokenBalancesPerAddress } from "./tokens.functions";
import type { TxcTokenMeta } from "./tokens";

/** Omni reference-output dust, matching the send screen. */
const OMNI_DUST_SATS = 10_000;
/** Rough vbytes for a 1-in / 2-out Omni send, per script type. */
const OMNI_VBYTES: Record<"bip84" | "bip49" | "bip44", number> = {
  bip84: 11 + 68 + 31 * 2 + 31,
  bip49: 11 + 91 + 32 * 2 + 31,
  bip44: 10 + 148 + 34 * 2 + 31,
};
/** Extra headroom so a fee bump between top-up and payment can't strand it. */
const HEADROOM = 2;
/** Don't re-attempt a top-up for the same address more often than this. */
const RETRY_MS = 10 * 60_000;

const attempted = new Map<string, number>();

function kindFromPath(path: string): DerivationKind | null {
  for (const [kind, prefix] of Object.entries(DERIVATION_PATHS)) {
    if (path.startsWith(prefix + "/")) return kind as DerivationKind;
  }
  return null;
}

/** How much TXC a token-holding address should keep on hand. */
export function reserveSatsFor(kind: DerivationKind, feeRate: number): number {
  return OMNI_DUST_SATS + Math.ceil(OMNI_VBYTES[scriptKindOf(kind)] * feeRate * HEADROOM);
}

export interface TopUpParams {
  root: BIP32Interface;
  walletKind: DerivationKind;
  snapshot: AccountSnapshot;
  /** Addresses that currently hold at least one enabled Omni token. */
  holders: string[];
  feeRate: number;
  changeAddress: string;
  changeIndex: number;
}

/**
 * Fund every under-reserved holder address in a single transaction.
 * Returns the broadcast txid, or null when nothing needed doing.
 */
export async function topUpTokenHolders(params: TopUpParams): Promise<string | null> {
  const { root, walletKind, snapshot, holders, feeRate, changeAddress, changeIndex } = params;
  if (holders.length === 0) return null;

  const infos = [...snapshot.external, ...snapshot.internal]
    .map((d) => ({ ...d, kind: kindFromPath(d.path) }))
    .filter((d): d is typeof d & { kind: DerivationKind } => d.kind !== null);

  const balanceByAddress = new Map<string, number>();
  for (const u of snapshot.utxos) {
    balanceByAddress.set(u.address, (balanceByAddress.get(u.address) ?? 0) + u.value);
  }

  const now = Date.now();
  const outputs: { address: string; valueSats: number }[] = [];
  for (const addr of holders) {
    const info = infos.find((i) => i.address === addr);
    if (!info) continue; // not one of ours (watch-only / imported key)
    const have = balanceByAddress.get(addr) ?? 0;
    const reserve = reserveSatsFor(info.kind, feeRate);
    if (have >= reserve) continue;
    const last = attempted.get(addr) ?? 0;
    if (now - last < RETRY_MS) continue;
    outputs.push({ address: addr, valueSats: reserve - have });
  }
  if (outputs.length === 0) return null;

  // Fund from coins that don't belong to the holder addresses themselves.
  const holderSet = new Set(outputs.map((o) => o.address));
  const spendable = snapshot.utxos
    .filter((u) => !holderSet.has(u.address))
    .sort((a, b) => b.value - a.value);
  if (spendable.length === 0) return null;

  const needed = outputs.reduce((s, o) => s + o.valueSats, 0);
  const base = scriptKindOf(walletKind);
  const perInput = { bip84: 68, bip49: 91, bip44: 148 }[base];
  const perOutput = { bip84: 31, bip49: 32, bip44: 34 }[base];
  const inputs: typeof spendable = [];
  let acc = 0;
  let feeSats = 0;
  for (const u of spendable) {
    inputs.push(u);
    acc += u.value;
    const vsize = 11 + perInput * inputs.length + perOutput * (outputs.length + 1);
    feeSats = Math.ceil(vsize * feeRate);
    if (acc >= needed + feeSats + OMNI_DUST_SATS) break;
  }
  // Not enough spare TXC — stay silent, the send screen's fallback still works.
  if (acc < needed + feeSats + OMNI_DUST_SATS) return null;

  for (const o of outputs) attempted.set(o.address, now);

  const tx = buildAndSignTx({
    root,
    kind: walletKind,
    inputs,
    outputs,
    changeAddress,
    changeIndex,
    feeSats,
  });
  return broadcastTx(tx.hex);
}

export interface UseTokenHolderTopUpArgs {
  root: BIP32Interface | null;
  walletKind: DerivationKind | null;
  snapshot: AccountSnapshot | undefined;
  tokens: TxcTokenMeta[];
  /** Only run for full HD wallets that can actually sign. */
  enabled?: boolean;
  onFunded?: () => void;
}

/**
 * Background hook: watches the account's token-holding addresses and keeps a
 * TXC reserve on each so a token payment never needs a funding transaction.
 */
export function useTokenHolderTopUp({
  root,
  walletKind,
  snapshot,
  tokens,
  enabled = true,
  onFunded,
}: UseTokenHolderTopUpArgs): void {
  const fetchPerAddr = useServerFn(getTxcTokenBalancesPerAddress);
  const running = useRef(false);

  const addresses = [
    ...(snapshot?.external.map((a) => a.address) ?? []),
    ...(snapshot?.internal.map((a) => a.address) ?? []),
  ];
  const propertyIds = tokens.map((t) => t.id);

  const perAddr = useQuery({
    queryKey: ["txc-token-balances-per-addr", addresses.join(","), propertyIds.join(",")],
    enabled: enabled && addresses.length > 0 && propertyIds.length > 0,
    queryFn: () => fetchPerAddr({ data: { addresses, propertyIds } }),
    staleTime: 60_000,
  });

  const fees = useQuery({
    queryKey: ["fees"],
    queryFn: getFeeEstimates,
    staleTime: 60_000,
    enabled,
  });

  const holders = perAddr.data
    ? Object.entries(perAddr.data)
        .filter(([, byId]) => Object.values(byId ?? {}).some((v) => BigInt(v ?? "0") > 0n))
        .map(([addr]) => addr)
    : [];
  const holderKey = holders.join(",");

  useEffect(() => {
    if (!enabled || !root || !walletKind || !snapshot || holders.length === 0) return;
    if (running.current) return;
    const feeRate = Math.max(fees.data?.halfHourFee ?? 10, fees.data?.minimumFee ?? 10, 10);
    running.current = true;
    void topUpTokenHolders({
      root,
      walletKind,
      snapshot,
      holders,
      feeRate,
      changeAddress: snapshot.nextChangeAddress,
      changeIndex: snapshot.nextChangeIndex,
    })
      .then((txid) => {
        if (txid) onFunded?.();
      })
      .catch(() => {
        // Background best-effort — the send screen still funds on demand.
      })
      .finally(() => {
        running.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, holderKey, snapshot?.balanceSats, walletKind, fees.data?.halfHourFee]);
}
