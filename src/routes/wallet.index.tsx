import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { formatTxc, formatFiat, satsToTxc } from "@/lib/txc/units";
import { getTxcPriceUsd } from "@/lib/txc/price.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDown, ArrowUp, ExternalLink, RefreshCw, Send, QrCode } from "lucide-react";
import { explorerTxUrl, getAddressTxs, type MempoolTx } from "@/lib/txc/mempool";

export const Route = createFileRoute("/wallet/")({
  component: WalletHome,
});

function WalletHome() {
  const { root, unlocked } = useWallet();
  const fetchPrice = useServerFn(getTxcPriceUsd);

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

  const balanceSats = account.data?.balanceSats ?? 0;
  const balanceUsd = price.data?.usd ? satsToTxc(balanceSats) * price.data.usd : null;

  return (
    <main className="flex-1 flex flex-col min-h-0">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-28">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <section className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-700 to-amber-900 p-6 text-white shadow-xl shadow-amber-950/30">
            <div className="flex items-center justify-between">
              <p className="text-sm text-amber-100/80">{unlocked?.label ?? "TXC Wallet"}</p>
              <button
                onClick={() => account.refetch()}
                className="text-amber-100/80 hover:text-white"
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${account.isFetching ? "animate-spin" : ""}`} />
              </button>
            </div>
            <p className="mt-2 text-4xl font-bold tracking-tight">
              {account.isLoading ? "..." : formatTxc(balanceSats)}
            </p>
            <p className="text-amber-100/80 text-sm">
              {price.data?.usd ? formatFiat(balanceUsd) : "Price unavailable"}
            </p>
          </section>

          <section className="mt-8">
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
                  Couldn't reach mempool.texitcoin.org. Check your connection and{" "}
                  <button className="underline" onClick={() => account.refetch()}>
                    try again
                  </button>
                  .
                </CardContent>
              </Card>
            ) : (txs.data?.length ?? 0) === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No transactions yet. Use <Link to="/wallet/receive" className="text-foreground underline">Receive</Link>{" "}
                  to get your first deposit address.
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
        </div>
      </div>

      {/* Fixed bottom send/receive */}
      <div className="fixed bottom-0 inset-x-0 z-10 border-t border-border/60 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto max-w-3xl px-4 py-3 grid grid-cols-2 gap-3">
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
        </div>
      </div>
    </main>
  );
}
