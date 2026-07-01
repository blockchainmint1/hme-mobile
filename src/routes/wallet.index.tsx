import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { formatTxc, formatFiat, satsToTxc } from "@/lib/txc/units";
import { getTxcPriceUsd } from "@/lib/txc/price.functions";
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { getEvmHistory } from "@/lib/chains/history.functions";
import { readErc20Balance, tokenAmountFromRaw, USDC_BY_CHAIN } from "@/lib/chains/erc20";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDown, ArrowUp, ExternalLink, RefreshCw, Send, QrCode } from "lucide-react";
import { explorerTxUrl, getAddressTxs, type MempoolTx } from "@/lib/txc/mempool";
import { getEnabledChains, CHAIN_META, type ChainId } from "@/lib/chain-prefs";
import { EVM_CHAINS, deriveEvmAccount, evmClient, formatEth, type EvmChainId } from "@/lib/chains/evm";

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
  }, [enabled.length]);

  const activeChain: ChainId = enabled[activeIdx] ?? "txc";

  // TXC data
  const account = useQuery({
    queryKey: ["account", unlocked?.kind, unlocked?.mnemonic.slice(0, 12)],
    enabled: !!root && !!unlocked,
    queryFn: () => scanAccount(root!, unlocked!.kind),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const price = useQuery({
    queryKey: ["txc-price"],
    queryFn: () => fetchPrice(),
    staleTime: 60_000,
  });
  const txs = useQuery({
    queryKey: ["txs", account.data?.external.map((a) => a.address).join(",")],
    enabled: !!account.data,
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
  const allPrices = useQuery({
    queryKey: ["all-prices"],
    queryFn: () => fetchAllPrices(),
    staleTime: 60_000,
    enabled: evmEnabled.length > 0,
  });
  const evmBalances = useQueries({
    queries: evmEnabled.map((id) => ({
      queryKey: ["evm-balance", id, evmAddress],
      enabled: !!evmAddress,
      queryFn: () => evmClient(id).getBalance({ address: evmAddress! }),
      staleTime: 30_000,
    })),
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
            {enabled.map((id) => (
              <div key={id} className="snap-center shrink-0 w-full px-4 pt-6">
                {id === "txc" ? (
                  <TxcTile
                    balanceSats={account.data?.balanceSats ?? 0}
                    loading={account.isLoading}
                    priceUsd={price.data?.usd ?? null}
                    onRefresh={() => account.refetch()}
                    refreshing={account.isFetching}
                    label={unlocked?.label ?? "TXC Wallet"}
                  />
                ) : (
                  <EvmTile
                    chainId={id as EvmChainId}
                    balanceWei={evmBalances[evmEnabled.indexOf(id as EvmChainId)]?.data ?? null}
                    loading={evmBalances[evmEnabled.indexOf(id as EvmChainId)]?.isLoading ?? true}
                    priceUsd={allPrices.data?.prices[EVM_CHAINS[id as EvmChainId].priceSymbol] ?? null}
                    onRefresh={() =>
                      evmBalances[evmEnabled.indexOf(id as EvmChainId)]?.refetch()
                    }
                  />
                )}
              </div>
            ))}
          </div>

          {/* Dots indicator */}
          {enabled.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-3">
              {enabled.map((id, i) => (
                <span
                  key={id}
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
                        <a
                          href={explorerTxUrl(tx.txid)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3 hover:bg-card transition-colors"
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
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
          {activeChain !== "txc" && (
            <section className="mt-8 px-4">
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  Transaction history for {CHAIN_META[activeChain].name} coming soon. Tap Send or
                  Receive below to use this chain.
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
}: {
  balanceSats: number;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void;
  refreshing: boolean;
  label: string;
}) {
  const balanceUsd = priceUsd ? satsToTxc(balanceSats) * priceUsd : null;
  return (
    <section className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-700 to-amber-900 p-6 text-white shadow-xl shadow-amber-950/30">
      <div className="flex items-center justify-between">
        <p className="text-sm text-amber-100/80">{label}</p>
        <button
          onClick={onRefresh}
          className="text-amber-100/80 hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
      <p className="mt-2 text-4xl font-bold tracking-tight">
        {loading ? "..." : formatTxc(balanceSats)}
      </p>
      <p className="text-amber-100/80 text-sm">
        {balanceUsd != null ? formatFiat(balanceUsd) : "Price unavailable"}
      </p>
    </section>
  );
}

function EvmTile({
  chainId,
  balanceWei,
  loading,
  priceUsd,
  onRefresh,
}: {
  chainId: EvmChainId;
  balanceWei: bigint | null;
  loading: boolean;
  priceUsd: number | null;
  onRefresh: () => void;
}) {
  const meta = EVM_CHAINS[chainId];
  const balanceEth = balanceWei != null ? Number(balanceWei) / 1e18 : null;
  const balanceUsd = balanceEth != null && priceUsd != null ? balanceEth * priceUsd : null;
  return (
    <section
      className="rounded-2xl p-6 text-white shadow-xl"
      style={{ background: `linear-gradient(135deg, ${meta.accent} 0%, ${meta.accent}CC 60%, #111 140%)` }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm opacity-80">{meta.name}</p>
        <button onClick={onRefresh} className="opacity-80 hover:opacity-100" aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-4xl font-bold tracking-tight">
        {loading ? "..." : `${balanceWei != null ? formatEth(balanceWei) : "0"} ${meta.nativeSymbol}`}
      </p>
      <p className="text-sm opacity-80">
        {balanceUsd != null ? formatFiat(balanceUsd) : priceUsd == null ? "Price unavailable" : "—"}
      </p>
    </section>
  );
}
