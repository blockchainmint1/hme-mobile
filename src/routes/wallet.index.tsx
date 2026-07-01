import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { formatTxc, formatTxcCompact, formatFiat, satsToTxc, compactNumberString } from "@/lib/txc/units";
import { getTxcPriceUsd } from "@/lib/txc/price.functions";
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { getEvmHistory } from "@/lib/chains/history.functions";
import { readErc20Balance, tokenAmountFromRaw, USDC_BY_CHAIN } from "@/lib/chains/erc20";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDown, ArrowUp, ChevronRight, RefreshCw, Send, QrCode, Eye, Trash2, Lock } from "lucide-react";
import { getAddressStats, getAddressTxs, type MempoolTx } from "@/lib/txc/mempool";
import { getEnabledChains, CHAIN_META, type ChainId } from "@/lib/chain-prefs";
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

  // Unified carousel item list — chains first, then watch-only.
  type Slot = { kind: "chain"; chain: ChainId } | { kind: "watch"; watch: WatchWallet };
  const slots: Slot[] = useMemo(
    () => [
      ...enabled.map((c) => ({ kind: "chain" as const, chain: c })),
      ...watchList.map((w) => ({ kind: "watch" as const, watch: w })),
    ],
    [enabled, watchList],
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

  // Selected transaction (opens in-page detail sheet)
  const [detail, setDetail] = useState<TxDetail | null>(null);
  // Which wallet tile's details are open
  const [tileOpen, setTileOpen] = useState<ChainId | null>(null);
  // Long-press to rearrange
  const [reorderOpen, setReorderOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const startLongPress = () => {
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
      setReorderOpen(true);
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
              const key = slot.kind === "chain" ? `c:${slot.chain}` : `w:${slot.watch.id}`;
              const onLongPress =
                slot.kind === "watch"
                  ? () => {
                      longPressFired.current = true;
                      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
                      setWatchRemove(slot.watch);
                    }
                  : () => setReorderOpen(true);
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
                  {slot.kind === "chain" && slot.chain !== "txc" && (
                    <EvmTile
                      chainId={slot.chain as EvmChainId}
                      balanceWei={evmBalances[evmEnabled.indexOf(slot.chain as EvmChainId)]?.data ?? null}
                      loading={evmBalances[evmEnabled.indexOf(slot.chain as EvmChainId)]?.isLoading ?? true}
                      priceUsd={
                        allPrices.data?.prices[EVM_CHAINS[slot.chain as EvmChainId].priceSymbol] ?? null
                      }
                      onRefresh={() =>
                        evmBalances[evmEnabled.indexOf(slot.chain as EvmChainId)]?.refetch()
                      }
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
                        // Scroll into view for tap-select if needed
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
                  key={s.kind === "chain" ? `c:${s.chain}` : `w:${s.watch.id}`}
                  className={`h-1.5 rounded-full transition-all ${
                    i === activeIdx ? "w-6 bg-foreground" : "w-1.5 bg-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Recent activity (TXC only for now) */}
          {activeChain === "txc" && (
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
          {activeChain !== "txc" && activeChain in EVM_CHAINS && (
            <EvmActivity
              chainId={activeChain as EvmChainId}
              address={evmAddress}
              onOpen={(t) => setDetail({ kind: "evm", chain: activeChain as EvmChainId, transfer: t })}
            />
          )}
          {activeChain !== "txc" && !(activeChain in EVM_CHAINS) && (
            <section className="mt-8 px-4">
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  {CHAIN_META[activeChain].name} support is coming soon.
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      </div>

      {/* Fixed bottom send/receive — routes based on the active chain */}
      <div className="fixed bottom-0 inset-x-0 z-10 border-t border-border/60 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto max-w-3xl px-4 py-3 grid grid-cols-2 gap-3">
          <BottomActions chain={activeChain} />
        </div>
      </div>
      <TxDetailSheet detail={detail} onClose={() => setDetail(null)} />
      <ReorderTilesSheet open={reorderOpen} onClose={() => setReorderOpen(false)} />
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
      {tileOpen && tileOpen !== "txc" && tileOpen in EVM_CHAINS && (
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
            const p = allPrices.data?.prices[EVM_CHAINS[tileOpen as EvmChainId].priceSymbol];
            if (wei == null || p == null) return null;
            return formatFiat((Number(wei) / 1e18) * p);
          })()}
        />
      )}
    </main>
  );
}

function BottomActions({ chain }: { chain: ChainId }) {
  if (chain === "txc") {
    return (
      <>
        <Button asChild size="lg" variant="outline">
          <Link to="/wallet/receive">
            <QrCode className="h-4 w-4 mr-2" /> Receive
          </Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/wallet/send">
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
        <Button asChild size="lg" variant="outline">
          <Link to="/wallet/evm/$chain/receive" params={{ chain: c }}>
            <QrCode className="h-4 w-4 mr-2" /> Receive
          </Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/wallet/evm/$chain/send" params={{ chain: c }}>
            <Send className="h-4 w-4 mr-2" /> Send
          </Link>
        </Button>
      </>
    );
  }
  return (
    <>
      <Button size="lg" variant="outline" disabled>
        <QrCode className="h-4 w-4 mr-2" /> Coming soon
      </Button>
      <Button size="lg" disabled>
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
      <p className="mt-2 text-4xl font-bold tracking-tight">
        {hidden ? maskAmount(balText) : balText}
        <span className="ml-2 text-2xl font-semibold opacity-90">TXC</span>
      </p>
      <p className="text-amber-100/80 text-sm">
        {hidden ? maskAmount(fiatText) : fiatText}
      </p>
    </button>
  );
}

function EvmTile({
  chainId,
  balanceWei,
  loading,
  priceUsd,
  onRefresh,
  onOpenDetails,
}: {
  chainId: EvmChainId;
  balanceWei: bigint | null;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void;
  onOpenDetails: () => void;
}) {
  const [hidden] = useHideBalances();
  const meta = EVM_CHAINS[chainId];
  const balanceEth = balanceWei != null ? Number(balanceWei) / 1e18 : null;
  const balanceUsd = balanceEth != null && priceUsd != null ? balanceEth * priceUsd : null;
  const rawEthText = balanceWei != null ? formatEth(balanceWei) : "0";
  const compactEthText = compactNumberString(rawEthText, 10, 5);
  const balText = loading ? "..." : `${compactEthText} ${meta.nativeSymbol}`;
  const fiatText =
    balanceUsd != null ? formatFiat(balanceUsd) : priceUsd == null ? "Price unavailable" : "—";
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="w-full text-left rounded-2xl p-6 text-white shadow-xl active:scale-[0.99] transition-transform"
      style={{ background: `linear-gradient(135deg, ${meta.accent} 0%, ${meta.accent}CC 60%, #111 140%)` }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm opacity-80">{meta.name}</p>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          className="opacity-80 hover:opacity-100"
          aria-label="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-4xl font-bold tracking-tight">
        {hidden ? maskAmount(balText) : balText}
      </p>
      <p className="text-sm opacity-80">{hidden ? maskAmount(fiatText) : fiatText}</p>
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

  const usdc = useQuery({
    queryKey: ["erc20-usdc", chainId, address],
    enabled: !!address,
    queryFn: () => readErc20Balance(chainId, USDC_BY_CHAIN[chainId], address as `0x${string}`),
  });

  const history = useQuery({
    queryKey: ["evm-history", chainId, address],
    enabled: !!address,
    queryFn: () => fetchHistory({ data: { chain: chainId, address: address! } }),
  });


  const usdcRaw = usdc.data ?? 0n;
  const usdcAmt = usdcRaw > 0n ? tokenAmountFromRaw(usdcRaw, USDC_BY_CHAIN[chainId].decimals) : "0";

  return (
    <>
      <section className="mt-8 px-4">
        <h2 className="text-lg font-semibold mb-3">Tokens</h2>
        <ul className="space-y-2">
          <li className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs font-bold">
              $
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">USDC</p>
              <p className="text-xs text-muted-foreground">on {meta.name}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">
                {usdc.isLoading ? "…" : Number(usdcAmt).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </p>
              <p className="text-xs text-muted-foreground">
                {usdc.data != null ? formatFiat(Number(usdcAmt)) : "—"}
              </p>
            </div>
          </li>
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
        ) : (history.data?.transfers.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No transactions on {meta.name} yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {history.data!.transfers.map((t) => (
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
                    <p className="text-sm font-medium">{t.outgoing ? "Sent" : "Received"}</p>
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
          </ul>
        )}
      </section>
    </>
  );
}
