/**
 * Swap LTC or DOGE into a stablecoin through the cheapest available route.
 *
 * We ask every configured route for a quote at once — THORChain plus the
 * non-custodial instant exchanges (SideShift, FixedFloat) — and rank them by
 * what actually lands in the wallet. The chosen route hands back a deposit
 * address (and, for THORChain, a memo); we then send an ordinary LTC/DOGE
 * transaction signed on this device. Nothing custodial, no external site, and
 * the stablecoin is paid out to this wallet's own EVM address.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowDown, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useWallet } from "@/lib/txc/wallet-context";
import { rootFingerprintHex } from "@/lib/txc/fingerprint";
import { deriveEvmAccount, EVM_CHAINS } from "@/lib/chains/evm";
import { hapticError, hapticSuccess } from "@/lib/native/ui";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import { ExchangeUnavailable } from "@/components/wallet/ExchangeUnavailable";
import { confirmWithBiometric } from "@/lib/native/biometric";
import { friendlyBroadcastError } from "@/lib/broadcast-error";
import { OP_RETURN_MAX_BYTES } from "@/lib/utxo/op-return";
import type { StableDestination, UtxoSwapCoin } from "@/lib/thorchain/assets";
import { getThorDestinations } from "@/lib/thorchain/swap.functions";
import {
  SWAP_PROVIDERS,
  type SwapOrder,
  type SwapProviderId,
  type SwapQuote,
} from "@/lib/swap-providers/types";
import {
  createSwapOrder,
  getSwapOrderStatus,
  getSwapQuotes,
} from "@/lib/swap-providers/swap.functions";
import { UTXO_SWAP_COINS } from "./utxo-swap-config";
import { recordSwap, updateSwap, useSwapHistory, type SavedSwap } from "@/lib/swap-history";

type PlacedOrder = SwapOrder & { ref?: Record<string, string> };

type Stage =
  | { kind: "form" }
  | { kind: "review"; order: PlacedOrder; feeSats: number; vsize: number; selected: number }
  | { kind: "sent"; txid: string; order: PlacedOrder; dest: StableDestination };

export function UtxoSwap({ coin }: { coin: UtxoSwapCoin }) {
  const exchangeAllowed = useExchangeFeaturesAllowed();
  if (!exchangeAllowed) return <ExchangeUnavailable title="Swap" />;
  return <UtxoSwapInner coin={coin} />;
}

function UtxoSwapInner({ coin }: { coin: UtxoSwapCoin }) {
  const cfg = UTXO_SWAP_COINS[coin];
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { root, unlocked } = useWallet();

  const fetchDestinations = useServerFn(getThorDestinations);
  const fetchQuotes = useServerFn(getSwapQuotes);
  const placeOrder = useServerFn(createSwapOrder);

  const evmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);

  const account = useQuery({
    queryKey: [cfg.accountQueryKey, cfg.kind, root ? rootFingerprintHex(root) : null],
    enabled: !!root && !!unlocked,
    queryFn: () => cfg.scan(root!),
    staleTime: 30_000,
  });

  const fees = useQuery({
    queryKey: [`${coin}-fees`],
    queryFn: cfg.getFeeEstimates,
    staleTime: 60_000,
  });

  const destinations = useQuery({
    queryKey: ["thor-destinations", coin],
    queryFn: () => fetchDestinations({ data: { coin } }),
    staleTime: 5 * 60_000,
  });

  const [destAsset, setDestAsset] = useState<string | null>(null);
  const dest = useMemo(
    () => destinations.data?.find((d) => d.asset === destAsset) ?? destinations.data?.[0] ?? null,
    [destinations.data, destAsset],
  );

  const [amount, setAmount] = useState("");
  const [debounced, setDebounced] = useState("");
  const [provider, setProvider] = useState<SwapProviderId | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amount), 500);
    return () => clearTimeout(t);
  }, [amount]);

  const utxos = account.data?.utxos ?? [];
  const totalAvailable = utxos.reduce((s: number, u: { value: number }) => s + u.value, 0);
  const feeRate = fees.data?.halfHourFee ?? cfg.fallbackFeeRate;
  const amountSats = useMemo(() => cfg.toSats(debounced || "0"), [debounced, cfg]);
  const refundAddress = account.data?.nextReceiveAddress ?? null;

  // Network fee for the inbound tx: all inputs + deposit output + memo + change.
  const inboundFeeEstimate = useMemo(
    () => Math.ceil(cfg.estimateVsize(Math.max(1, utxos.length), 2, true) * feeRate),
    [cfg, utxos.length, feeRate],
  );

  const quotes = useQuery({
    queryKey: ["swap-quotes", coin, dest?.asset, amountSats, evmAddress],
    enabled:
      !!dest &&
      !!evmAddress &&
      !!refundAddress &&
      amountSats > 0 &&
      amountSats + inboundFeeEstimate <= totalAvailable,
    queryFn: () =>
      fetchQuotes({
        data: {
          coin,
          dest: dest!,
          amountSats,
          destination: evmAddress!,
          refundAddress: refundAddress!,
        },
      }),
    staleTime: 30_000,
    retry: 0,
  });

  const list: SwapQuote[] = quotes.data?.quotes ?? [];
  const best = list[0] ?? null;
  const selected = useMemo(
    () => list.find((q) => q.provider === provider) ?? best,
    [list, provider, best],
  );

  const minIn = selected?.minInSats ?? null;
  const maxIn = selected?.maxInSats ?? null;
  const belowMin = minIn != null && amountSats > 0 && amountSats < minIn;
  const aboveMax = maxIn != null && amountSats > maxIn;

  /** Reopen the progress view for a swap recorded earlier. */
  function resumeSwap(s: SavedSwap) {
    setStage({
      kind: "sent",
      txid: s.txid,
      order: {
        provider: s.provider,
        depositAddress: "",
        amountSats: s.amountSats,
        memo: null,
        orderId: s.orderId,
        amountOut: s.amountOut,
        destAsset: s.dest.asset,
        etaSeconds: null,
        expiry: null,
        ref: s.token ? { token: s.token } : undefined,
      },
      dest: s.dest,
    });
  }

  function setMax() {
    const spendable = totalAvailable - inboundFeeEstimate;
    if (spendable > 0) setAmount(cfg.fromSats(spendable));
  }

  /** Pick inputs for a spend of `amountSats`, sizing the fee as we go. */
  function selectInputs() {
    const sorted = [...utxos].sort((a, b) => b.value - a.value);
    const picked: typeof sorted = [];
    let acc = 0, vsize = 0, feeSats = 0;
    for (const u of sorted) {
      picked.push(u);
      acc += u.value;
      vsize = cfg.estimateVsize(picked.length, 2, true);
      feeSats = Math.ceil(vsize * feeRate);
      if (acc >= amountSats + feeSats) break;
    }
    if (acc < amountSats + feeSats) return null;
    return { count: picked.length, feeSats, vsize };
  }

  async function review() {
    setError(null);
    if (!selected || !dest || !evmAddress || !refundAddress) return;
    const picked = selectInputs();
    if (!picked) {
      setError(
        `Not enough funds. Available ${cfg.format(totalAvailable)}, needed about ${cfg.format(
          amountSats + inboundFeeEstimate,
        )}.`,
      );
      return;
    }
    setBusy(true);
    try {
      const order = await placeOrder({
        data: {
          provider: selected.provider,
          coin,
          dest,
          amountSats,
          destination: evmAddress,
          refundAddress,
          quoteId: null,
        },
      });
      if (order.memo && new TextEncoder().encode(order.memo).length > OP_RETURN_MAX_BYTES) {
        setError(`This route's memo is too long for a ${cfg.ticker} transaction. Pick another route.`);
        return;
      }
      setStage({ kind: "review", order, feeSats: picked.feeSats, vsize: picked.vsize, selected: picked.count });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up this swap.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (stage.kind !== "review" || !root || !unlocked || !account.data || !dest) return;
    const { order } = stage;
    if (order.expiry && order.expiry * 1000 < Date.now()) {
      setError("This quote expired. Refresh it and try again.");
      setStage({ kind: "form" });
      void quotes.refetch();
      return;
    }
    const ok = await confirmWithBiometric(`Confirm swapping ${cfg.ticker}`);
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const sorted = [...utxos].sort((a, b) => b.value - a.value);
      const picked = sorted.slice(0, stage.selected);
      const built = cfg.buildAndSign({
        root,
        inputs: picked,
        outputs: [{ address: order.depositAddress, valueSats: order.amountSats }],
        changeAddress: account.data.nextChangeAddress,
        changeIndex: account.data.nextChangeIndex,
        feeSats: stage.feeSats,
        memo: order.memo ?? undefined,
      });
      const txid = await cfg.broadcast(built.hex);
      hapticSuccess();
      // Persist everything needed to resume tracking this swap later —
      // leaving the screen or locking the wallet must not lose it.
      recordSwap({
        txid,
        coin,
        provider: order.provider,
        orderId: order.orderId,
        token: order.ref?.["token"] ?? null,
        amountSats: order.amountSats,
        amountOut: order.amountOut,
        dest,
        destination: evmAddress!,
      });
      void qc.invalidateQueries({ queryKey: [cfg.accountQueryKey] });
      void qc.invalidateQueries({ queryKey: [cfg.txsQueryKey] });
      setStage({ kind: "sent", txid, order, dest });
    } catch (err) {
      hapticError();
      setError(friendlyBroadcastError(err));
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === "sent") {
    return (
      <SwapProgress
        coin={coin}
        txid={stage.txid}
        order={stage.order}
        dest={stage.dest}
        onDone={() => navigate({ to: "/wallet" })}
      />
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Swap {cfg.ticker}</h1>
      <p className="text-sm text-muted-foreground">
        Available: {account.isLoading ? "…" : cfg.format(totalAvailable)}
      </p>

      {stage.kind === "form" && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Swap to a stablecoin</CardTitle>
            <CardDescription>
              We compare every available route and show the one that pays out the most. Your{" "}
              {cfg.ticker} is signed on this device and the stablecoin lands in this wallet's EVM
              address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="swap-amount">You send ({cfg.ticker})</Label>
                <button
                  type="button"
                  onClick={setMax}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Max
                </button>
              </div>
              <Input
                id="swap-amount"
                type="number"
                inputMode="decimal"
                step={cfg.step}
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="mt-1"
              />
            </div>

            <div className="flex justify-center">
              <div className="rounded-full border border-border/60 bg-card/60 p-2">
                <ArrowDown className="h-4 w-4" />
              </div>
            </div>

            <div>
              <Label htmlFor="swap-dest">You receive</Label>
              <select
                id="swap-dest"
                value={dest?.asset ?? ""}
                onChange={(e) => setDestAsset(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                disabled={destinations.isLoading || !destinations.data?.length}
              >
                {destinations.isLoading && <option>Loading routes…</option>}
                {!destinations.isLoading && !destinations.data?.length && (
                  <option>No routes available right now</option>
                )}
                {destinations.data?.map((d) => (
                  <option key={d.asset} value={d.asset}>
                    {d.label}
                  </option>
                ))}
              </select>
              {destinations.error && (
                <p className="mt-2 flex items-start gap-2 text-xs text-amber-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {(destinations.error as Error).message}{" "}
                    <button
                      type="button"
                      onClick={() => destinations.refetch()}
                      className="underline hover:text-foreground"
                    >
                      Retry
                    </button>
                  </span>
                </p>
              )}
            </div>

            {/* Route comparison */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Route</Label>
                {list.length > 0 && (
                  <button
                    type="button"
                    onClick={() => quotes.refetch()}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh quotes
                  </button>
                )}
              </div>

              {quotes.isFetching && !list.length ? (
                <div className="rounded-md bg-muted/40 px-3 py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comparing routes…
                </div>
              ) : list.length ? (
                <div className="space-y-2">
                  {list.map((q) => {
                    const active = selected?.provider === q.provider;
                    const diff = best && best.amountOut > 0 ? q.amountOut / best.amountOut - 1 : 0;
                    return (
                      <button
                        key={q.provider}
                        type="button"
                        onClick={() => setProvider(q.provider)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          active
                            ? "border-primary bg-primary/5"
                            : "border-border/60 bg-card/40 hover:border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {SWAP_PROVIDERS[q.provider].label}
                              {q.provider === best?.provider && (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                                  Best
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {SWAP_PROVIDERS[q.provider].blurb}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold">
                              {q.amountOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                              {dest?.symbol}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {q.provider === best?.provider
                                ? q.totalBps != null
                                  ? `${(q.totalBps / 100).toFixed(2)}% fees`
                                  : "best payout"
                                : `${(diff * 100).toFixed(2)}%`}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Enter an amount to compare routes
                </div>
              )}

              {quotes.data?.errors?.length ? (
                <p className="text-[11px] text-muted-foreground">
                  Unavailable right now:{" "}
                  {quotes.data.errors
                    .map((e) => `${SWAP_PROVIDERS[e.provider].label} (${e.message})`)
                    .join(" · ")}
                </p>
              ) : null}
            </div>

            {evmAddress && (
              <p className="text-xs text-muted-foreground">
                Payout address ({dest ? EVM_CHAINS[dest.chain].name : "EVM"}):{" "}
                <code className="font-mono break-all">{evmAddress}</code>
              </p>
            )}

            {selected && (
              <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <Line label="Route">{SWAP_PROVIDERS[selected.provider].label}</Line>
                <Line label="Estimated time">
                  {selected.etaSeconds
                    ? `${Math.max(1, Math.round(selected.etaSeconds / 60))} min`
                    : "a few minutes"}
                </Line>
                <Line label={`${cfg.ticker} network fee`}>{cfg.format(inboundFeeEstimate)}</Line>
                {selected.warning && (
                  <p className="pt-1 text-amber-500">{selected.warning}</p>
                )}
              </div>
            )}

            {belowMin && (
              <p className="text-xs text-amber-500">
                Too small for this route. Minimum is about {cfg.format(minIn!)}.
              </p>
            )}
            {aboveMax && (
              <p className="text-xs text-amber-500">
                Too large for this route. Maximum is about {cfg.format(maxIn!)} — pick another route
                or split the swap.
              </p>
            )}
            {quotes.error && (
              <p className="text-xs text-destructive">{(quotes.error as Error).message}</p>
            )}
            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={review}
              disabled={
                !selected ||
                quotes.isFetching ||
                belowMin ||
                aboveMax ||
                busy ||
                account.isLoading
              }
            >
              {busy ? "Setting up…" : "Review swap"}
            </Button>
          </CardContent>
        </Card>
      )}

      {stage.kind === "review" && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Review and swap</CardTitle>
            <CardDescription>
              Routed through {SWAP_PROVIDERS[stage.order.provider].label}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="You send">{cfg.format(stage.order.amountSats)}</Row>
            <Row label="You receive (est.)">
              {stage.order.amountOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              {dest?.symbol}
            </Row>
            <Row label="Payout to">
              <code className="font-mono break-all text-xs">{evmAddress}</code>
            </Row>
            <Row label={`${cfg.ticker} network fee`}>
              {cfg.format(stage.feeSats)}{" "}
              <span className="text-muted-foreground text-xs">
                ({stage.vsize} vB × {feeRate} sat/vB)
              </span>
            </Row>
            <Row label="Arrives in">
              ~{Math.max(1, Math.round((stage.order.etaSeconds ?? 600) / 60))} min
            </Row>
            {stage.order.warning && (
              <p className="text-xs text-amber-500">{stage.order.warning}</p>
            )}
            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="ghost" onClick={() => setStage({ kind: "form" })} disabled={busy}>
                Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="flex-1" disabled={busy}>
                    {busy ? "Broadcasting…" : `Swap ${cfg.ticker}`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirm swap</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        <div>
                          Swap <strong>{cfg.format(stage.order.amountSats)}</strong> for about{" "}
                          <strong>
                            {stage.order.amountOut.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}{" "}
                            {dest?.symbol}
                          </strong>{" "}
                          via {SWAP_PROVIDERS[stage.order.provider].label}.
                        </div>
                        <div className="text-muted-foreground">
                          The final amount depends on the price when the swap executes. Swaps are
                          irreversible.
                        </div>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={send} disabled={busy}>
                      Confirm & swap
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {stage.kind === "form" && <RecentSwaps coin={coin} onOpen={resumeSwap} />}
    </main>
  );
}

/** Swaps started on this device, newest first — tap one to watch it again. */
function RecentSwaps({
  coin,
  onOpen,
}: {
  coin: UtxoSwapCoin;
  onOpen: (s: SavedSwap) => void;
}) {
  const swaps = useSwapHistory().filter((s) => s.coin === coin);
  if (!swaps.length) return null;
  const cfg = UTXO_SWAP_COINS[coin];
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold">Your swaps</h2>
      <div className="mt-2 space-y-2">
        {swaps.map((s) => (
          <button
            key={s.txid}
            type="button"
            onClick={() => onOpen(s)}
            className="w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left hover:border-border"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">
                {cfg.format(s.amountSats)} →{" "}
                {s.amountOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                {s.dest.symbol}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  s.done
                    ? "bg-emerald-500/15 text-emerald-400"
                    : s.failed
                      ? "bg-destructive/15 text-destructive"
                      : "bg-amber-500/15 text-amber-500"
                }`}
              >
                {s.done ? "Complete" : s.failed ? "Attention" : "In progress"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {SWAP_PROVIDERS[s.provider].label} ·{" "}
              {new Date(s.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function SwapProgress({
  coin,
  txid,
  order,
  dest,
  onDone,
}: {
  coin: UtxoSwapCoin;
  txid: string;
  order: PlacedOrder;
  dest: StableDestination;
  onDone: () => void;
}) {
  const cfg = UTXO_SWAP_COINS[coin];
  const fetchStatus = useServerFn(getSwapOrderStatus);
  const status = useQuery({
    queryKey: ["swap-status", order.provider, order.orderId, txid],
    queryFn: () =>
      fetchStatus({
        data: {
          provider: order.provider,
          orderId: order.orderId,
          txid,
          token: order.ref?.["token"] ?? null,
        },
      }),
    refetchInterval: (q) => (q.state.data?.outboundSent ? false : 15_000),
    retry: 3,
  });

  // Keep the saved record in sync so the list shows live progress.
  useEffect(() => {
    const d = status.data;
    if (!d) return;
    updateSwap(txid, {
      done: d.outboundSent,
      failed: !!d.failed,
      outboundTxid: d.outboundTxid ?? null,
    });
  }, [status.data, txid]);

  const label = SWAP_PROVIDERS[order.provider].label;
  const steps = [
    { label: `${cfg.ticker} sent`, done: true },
    { label: `Seen by ${label}`, done: !!status.data?.observed },
    { label: "Swapped", done: !!status.data?.finalised },
    { label: `${dest.symbol} paid out`, done: !!status.data?.outboundSent },
  ];

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-400 mx-auto flex items-center justify-center text-2xl">
          ✓
        </div>
        <h1 className="mt-4 text-2xl font-bold">Swap started</h1>
        <p className="mt-2 text-muted-foreground">
          About {order.amountOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
          {dest.label} is on the way. You can close this — it keeps going without the app open.
        </p>
      </div>

      <Card className="mt-6">
        <CardContent className="pt-6 space-y-3 text-sm">
          {steps.map((s) => (
            <div key={s.label} className="flex items-center gap-3">
              <span
                className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[11px] ${
                  s.done ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"
                }`}
              >
                {s.done ? "✓" : "…"}
              </span>
              <span className={s.done ? "" : "text-muted-foreground"}>{s.label}</span>
            </div>
          ))}
          {status.data?.message && (
            <p className="text-xs text-amber-500">{status.data.message}</p>
          )}
          {order.orderId && (
            <p className="text-xs text-muted-foreground">
              {label} order: <code className="font-mono">{order.orderId}</code>
            </p>
          )}
          <div className="pt-2 space-y-2">
            <a
              href={cfg.explorerTxUrl(txid)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline"
            >
              View {cfg.ticker} transaction <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {order.provider === "thorchain" && (
              <>
                <br />
                <a
                  href={`https://runescan.io/tx/${txid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline"
                >
                  Track the swap <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </>
            )}
            {status.data?.outboundTxid && (
              <>
                <br />
                <a
                  href={EVM_CHAINS[dest.chain].explorerTx(
                    `0x${status.data.outboundTxid.replace(/^0x/, "")}`,
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline"
                >
                  View {dest.symbol} payout <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 flex justify-center">
        <Button onClick={onDone}>Back to wallet</Button>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/40 pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="text-foreground text-right">{children}</span>
    </div>
  );
}
