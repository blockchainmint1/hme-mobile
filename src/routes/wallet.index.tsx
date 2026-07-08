import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { scanIskAccount } from "@/lib/isk/scan";
import { ISK_DEFAULT_KIND } from "@/lib/isk/network";
import { formatIsk, formatIskCompact, satsToIsk } from "@/lib/isk/units";
import { getIskPriceUsd } from "@/lib/isk/price.functions";
import { getAddressTxs as getIskAddressTxs, type MempoolTx as IskMempoolTx } from "@/lib/isk/mempool";
import { formatTxc, formatTxcCompact, formatFiat, satsToTxc, compactNumberString } from "@/lib/txc/units";
import { getTxcPriceUsd } from "@/lib/txc/price.functions";
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { getEvmHistory } from "@/lib/chains/history.functions";
import { readErc20Balance, tokenAmountFromRaw, USDC_BY_CHAIN } from "@/lib/chains/erc20";
import { useTokensForChain } from "@/lib/token-prefs";
import { useEnabledTxcTokens, formatTokenAmount } from "@/lib/txc/tokens";
import { getTxcTokenBalancesForAddresses } from "@/lib/txc/tokens.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDown, ArrowUp, ArrowLeftRight, ChevronRight, RefreshCw, Send, QrCode, Eye, Trash2, Lock, Key } from "lucide-react";
import { useFeature } from "@/lib/feature-prefs";
import { getAddressStats, getAddressTxs, type MempoolTx } from "@/lib/txc/mempool";
import { getEnabledChains, CHAIN_META, type ChainId } from "@/lib/chain-prefs";
import { getChainLabel, CHAIN_LABEL_EVENT } from "@/lib/chain-labels";
import { EVM_CHAINS, deriveEvmAccount, evmClient, formatEth, type EvmChainId } from "@/lib/chains/evm";
import { TxDetailSheet, type TxDetail } from "@/components/wallet/TxDetailSheet";
import { WalletDetailSheet } from "@/components/wallet/WalletDetailSheet";
import { ReorderTilesSheet } from "@/components/wallet/ReorderTilesSheet";
import { useHideBalances, maskAmount } from "@/lib/hide-balances";
import { QrCode as QrCodeSvg } from "@/components/wallet/QrCode";
import {
  listWatchWallets,
  removeWatchWallet,
  watchChangedEvent,
  type WatchWallet,
} from "@/lib/watch-only";
import {
  listWifWallets,
  removeWifWallet,
  WIF_CHANGED_EVENT,
  type WifWalletEntry,
} from "@/lib/wif/store";
import { api as wifApi } from "@/lib/wif/chain-io";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/wallet/")({
  component: WalletHome,
});

function WalletHome() {
  const { root, unlocked } = useWallet();
  const fetchPrice = useServerFn(getTxcPriceUsd);
  const fetchAllPrices = useServerFn(getAllPricesUsd);
  const qc = useQueryClient();

  // Reactive enabled chain list
  const [enabled, setEnabled] = useState<ChainId[]>(() => getEnabledChains());
  useEffect(() => {
    const h = () => setEnabled(getEnabledChains());
    window.addEventListener("hme:chains-changed", h);
    return () => window.removeEventListener("hme:chains-changed", h);
  }, []);

  // Watch-only wallets (appended after the derived-chain tiles).
  const [watchList, setWatchList] = useState<WatchWallet[]>(() => listWatchWallets());
  useEffect(() => {
    const h = () => setWatchList(listWatchWallets());
    window.addEventListener(watchChangedEvent(), h);
    return () => window.removeEventListener(watchChangedEvent(), h);
  }, []);

  // WIF (imported single-key) wallets. Each becomes its own tile.
  const [wifList, setWifList] = useState<WifWalletEntry[]>(() => listWifWallets());
  useEffect(() => {
    const h = () => setWifList(listWifWallets());
    window.addEventListener(WIF_CHANGED_EVENT, h);
    return () => window.removeEventListener(WIF_CHANGED_EVENT, h);
  }, []);
  // Force-refresh chain labels when renamed elsewhere.
  const [, bumpLabels] = useState(0);
  useEffect(() => {
    const h = () => bumpLabels((n) => n + 1);
    window.addEventListener(CHAIN_LABEL_EVENT, h);
    return () => window.removeEventListener(CHAIN_LABEL_EVENT, h);
  }, []);


  // Unified carousel item list — chains first, then watch-only, then WIF.
  type Slot =
    | { kind: "chain"; chain: ChainId }
    | { kind: "watch"; watch: WatchWallet }
    | { kind: "wif"; wif: WifWalletEntry };
  const slots: Slot[] = useMemo(
    () => [
      ...enabled.map((c) => ({ kind: "chain" as const, chain: c })),
      ...watchList.map((w) => ({ kind: "watch" as const, watch: w })),
      ...wifList.map((w) => ({ kind: "wif" as const, wif: w })),
    ],
    [enabled, watchList, wifList],
  );

  // Active tile tracked via scroll position
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (!w) return;
      setActiveIdx(Math.round(el.scrollLeft / w));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [slots.length]);

  const activeSlot: Slot = slots[activeIdx] ?? { kind: "chain", chain: "txc" };
  const activeChain: ChainId = activeSlot.kind === "chain" ? activeSlot.chain : "txc";
  const activeWatch: WatchWallet | null = activeSlot.kind === "watch" ? activeSlot.watch : null;
  const activeWif: WifWalletEntry | null = activeSlot.kind === "wif" ? activeSlot.wif : null;

  // Selected transaction (opens in-page detail sheet)
  const [detail, setDetail] = useState<TxDetail | null>(null);
  // Which wallet tile's details are open
  const [tileOpen, setTileOpen] = useState<ChainId | null>(null);
  // Long-press to rearrange
  const [reorderOpen, setReorderOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const startLongPress = (action?: () => void) => {
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
      if (action) action();
      else setReorderOpen(true);
    }, 550);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };


  // TXC data — balance/frontier scan runs always so the portfolio total is
  // accurate at open. With the persisted scan-hint this is only ~5–10
  // mempool.space calls after the first deep scan.
  const account = useQuery({
    queryKey: ["account", unlocked?.kind, root?.neutered().toBase58().slice(0, 24)],
    enabled: !!root && !!unlocked,
    queryFn: () => scanAccount(root!, unlocked!.kind),
  });
  const price = useQuery({
    queryKey: ["txc-price"],
    queryFn: () => fetchPrice(),
    staleTime: 10 * 60_000, // prices don't need per-open freshness
  });
  // TX history is heavy (one call per used address). Only fetch it when the
  // TXC tile is actually being viewed; cached data still renders on swipe-in.
  const txs = useQuery({
    queryKey: ["txs", account.data?.external.map((a) => a.address).join(",")],
    enabled: !!account.data && activeChain === "txc",
    queryFn: async () => {
      const all = await Promise.all(
        [...(account.data?.external ?? []), ...(account.data?.internal ?? [])].map((a) =>
          getAddressTxs(a.address).catch(() => [] as MempoolTx[]),
        ),
      );
      const map = new Map<string, MempoolTx>();
      for (const list of all) for (const tx of list) map.set(tx.txid, tx);
      return [...map.values()].sort((a, b) => (b.status.block_time ?? 0) - (a.status.block_time ?? 0));
    },
  });

  const ownAddresses = new Set([
    ...(account.data?.external.map((a) => a.address) ?? []),
    ...(account.data?.internal.map((a) => a.address) ?? []),
  ]);

  // ISK data — runs when ISK is enabled so the tile has a balance immediately.
  const iskEnabled = enabled.includes("isk");
  const fetchIskPrice = useServerFn(getIskPriceUsd);
  const iskAccount = useQuery({
    queryKey: ["isk-account", ISK_DEFAULT_KIND, root?.neutered().toBase58().slice(0, 24)],
    enabled: !!root && !!unlocked && iskEnabled,
    queryFn: () => scanIskAccount(root!, ISK_DEFAULT_KIND),
  });
  const iskPrice = useQuery({
    queryKey: ["isk-price"],
    queryFn: () => fetchIskPrice(),
    staleTime: 10 * 60_000,
    enabled: iskEnabled,
  });
  const iskTxs = useQuery({
    queryKey: ["isk-txs", iskAccount.data?.external.map((a) => a.address).join(",")],
    enabled: !!iskAccount.data && activeChain === "isk",
    queryFn: async () => {
      const all = await Promise.all(
        [...(iskAccount.data?.external ?? []), ...(iskAccount.data?.internal ?? [])].map((a) =>
          getIskAddressTxs(a.address).catch(() => [] as IskMempoolTx[]),
        ),
      );
      const map = new Map<string, IskMempoolTx>();
      for (const list of all) for (const tx of list) map.set(tx.txid, tx);
      return [...map.values()].sort(
        (a, b) => (b.status.block_time ?? 0) - (a.status.block_time ?? 0),
      );
    },
  });
  const iskOwnAddresses = new Set([
    ...(iskAccount.data?.external.map((a) => a.address) ?? []),
    ...(iskAccount.data?.internal.map((a) => a.address) ?? []),
  ]);

  // EVM data (only for enabled EVM chains)
  const evmEnabled = enabled.filter((c) => c in EVM_CHAINS) as EvmChainId[];
  const evmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);
  // Prices are cheap and needed for portfolio total. Long stale time.
  const allPrices = useQuery({
    queryKey: ["all-prices"],
    queryFn: () => fetchAllPrices(),
    staleTime: 10 * 60_000,
    enabled: evmEnabled.length > 0,
  });
  // Native balances always run for all enabled EVM chains so the portfolio
  // total is complete on open. One RPC call each = cheap.
  const evmBalances = useQueries({
    queries: evmEnabled.map((id) => ({
      queryKey: ["evm-balance", id, evmAddress],
      enabled: !!evmAddress,
      queryFn: () => evmClient(id).getBalance({ address: evmAddress! }),
    })),
  });

  // Watch-only balances + tx history. Balance query is always on so the
  // tile shows a number without needing to swipe to it; history only fires
  // when the tile is actually the active one (single-address = 1 API call
  // either way, but we still avoid the burst on cold open with many entries).
  const watchStats = useQueries({
    queries: watchList.map((w) => ({
      queryKey: ["watch-stats", w.chain, w.address],
      queryFn: () => getAddressStats(w.address),
    })),
  });
  const activeWatchTxs = useQuery({
    queryKey: ["watch-txs", activeWatch?.address],
    enabled: !!activeWatch,
    queryFn: () => getAddressTxs(activeWatch!.address),
  });

  // Long-press to remove a watch-only entry (chain tiles use reorder sheet).
  const [watchRemove, setWatchRemove] = useState<WatchWallet | null>(null);
  const [wifRemove, setWifRemove] = useState<WifWalletEntry | null>(null);

  // Balances for imported WIF wallets — chain-aware.
  const wifStats = useQueries({
    queries: wifList.map((w) => ({
      queryKey: ["wif-stats", w.chain, w.address],
      queryFn: () => wifApi(w.chain).getAddressStats(w.address),
      staleTime: 30_000,
    })),
  });
  const activeWifTxs = useQuery({
    queryKey: ["wif-txs", activeWif?.chain, activeWif?.address],
    enabled: !!activeWif,
    queryFn: () => wifApi(activeWif!.chain).getAddressTxs(activeWif!.address),
  });

  return (
    <main className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto pb-28">
        <div className="mx-auto max-w-3xl w-full">
          {/* Swipeable chain tiles */}
          <div
            ref={scrollerRef}
            className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
            style={{ scrollbarWidth: "none" }}
          >
            {slots.map((slot, slotIdx) => {
              const key =
                slot.kind === "chain"
                  ? `c:${slot.chain}`
                  : slot.kind === "watch"
                    ? `w:${slot.watch.id}`
                    : `k:${slot.wif.id}`;
              const onLongPress =
                slot.kind === "watch"
                  ? () => setWatchRemove(slot.watch)
                  : slot.kind === "wif"
                    ? () => setWifRemove(slot.wif)
                    : undefined;
              return (
                <div
                  key={key}
                  className="snap-center shrink-0 w-full px-4 pt-6"
                  onPointerDown={() => startLongPress(onLongPress)}
                  onPointerUp={cancelLongPress}
                  onPointerMove={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {slot.kind === "chain" && slot.chain === "txc" && (
                    <TxcTile
                      balanceSats={account.data?.balanceSats ?? 0}
                      loading={account.isLoading}
                      priceUsd={price.data?.usd ?? null}
                      onRefresh={() => account.refetch()}
                      refreshing={account.isFetching}
                      label={unlocked?.label ?? "TXC Wallet"}
                      onOpenDetails={() => {
                        if (longPressFired.current) return;
                        setTileOpen("txc");
                      }}
                    />
                  )}
                  {slot.kind === "chain" && slot.chain === "isk" && (
                    <IskTile
                      balanceSats={iskAccount.data?.balanceSats ?? 0}
                      loading={iskAccount.isLoading}
                      priceUsd={iskPrice.data?.usd ?? null}
                      onRefresh={() => iskAccount.refetch()}
                      refreshing={iskAccount.isFetching}
                      label={getChainLabel("isk")}
                      onOpenDetails={() => {
                        if (longPressFired.current) return;
                        setTileOpen("isk");
                      }}
                    />
                  )}
                  {slot.kind === "chain" && slot.chain !== "txc" && slot.chain !== "isk" && (
                    <EvmTile
                      chainId={slot.chain as EvmChainId}
                      address={evmAddress}
                      label={getChainLabel(slot.chain)}
                      balanceWei={evmBalances[evmEnabled.indexOf(slot.chain as EvmChainId)]?.data ?? null}
                      loading={evmBalances[evmEnabled.indexOf(slot.chain as EvmChainId)]?.isLoading ?? true}
                      priceUsd={
                        allPrices.data?.prices?.[EVM_CHAINS[slot.chain as EvmChainId].priceSymbol] ?? null
                      }
                      onRefresh={async () => {
                        const chain = slot.chain as EvmChainId;
                        const addr = evmAddress;
                        // Refetch native balance
                        await evmBalances[evmEnabled.indexOf(chain)]?.refetch();
                        // Invalidate ERC-20 balances and tx history for this chain+address
                        await Promise.all([
                          qc.invalidateQueries({ queryKey: ["erc20-balance", chain] }),
                          qc.invalidateQueries({ queryKey: ["evm-history", chain, addr] }),
                          qc.invalidateQueries({ queryKey: ["all-prices"] }),
                        ]);
                      }}
                      onOpenDetails={() => {
                        if (longPressFired.current) return;
                        setTileOpen(slot.chain);
                      }}
                    />
                  )}
                  {slot.kind === "watch" && (
                    <WatchOnlyTile
                      wallet={slot.watch}
                      stats={watchStats[watchList.findIndex((w) => w.id === slot.watch.id)]?.data ?? null}
                      loading={
                        watchStats[watchList.findIndex((w) => w.id === slot.watch.id)]?.isLoading ?? true
                      }
                      priceUsd={price.data?.usd ?? null}
                      onRefresh={() =>
                        watchStats[watchList.findIndex((w) => w.id === slot.watch.id)]?.refetch()
                      }
                      onOpenDetails={() => {
                        if (longPressFired.current) return;
                        setActiveIdx(slotIdx);
                        setWatchRemove(slot.watch);
                      }}
                    />
                  )}
                  {slot.kind === "wif" && (
                    <WifTile
                      entry={slot.wif}
                      stats={wifStats[wifList.findIndex((w) => w.id === slot.wif.id)]?.data ?? null}
                      loading={
                        wifStats[wifList.findIndex((w) => w.id === slot.wif.id)]?.isLoading ?? true
                      }
                      priceUsd={
                        slot.wif.chain === "txc"
                          ? price.data?.usd ?? null
                          : iskPrice.data?.usd ?? null
                      }
                      onRefresh={() =>
                        wifStats[wifList.findIndex((w) => w.id === slot.wif.id)]?.refetch()
                      }
                      onOpenDetails={() => {
                        if (longPressFired.current) return;
                        setActiveIdx(slotIdx);
                      }}
                    />
                  )}
                </div>
              );
            })}

          </div>

          {/* Dots indicator */}
          {slots.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-3">
              {slots.map((s, i) => (
                <span
                  key={s.kind === "chain" ? `c:${s.chain}` : s.kind === "watch" ? `w:${s.watch.id}` : `k:${s.wif.id}`}
                  className={`h-1.5 rounded-full transition-all ${
                    i === activeIdx ? "w-6 bg-foreground" : "w-1.5 bg-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Recent activity (TXC only for now) */}
          {activeChain === "txc" && !activeWatch && !activeWif && (
            <TxcTokens addresses={[...ownAddresses]} />
          )}
          {/* Recent activity (TXC only for now) */}
          {activeChain === "txc" && !activeWatch && !activeWif && (
            <section className="mt-8 px-4">
              <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
              {account.isLoading || txs.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : account.isError ? (
                <Card>
                  <CardContent className="pt-6 text-sm text-muted-foreground">
                    Couldn't reach mempool.texitcoin.org.{" "}
                    <button className="underline" onClick={() => account.refetch()}>
                      try again
                    </button>
                    .
                  </CardContent>
                </Card>
              ) : (txs.data?.length ?? 0) === 0 ? (
                <Card>
                  <CardContent className="pt-6 text-sm text-muted-foreground">
                    No transactions yet.
                  </CardContent>
                </Card>
              ) : (
                <ul className="space-y-2">
                  {txs.data!.slice(0, 50).map((tx) => {
                    const inSum = tx.vin
                      .filter((v) => v.prevout.scriptpubkey_address && ownAddresses.has(v.prevout.scriptpubkey_address))
                      .reduce((s, v) => s + v.prevout.value, 0);
                    const outToOwn = tx.vout
                      .filter((v) => v.scriptpubkey_address && ownAddresses.has(v.scriptpubkey_address))
                      .reduce((s, v) => s + v.value, 0);
                    const net = outToOwn - inSum;
                    const incoming = net > 0;
                    return (
                      <li key={tx.txid}>
                        <button
                          type="button"
                          onClick={() => setDetail({ kind: "txc", tx, net, incoming })}
                          className="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3 hover:bg-card transition-colors text-left"
                        >
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center ${
                              incoming ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                            }`}
                          >
                            {incoming ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{incoming ? "Received" : "Sent"}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {tx.status.confirmed
                                ? new Date((tx.status.block_time ?? 0) * 1000).toLocaleString()
                                : "Pending"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${incoming ? "text-emerald-400" : ""}`}>
                              {incoming ? "+" : "−"}
                              {formatTxc(Math.abs(net))}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
          {activeChain === "isk" && !activeWatch && !activeWif && (
            <IskActivity
              loading={iskAccount.isLoading || iskTxs.isLoading}
              error={iskAccount.isError}
              txs={iskTxs.data ?? null}
              ownAddresses={iskOwnAddresses}
              onRefresh={() => iskAccount.refetch()}
            />
          )}
          {activeChain !== "txc" && activeChain !== "isk" && activeChain in EVM_CHAINS && !activeWatch && !activeWif && (
            <EvmActivity
              chainId={activeChain as EvmChainId}
              address={evmAddress}
              onOpen={(t) => setDetail({ kind: "evm", chain: activeChain as EvmChainId, transfer: t })}
            />
          )}
          {activeChain !== "txc" && activeChain !== "isk" && !(activeChain in EVM_CHAINS) && !activeWatch && !activeWif && (
            <section className="mt-8 px-4">
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  {CHAIN_META[activeChain].name} support is coming soon.
                </CardContent>
              </Card>
            </section>
          )}
          {activeWatch && (
            <WatchOnlyActivity
              wallet={activeWatch}
              txs={activeWatchTxs.data ?? null}
              loading={activeWatchTxs.isLoading}
              error={activeWatchTxs.isError}
              onRefresh={() => activeWatchTxs.refetch()}
              onOpen={(tx, net, incoming) => setDetail({ kind: "txc", tx, net, incoming })}
            />
          )}
          {activeWif && (
            <WifActivity
              entry={activeWif}
              txs={activeWifTxs.data ?? null}
              loading={activeWifTxs.isLoading}
              error={activeWifTxs.isError}
              onRefresh={() => activeWifTxs.refetch()}
            />
          )}
        </div>
      </div>

      {/* Fixed bottom send/receive — routes based on the active slot */}
      <div className="fixed bottom-0 inset-x-0 z-10 border-t border-border/60 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto max-w-3xl px-4 py-3 flex gap-2">
          {activeWatch ? (
            <WatchOnlyBottomActions wallet={activeWatch} />
          ) : activeWif ? (
            <WifBottomActions entry={activeWif} />
          ) : (
            <BottomActions chain={activeChain} />
          )}
        </div>
      </div>
      <TxDetailSheet detail={detail} onClose={() => setDetail(null)} />
      <ReorderTilesSheet open={reorderOpen} onClose={() => setReorderOpen(false)} />
      <WifRemoveDialog entry={wifRemove} onClose={() => setWifRemove(null)} />
      {tileOpen === "txc" && (
        <WalletDetailSheet
          open
          onClose={() => setTileOpen(null)}
          kind="txc"
          balanceText={`${formatTxc(account.data?.balanceSats ?? 0)} TXC`}
          fiatText={
            price.data?.usd != null
              ? formatFiat(satsToTxc(account.data?.balanceSats ?? 0) * price.data.usd)
              : null
          }
          receiveAddress={account.data?.nextReceiveAddress ?? null}
          txCount={txs.data?.length ?? null}
        />
      )}
      {tileOpen === "isk" && (
        <WalletDetailSheet
          open
          onClose={() => setTileOpen(null)}
          kind="isk"
          balanceText={`${formatIsk(iskAccount.data?.balanceSats ?? 0)}`}
          fiatText={
            iskPrice.data?.usd != null
              ? formatFiat(satsToIsk(iskAccount.data?.balanceSats ?? 0) * iskPrice.data.usd)
              : null
          }
          receiveAddress={iskAccount.data?.nextReceiveAddress ?? null}
          txCount={iskTxs.data?.length ?? null}
        />
      )}
      {tileOpen && tileOpen !== "txc" && tileOpen !== "isk" && tileOpen in EVM_CHAINS && (
        <WalletDetailSheet
          open
          onClose={() => setTileOpen(null)}
          kind="evm"
          chainId={tileOpen as EvmChainId}
          address={evmAddress}
          balanceText={(() => {
            const idx = evmEnabled.indexOf(tileOpen as EvmChainId);
            const wei = evmBalances[idx]?.data ?? null;
            const sym = EVM_CHAINS[tileOpen as EvmChainId].nativeSymbol;
            return `${wei != null ? formatEth(wei) : "0"} ${sym}`;
          })()}
          fiatText={(() => {
            const idx = evmEnabled.indexOf(tileOpen as EvmChainId);
            const wei = evmBalances[idx]?.data ?? null;
            const p = allPrices.data?.prices?.[EVM_CHAINS[tileOpen as EvmChainId].priceSymbol];
            if (wei == null || p == null) return null;
            return formatFiat((Number(wei) / 1e18) * p);
          })()}
        />
      )}
      <WatchRemoveDialog wallet={watchRemove} onClose={() => setWatchRemove(null)} />
    </main>
  );
}

function BottomActions({ chain }: { chain: ChainId }) {
  if (chain === "txc") {
    return (
      <>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <Link to="/wallet/receive">
            <QrCode className="h-4 w-4 mr-2" /> Receive
          </Link>
        </Button>
        <Button asChild size="lg" className="flex-1">
          <Link to="/wallet/send">
            <Send className="h-4 w-4 mr-2" /> Send
          </Link>
        </Button>
      </>
    );
  }
  if (chain === "isk") {
    return (
      <>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <Link to="/wallet/isk/receive">
            <QrCode className="h-4 w-4 mr-2" /> Receive
          </Link>
        </Button>
        <Button asChild size="lg" className="flex-1">
          <Link to="/wallet/isk/send">
            <Send className="h-4 w-4 mr-2" /> Send
          </Link>
        </Button>
      </>
    );
  }
  if (chain in EVM_CHAINS) {
    const c = chain as EvmChainId;
    return (
      <>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <Link to="/wallet/evm/$chain/receive" params={{ chain: c }}>
            <QrCode className="h-4 w-4 mr-2" /> Receive
          </Link>
        </Button>
        <Button asChild size="lg" className="flex-1">
          <Link to="/wallet/evm/$chain/send" params={{ chain: c }}>
            <Send className="h-4 w-4 mr-2" /> Send
          </Link>
        </Button>
      </>
    );
  }


  return (
    <>
      <Button size="lg" variant="outline" disabled className="flex-1">
        <QrCode className="h-4 w-4 mr-2" /> Coming soon
      </Button>
      <Button size="lg" disabled className="flex-1">
        <Send className="h-4 w-4 mr-2" /> Coming soon
      </Button>
    </>
  );
}

function TxcTile({
  balanceSats,
  loading,
  priceUsd,
  onRefresh,
  refreshing,
  label,
  onOpenDetails,
}: {
  balanceSats: number;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void;
  refreshing: boolean;
  label: string;
  onOpenDetails: () => void;
}) {
  const [hidden] = useHideBalances();
  const balanceUsd = priceUsd ? satsToTxc(balanceSats) * priceUsd : null;
  const balText = loading ? "..." : formatTxcCompact(balanceSats);
  const fiatText = balanceUsd != null ? formatFiat(balanceUsd) : "Price unavailable";
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="w-full text-left rounded-2xl bg-gradient-to-br from-amber-600 via-orange-700 to-amber-900 p-6 text-white shadow-xl shadow-amber-950/30 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-amber-100/80">{label}</p>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          className="text-amber-100/80 hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </span>
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-widest text-amber-100/70">Native</p>
      <p className="mt-0.5 text-4xl font-bold tracking-tight">
        {hidden ? maskAmount(balText) : balText}
        <span className="ml-2 text-2xl font-semibold opacity-90">TXC</span>
      </p>
      <p className="text-amber-100/80 text-sm">
        {hidden ? maskAmount(fiatText) : fiatText}
      </p>
      <div className="mt-3 pt-3 border-t border-white/15">
        <p className="text-[10px] uppercase tracking-widest text-amber-100/70">Chain total</p>
        <p className="text-lg font-semibold">
          {hidden ? maskAmount(fiatText) : fiatText}
        </p>
      </div>
    </button>
  );
}

function TxcTokens({ addresses }: { addresses: string[] }) {
  const tokens = useEnabledTxcTokens();
  const fetchBalances = useServerFn(getTxcTokenBalancesForAddresses);
  const [hideSpam] = useFeature("hideSpamTokens");
  const [hidden] = useHideBalances();
  const enabled = addresses.length > 0 && tokens.length > 0;
  const balances = useQuery({
    queryKey: [
      "txc-token-balances",
      addresses.slice().sort().join(","),
      tokens.map((t) => t.id).join(","),
    ],
    enabled,
    queryFn: () =>
      fetchBalances({
        data: { addresses, propertyIds: tokens.map((t) => t.id) },
      }),
    staleTime: 30_000,
  });

  if (!enabled) return null;

  const rows = tokens.map((t) => {
    const raw = balances.data?.[t.id] ?? "0";
    const units = BigInt(raw);
    return { token: t, units };
  });
  const visible = hideSpam
    ? rows.filter((r) => balances.isLoading || r.units > 0n)
    : rows;
  const hiddenCount = rows.length - visible.length;

  return (
    <section className="mt-8 px-4">
      <h2 className="text-lg font-semibold mb-3">TXC tokens</h2>
      <ul className="space-y-2">
        {visible.map(({ token: t, units }) => {
          const amtStr = formatTokenAmount(units, t.divisible);
          return (
            <li key={t.id}>
              <Link
                to="/wallet/send"
                search={{ token: String(t.id) }}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3 hover:bg-card transition-colors"
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-amber-500/15 text-amber-300">
                  {t.symbol.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{t.symbol}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {t.name ?? "Omni #" + t.id} · #{t.id}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    {balances.isLoading && !balances.data
                      ? "…"
                      : hidden
                        ? maskAmount(amtStr)
                        : amtStr}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {balances.isError && !balances.data ? "unavailable" : "—"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
        {hideSpam && hiddenCount > 0 && (
          <li className="text-xs text-muted-foreground text-center pt-1">
            {hiddenCount} zero-balance {hiddenCount === 1 ? "token" : "tokens"} hidden
          </li>
        )}
      </ul>
    </section>
  );
}

function IskTile({
  balanceSats,
  loading,
  priceUsd,
  onRefresh,
  refreshing,
  label,
  onOpenDetails,
}: {
  balanceSats: number;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void;
  refreshing: boolean;
  label: string;
  onOpenDetails: () => void;
}) {
  const [hidden] = useHideBalances();
  const balanceUsd = priceUsd ? satsToIsk(balanceSats) * priceUsd : null;
  const balText = loading ? "..." : formatIskCompact(balanceSats);
  const fiatText = balanceUsd != null ? formatFiat(balanceUsd) : "Price unavailable";
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="w-full text-left rounded-2xl bg-gradient-to-br from-emerald-500 via-green-700 to-emerald-900 p-6 text-white shadow-xl shadow-emerald-950/30 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-emerald-50/80">{label}</p>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          className="text-emerald-50/80 hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </span>
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-widest text-emerald-50/70">Native</p>
      <p className="mt-0.5 text-4xl font-bold tracking-tight">
        {hidden ? maskAmount(balText) : balText}
        <span className="ml-2 text-2xl font-semibold opacity-90">ISK</span>
      </p>
      <p className="text-emerald-50/80 text-sm">
        {hidden ? maskAmount(fiatText) : fiatText}
      </p>
      <div className="mt-3 pt-3 border-t border-white/15">
        <p className="text-[10px] uppercase tracking-widest text-emerald-50/70">Chain total</p>
        <p className="text-lg font-semibold">
          {hidden ? maskAmount(fiatText) : fiatText}
        </p>
      </div>
    </button>
  );
}

function IskActivity({
  loading,
  error,
  txs,
  ownAddresses,
  onRefresh,
}: {
  loading: boolean;
  error: boolean;
  txs: IskMempoolTx[] | null;
  ownAddresses: Set<string>;
  onRefresh: () => void;
}) {
  return (
    <section className="mt-8 px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        <button
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={onRefresh}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {loading && !txs ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Couldn't reach mempool.iskandercoin.com.
          </CardContent>
        </Card>
      ) : (txs?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No IskanderCoin transactions yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {txs!.slice(0, 50).map((tx) => {
            const inSum = tx.vin
              .filter(
                (v) =>
                  v.prevout.scriptpubkey_address &&
                  ownAddresses.has(v.prevout.scriptpubkey_address),
              )
              .reduce((s, v) => s + v.prevout.value, 0);
            const outToOwn = tx.vout
              .filter(
                (v) =>
                  v.scriptpubkey_address && ownAddresses.has(v.scriptpubkey_address),
              )
              .reduce((s, v) => s + v.value, 0);
            const net = outToOwn - inSum;
            const incoming = net > 0;
            return (
              <li key={tx.txid}>
                <div className="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      incoming
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {incoming ? (
                      <ArrowDown className="h-4 w-4" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{incoming ? "Received" : "Sent"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {tx.status.confirmed
                        ? new Date((tx.status.block_time ?? 0) * 1000).toLocaleString()
                        : "Pending"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${incoming ? "text-emerald-400" : ""}`}
                    >
                      {incoming ? "+" : "−"}
                      {formatIsk(Math.abs(net))}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}



function EvmTile({
  chainId,
  address,
  label,
  balanceWei,
  loading,
  priceUsd,
  onRefresh,
  onOpenDetails,
}: {
  chainId: EvmChainId;
  address: string | null;
  label: string;
  balanceWei: bigint | null;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void | Promise<void>;
  onOpenDetails: () => void;
}) {
  const [hidden] = useHideBalances();
  const [refreshing, setRefreshing] = useState(false);
  const [swapEnabled] = useFeature("evmSwap");


  const meta = EVM_CHAINS[chainId];
  const balanceEth = balanceWei != null ? Number(balanceWei) / 1e18 : null;
  const balanceUsd = balanceEth != null && priceUsd != null ? balanceEth * priceUsd : null;
  const rawEthText = balanceWei != null ? formatEth(balanceWei) : "0";
  const compactEthText = compactNumberString(rawEthText, 10, 5);
  const balText = loading ? "..." : `${compactEthText} ${meta.nativeSymbol}`;
  const fiatText =
    balanceUsd != null ? formatFiat(balanceUsd) : priceUsd == null ? "Price unavailable" : "—";

  // Token balances on this chain (USDC/USDT are ~$1 stables — safe to treat as USD 1:1)
  const tokens = useTokensForChain(chainId);
  const tokenBalances = useQueries({
    queries: tokens.map((t) => ({
      queryKey: ["erc20-balance", chainId, t.address, address],
      enabled: !!address,
      queryFn: () => readErc20Balance(chainId, t, address as `0x${string}`),
      staleTime: 30_000,
    })),
  });
  const tokensUsd = tokens.reduce((sum, t, i) => {
    const raw = tokenBalances[i]?.data ?? 0n;
    if (raw <= 0n) return sum;
    const amt = Number(tokenAmountFromRaw(raw, t.decimals));
    // Stables are USD-pegged; if we ever add non-stable ERC-20s, price them here.
    return sum + amt;
  }, 0);
  const chainTotalUsd =
    balanceUsd != null || tokensUsd > 0 ? (balanceUsd ?? 0) + tokensUsd : null;
  const chainTotalText = chainTotalUsd != null ? formatFiat(chainTotalUsd) : "—";

  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="w-full text-left rounded-2xl p-6 text-white shadow-xl active:scale-[0.99] transition-transform"
      style={{ background: `linear-gradient(135deg, ${meta.accent} 0%, ${meta.accent}CC 60%, #111 140%)` }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm opacity-80 truncate">{label}</p>
        <div className="flex items-center gap-2">
          {swapEnabled && (
            <Link
              to="/wallet/evm/$chain/swap"
              params={{ chain: chainId }}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-2.5 py-1 text-[11px] font-medium"
              aria-label="Swap"
            >
              <ArrowLeftRight className="h-3 w-3" /> Swap
            </Link>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={async (e) => {
              e.stopPropagation();
              if (refreshing) return;
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
            className="opacity-80 hover:opacity-100"
            aria-label="Refresh"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing || loading ? "animate-spin" : ""}`}
            />
          </span>
        </div>
      </div>


      <p className="mt-3 text-[10px] uppercase tracking-widest opacity-70">Native</p>
      <p className="mt-0.5 text-4xl font-bold tracking-tight">
        {hidden ? maskAmount(balText) : balText}
      </p>
      <p className="text-sm opacity-80">{hidden ? maskAmount(fiatText) : fiatText}</p>
      <div className="mt-3 pt-3 border-t border-white/15">
        <p className="text-[10px] uppercase tracking-widest opacity-70">Chain total</p>
        <p className="text-lg font-semibold">
          {hidden ? maskAmount(chainTotalText) : chainTotalText}
        </p>
      </div>
    </button>
  );
}

function EvmActivity({
  chainId,
  address,
  onOpen,
}: {
  chainId: EvmChainId;
  address: string | null;
  onOpen: (t: import("@/lib/chains/history.functions").EvmTransfer) => void;
}) {
  const meta = EVM_CHAINS[chainId];
  const fetchHistory = useServerFn(getEvmHistory);
  const tokens = useTokensForChain(chainId);

  const tokenBalances = useQueries({
    queries: tokens.map((t) => ({
      queryKey: ["erc20-balance", chainId, t.address, address],
      enabled: !!address,
      queryFn: () => readErc20Balance(chainId, t, address as `0x${string}`),
      staleTime: 30_000,
      retry: 3,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
    })),
  });

  const history = useQuery({
    queryKey: ["evm-history", chainId, address],
    enabled: !!address,
    queryFn: () => fetchHistory({ data: { chain: chainId, address: address! } }),
  });
  const [hideSpam] = useFeature("hideSpamTokens");
  const visibleTokens = useMemo(() => {
    if (!hideSpam) return tokens.map((t, i) => ({ token: t, index: i }));
    return tokens
      .map((t, i) => ({ token: t, index: i }))
      .filter(({ index }) => {
        const q = tokenBalances[index];
        // Hide zero balances only after the query settles — avoid flicker while loading.
        if (q?.isLoading || q?.isError) return true;
        return (q?.data ?? 0n) > 0n;
      });
  }, [tokens, tokenBalances, hideSpam]);
  const hiddenTokenCount = tokens.length - visibleTokens.length;
  const visibleTransfers = useMemo(() => {
    const list = history.data?.transfers ?? [];
    return hideSpam ? list.filter((t) => !t.spam) : list;
  }, [history.data, hideSpam]);
  const spamCount = (history.data?.transfers.length ?? 0) - visibleTransfers.length;

  return (
    <>
      <section className="mt-8 px-4">
        <h2 className="text-lg font-semibold mb-3">Tokens</h2>
        <ul className="space-y-2">
          {visibleTokens.map(({ token: t, index: i }) => {
            const q = tokenBalances[i];
            const raw = q?.data ?? 0n;
            const amt = raw > 0n ? tokenAmountFromRaw(raw, t.decimals) : "0";
            const isStable = t.symbol.startsWith("USD");
            const accent =
              t.symbol === "USDC"
                ? "bg-blue-500/15 text-blue-400"
                : t.symbol === "USDT"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-muted text-foreground";
            return (
              <li key={t.address}>
                <Link
                  to="/wallet/evm/$chain/send"
                  params={{ chain: chainId }}
                  search={{ asset: t.symbol }}
                  className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3 hover:bg-card transition-colors"
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${accent}`}>
                    $
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t.symbol}</p>
                    <p className="text-xs text-muted-foreground">on {meta.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {q?.isLoading && q?.data == null ? "…" : Number(amt).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {q?.data == null && q?.isError ? "unavailable" : isStable ? formatFiat(Number(amt)) : "—"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
          {hideSpam && hiddenTokenCount > 0 && (
            <li className="text-xs text-muted-foreground text-center pt-1">
              {hiddenTokenCount} zero-balance {hiddenTokenCount === 1 ? "token" : "tokens"} hidden
            </li>
          )}
        </ul>
      </section>


      <section className="mt-6 px-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <button
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            onClick={() => history.refetch()}
          >
            <RefreshCw className={`h-3 w-3 ${history.isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        {history.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : !history.data?.supported ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              History for {meta.name} isn't indexed here yet.{" "}
              {address && (
                <a
                  href={meta.explorerAddress(address)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Open in {meta.shortName} explorer
                </a>
              )}
            </CardContent>
          </Card>
        ) : visibleTransfers.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {spamCount > 0
                ? `${spamCount} spam / imposter ${spamCount === 1 ? "transfer" : "transfers"} hidden. Toggle "Hide worthless / spam tokens" in Settings to view.`
                : `No transactions on ${meta.name} yet.`}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {visibleTransfers.map((t) => (
              <li key={`${t.hash}-${t.category}-${t.outgoing ? "o" : "i"}`}>
                <button
                  type="button"
                  onClick={() => onOpen(t)}
                  className="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3 hover:bg-card transition-colors text-left"
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      t.outgoing ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"
                    }`}
                  >
                    {t.outgoing ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {t.outgoing ? "Sent" : "Received"}
                      {t.spam && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400/80">
                          suspicious
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.timestamp ? new Date(t.timestamp).toLocaleString() : `Block ${t.blockNum}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${t.outgoing ? "" : "text-emerald-400"}`}>
                      {t.outgoing ? "−" : "+"}
                      {Number(t.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} {t.asset}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            ))}
            {hideSpam && spamCount > 0 && (
              <li className="pt-1 text-center text-xs text-muted-foreground">
                {spamCount} spam / imposter {spamCount === 1 ? "transfer" : "transfers"} hidden
              </li>
            )}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * Watch-only tile. Distinct dark/slate treatment + Eye badge so it reads at a
 * glance as "look but don't touch" — no send button, no key material.
 */
function WatchOnlyTile({
  wallet,
  stats,
  loading,
  priceUsd,
  onRefresh,
  onOpenDetails,
}: {
  wallet: WatchWallet;
  stats: import("@/lib/txc/mempool").MempoolAddressStats | null;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void;
  onOpenDetails: () => void;
}) {
  const [hidden] = useHideBalances();
  const balSats = stats
    ? stats.chain_stats.funded_txo_sum -
      stats.chain_stats.spent_txo_sum +
      stats.mempool_stats.funded_txo_sum -
      stats.mempool_stats.spent_txo_sum
    : 0;
  const balUsd = priceUsd != null ? satsToTxc(balSats) * priceUsd : null;
  const balText = loading && !stats ? "..." : formatTxcCompact(balSats);
  const fiatText = balUsd != null ? formatFiat(balUsd) : "Price unavailable";
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="w-full text-left rounded-2xl p-6 text-white shadow-xl shadow-black/40 active:scale-[0.99] transition-transform relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #1f2937 0%, #0f172a 55%, #000 140%)",
      }}
    >
      {/* subtle diagonal hatch so watch-only reads differently from live tiles */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 10px)",
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
              <Eye className="h-3 w-3" /> Watch-only
            </span>
            <p className="text-sm text-white/80 truncate">{wallet.label}</p>
          </div>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            className="text-white/70 hover:text-white"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </span>
        </div>
        <p className="mt-2 text-4xl font-bold tracking-tight">
          {hidden ? maskAmount(balText) : balText}
          <span className="ml-2 text-2xl font-semibold opacity-90">TXC</span>
        </p>
        <p className="text-white/70 text-sm">{hidden ? maskAmount(fiatText) : fiatText}</p>
        <p className="mt-3 text-[11px] font-mono text-white/50 truncate">
          {wallet.address}
        </p>
      </div>
    </button>
  );
}

/**
 * Activity list for a watch-only address. We only know one address, so
 * incoming/outgoing is inferred by whether that address appears in vouts
 * (received) or as an input's prevout (spent).
 */
function WatchOnlyActivity({
  wallet,
  txs,
  loading,
  error,
  onRefresh,
  onOpen,
}: {
  wallet: WatchWallet;
  txs: MempoolTx[] | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  onOpen: (tx: MempoolTx, net: number, incoming: boolean) => void;
}) {
  const own = wallet.address;
  return (
    <section className="mt-8 px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        <button
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={onRefresh}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {loading && !txs ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Couldn't reach mempool.texitcoin.org.
          </CardContent>
        </Card>
      ) : (txs?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No transactions on this address yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {txs!.slice(0, 50).map((tx) => {
            const inSum = tx.vin
              .filter((v) => v.prevout.scriptpubkey_address === own)
              .reduce((s, v) => s + v.prevout.value, 0);
            const outToOwn = tx.vout
              .filter((v) => v.scriptpubkey_address === own)
              .reduce((s, v) => s + v.value, 0);
            const net = outToOwn - inSum;
            const incoming = net > 0;
            return (
              <li key={tx.txid}>
                <button
                  type="button"
                  onClick={() => onOpen(tx, net, incoming)}
                  className="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3 hover:bg-card transition-colors text-left"
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      incoming
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {incoming ? (
                      <ArrowDown className="h-4 w-4" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{incoming ? "Received" : "Sent"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {tx.status.confirmed
                        ? new Date((tx.status.block_time ?? 0) * 1000).toLocaleString()
                        : "Pending"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${incoming ? "text-emerald-400" : ""}`}
                    >
                      {incoming ? "+" : "−"}
                      {formatTxc(Math.abs(net))}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Bottom actions when a watch-only tile is active. Receive shows the address
 * (people scanning a Cold Storage Coin often want to display it again to a
 * payer); Send is intentionally disabled — we don't hold the key.
 */
function WatchOnlyBottomActions({ wallet }: { wallet: WatchWallet }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" variant="outline" onClick={() => setOpen(true)}>
        <QrCode className="h-4 w-4 mr-2" /> Show address
      </Button>
      <Button size="lg" disabled title="Watch-only wallets cannot send">
        <Lock className="h-4 w-4 mr-2" /> Watch-only
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" /> {wallet.label}
            </DialogTitle>
            <DialogDescription>
              Watch-only address. Share to receive TXC — signing must happen on the
              device that holds the key (e.g. your Cold Storage Coin).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-lg bg-white p-3">
              <QrCodeSvg value={wallet.address} size={220} />
            </div>
            <code className="text-xs break-all text-center px-2">{wallet.address}</code>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Confirm removing a watch-only entry. Since no key material is stored, this
 * is purely cosmetic — the address on-chain is untouched — but we still ask
 * before deleting so a stray long-press doesn't nuke someone's tile.
 */
function WatchRemoveDialog({
  wallet,
  onClose,
}: {
  wallet: WatchWallet | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!wallet} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{wallet?.label ?? "Watch-only wallet"}</DialogTitle>
          <DialogDescription>
            Watch-only · {wallet?.chain.toUpperCase()}
          </DialogDescription>
        </DialogHeader>
        {wallet && (
          <div className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Address
              </p>
              <p className="font-mono text-xs break-all rounded-md border border-border/60 bg-card/40 px-3 py-2">
                {wallet.address}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Removing only deletes the tile from this app. The address itself
              is not affected on-chain — you can add it back anytime.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (wallet) removeWatchWallet(wallet.id);
              onClose();
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Tile for an imported single-key (WIF) wallet. Colored per chain, with a
 * "Key" chip so it reads visually distinct from HD-derived tiles.
 */
function WifTile({
  entry,
  stats,
  loading,
  priceUsd,
  onRefresh,
  onOpenDetails,
}: {
  entry: WifWalletEntry;
  stats: import("@/lib/txc/mempool").MempoolAddressStats | null;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void;
  onOpenDetails: () => void;
}) {
  const [hidden] = useHideBalances();
  const balSats = stats
    ? stats.chain_stats.funded_txo_sum -
      stats.chain_stats.spent_txo_sum +
      stats.mempool_stats.funded_txo_sum -
      stats.mempool_stats.spent_txo_sum
    : 0;
  const isIsk = entry.chain === "isk";
  const balCoins = isIsk ? satsToIsk(balSats) : satsToTxc(balSats);
  const balUsd = priceUsd != null ? balCoins * priceUsd : null;
  const balText = loading && !stats
    ? "..."
    : isIsk
      ? formatIskCompact(balSats)
      : formatTxcCompact(balSats);
  const fiatText = balUsd != null ? formatFiat(balUsd) : "Price unavailable";
  const symbol = isIsk ? "ISK" : "TXC";
  const bg = isIsk
    ? "linear-gradient(135deg, #065f46 0%, #064e3b 55%, #022c22 140%)"
    : "linear-gradient(135deg, #4c1d95 0%, #312e81 55%, #1e1b4b 140%)";
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="w-full text-left rounded-2xl p-6 text-white shadow-xl shadow-black/40 active:scale-[0.99] transition-transform relative overflow-hidden"
      style={{ background: bg }}
    >
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
              <Key className="h-3 w-3" /> Imported key
            </span>
            <p className="text-sm text-white/80 truncate">{entry.label}</p>
          </div>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            className="text-white/70 hover:text-white"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </span>
        </div>
        <p className="mt-2 text-4xl font-bold tracking-tight">
          {hidden ? maskAmount(balText) : balText}
          <span className="ml-2 text-2xl font-semibold opacity-90">{symbol}</span>
        </p>
        <p className="text-white/70 text-sm">{hidden ? maskAmount(fiatText) : fiatText}</p>
        <p className="mt-3 text-[11px] font-mono text-white/50 truncate">{entry.address}</p>
      </div>
    </button>
  );
}

/**
 * Activity feed for a WIF wallet — same shape as the watch-only view since
 * we're inspecting a single address on a single chain.
 */
function WifActivity({
  entry,
  txs,
  loading,
  error,
  onRefresh,
}: {
  entry: WifWalletEntry;
  txs: MempoolTx[] | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
}) {
  const own = entry.address;
  const isIsk = entry.chain === "isk";
  const fmt = (n: number) => (isIsk ? formatIsk(n) : formatTxc(n));
  return (
    <section className="mt-8 px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        <button
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={onRefresh}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {loading && !txs ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Couldn't reach the {isIsk ? "ISK" : "TXC"} mempool.
          </CardContent>
        </Card>
      ) : (txs?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No transactions on this address yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {txs!.slice(0, 50).map((tx) => {
            const inSum = tx.vin
              .filter((v) => v.prevout.scriptpubkey_address === own)
              .reduce((s, v) => s + v.prevout.value, 0);
            const outToOwn = tx.vout
              .filter((v) => v.scriptpubkey_address === own)
              .reduce((s, v) => s + v.value, 0);
            const net = outToOwn - inSum;
            const incoming = net > 0;
            return (
              <li key={tx.txid}>
                <div className="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      incoming
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {incoming ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{incoming ? "Received" : "Sent"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {tx.status.confirmed
                        ? new Date((tx.status.block_time ?? 0) * 1000).toLocaleString()
                        : "Pending"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${incoming ? "text-emerald-400" : ""}`}>
                      {incoming ? "+" : "−"}
                      {fmt(Math.abs(net))}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Bottom actions when a WIF tile is active — routes to the dedicated
 * per-entry send/receive screens.
 */
function WifBottomActions({ entry }: { entry: WifWalletEntry }) {
  return (
    <>
      <Button asChild size="lg" variant="outline">
        <Link to="/wallet/wif/$id/receive" params={{ id: entry.id }}>
          <QrCode className="h-4 w-4 mr-2" /> Receive
        </Link>
      </Button>
      <Button asChild size="lg">
        <Link to="/wallet/wif/$id/send" params={{ id: entry.id }}>
          <Send className="h-4 w-4 mr-2" /> Send
        </Link>
      </Button>
    </>
  );
}

/**
 * Confirm removing an imported key. This deletes the encrypted WIF and the
 * tile — funds remain on-chain, but you'll need the original private key to
 * spend them again. We spell that out loudly.
 */
function WifRemoveDialog({
  entry,
  onClose,
}: {
  entry: WifWalletEntry | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry?.label ?? "Imported key"}</DialogTitle>
          <DialogDescription>
            Imported private key · {entry?.chain.toUpperCase()}
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Address
              </p>
              <p className="font-mono text-xs break-all rounded-md border border-border/60 bg-card/40 px-3 py-2">
                {entry.address}
              </p>
            </div>
            <p className="text-xs text-rose-400">
              Removing deletes the encrypted key stored in this app. If you don't
              have the original WIF written down elsewhere, you will lose access
              to any funds at this address.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (entry) removeWifWallet(entry.id);
              onClose();
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
