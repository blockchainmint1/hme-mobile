/**
 * Swap LTC or DOGE into a stablecoin, natively, via THORChain.
 *
 * How it works: we ask a THORNode for a quote, which returns a vault
 * (inbound) address and a memo. We then send an ordinary LTC/DOGE transaction
 * to that vault with the memo in an OP_RETURN — signed on this device — and
 * THORChain pays the stablecoin out to the wallet's own EVM address a few
 * minutes later. No bridge, no custodian, no external site.
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
import {
  formatThorAmount,
  fromThorAmount,
  type StableDestination,
  type ThorQuote,
  type UtxoSwapCoin,
} from "@/lib/thorchain/assets";
import {
  getThorDestinations,
  getThorQuote,
  getThorTxStatus,
} from "@/lib/thorchain/swap.functions";
import { UTXO_SWAP_COINS } from "./utxo-swap-config";

type Stage =
  | { kind: "form" }
  | { kind: "review"; quote: ThorQuote; feeSats: number; vsize: number; selected: number }
  | { kind: "sent"; txid: string; quote: ThorQuote; dest: StableDestination };

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
  const fetchQuote = useServerFn(getThorQuote);

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

  // Network fee for the inbound tx: all inputs + vault output + OP_RETURN + change.
  const inboundFeeEstimate = useMemo(
    () => Math.ceil(cfg.estimateVsize(Math.max(1, utxos.length), 2, true) * feeRate),
    [cfg, utxos.length, feeRate],
  );

  const quote = useQuery<ThorQuote>({
    queryKey: ["thor-quote", coin, dest?.asset, amountSats, evmAddress],
    enabled:
      !!dest && !!evmAddress && amountSats > 0 && amountSats + inboundFeeEstimate <= totalAvailable,
    queryFn: () =>
      fetchQuote({
        data: {
          coin,
          toAsset: dest!.asset,
          amountSats: String(amountSats),
          destination: evmAddress!,
        },
      }),
    staleTime: 30_000,
    retry: 0,
  });

  const minIn = quote.data?.recommended_min_amount_in
    ? Number(quote.data.recommended_min_amount_in)
    : null;
  const belowMin = minIn != null && amountSats > 0 && amountSats < minIn;
  const memoTooLong = quote.data
    ? new TextEncoder().encode(quote.data.memo).length > OP_RETURN_MAX_BYTES
    : false;

  function setMax() {
    const spendable = totalAvailable - inboundFeeEstimate;
    if (spendable > 0) setAmount(cfg.fromSats(spendable));
  }

  function review() {
    setError(null);
    if (!quote.data) return;
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
    if (acc < amountSats + feeSats) {
      setError(
        `Not enough funds. Available ${cfg.format(totalAvailable)}, needed ${cfg.format(amountSats + feeSats)}.`,
      );
      return;
    }
    setStage({ kind: "review", quote: quote.data, feeSats, vsize, selected: picked.length });
  }

  async function send() {
    if (stage.kind !== "review" || !root || !unlocked || !account.data || !dest) return;
    if (stage.quote.expiry * 1000 < Date.now()) {
      setError("This quote expired. Refresh it and try again.");
      setStage({ kind: "form" });
      void quote.refetch();
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
        outputs: [{ address: stage.quote.inbound_address, valueSats: amountSats }],
        changeAddress: account.data.nextChangeAddress,
        changeIndex: account.data.nextChangeIndex,
        feeSats: stage.feeSats,
        memo: stage.quote.memo,
      });
      const txid = await cfg.broadcast(built.hex);
      hapticSuccess();
      void qc.invalidateQueries({ queryKey: [cfg.accountQueryKey] });
      void qc.invalidateQueries({ queryKey: [cfg.txsQueryKey] });
      setStage({ kind: "sent", txid, quote: stage.quote, dest });
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
        quote={stage.quote}
        dest={stage.dest}
        onDone={() => navigate({ to: "/wallet" })}
      />
    );
  }

  const outText = quote.data ? formatThorAmount(quote.data.expected_amount_out, 2) : null;
  const feesBps = quote.data?.fees.total_bps ?? null;

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
              Native cross-chain swap through THORChain. Your {cfg.ticker} is signed on this
              device and the stablecoin lands in this wallet's EVM address.
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

              <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                {quote.isFetching ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting best route…
                  </span>
                ) : outText ? (
                  <span className="font-semibold">
                    ≈ {outText} {dest?.symbol}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Enter an amount for a quote</span>
                )}
              </div>
            </div>

            {evmAddress && (
              <p className="text-xs text-muted-foreground">
                Payout address ({dest ? EVM_CHAINS[dest.chain].name : "EVM"}):{" "}
                <code className="font-mono break-all">{evmAddress}</code>
              </p>
            )}

            {quote.data && (
              <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <Line label="Swap + network fees">
                  {feesBps != null ? `${(feesBps / 100).toFixed(2)}%` : "—"} · ≈{" "}
                  {formatThorAmount(quote.data.fees.total, 2)} {dest?.symbol}
                </Line>
                <Line label="Minimum received">
                  {(
                    fromThorAmount(quote.data.expected_amount_out) *
                    (1 - (quote.data.fees.slippage_bps ?? 0) / 10_000 - 0.03)
                  ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                  {dest?.symbol}
                </Line>
                <Line label="Estimated time">
                  {Math.max(1, Math.round((quote.data.total_swap_seconds ?? 600) / 60))} min
                </Line>
                <Line label={`${cfg.ticker} network fee`}>{cfg.format(inboundFeeEstimate)}</Line>
                <button
                  type="button"
                  onClick={() => quote.refetch()}
                  className="mt-1 inline-flex items-center gap-1 underline hover:text-foreground"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh quote
                </button>
              </div>
            )}

            {belowMin && (
              <p className="text-xs text-amber-500">
                Too small to swap economically. Minimum is about{" "}
                {cfg.format(minIn!)} — below that the network fees eat the trade.
              </p>
            )}
            {memoTooLong && (
              <p className="text-xs text-destructive">
                This route's memo is too long for a {cfg.ticker} transaction. Pick another
                destination.
              </p>
            )}
            {quote.error && (
              <p className="text-xs text-destructive">{(quote.error as Error).message}</p>
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
                !quote.data || quote.isFetching || belowMin || memoTooLong || account.isLoading
              }
            >
              Review swap
            </Button>
          </CardContent>
        </Card>
      )}

      {stage.kind === "review" && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Review and swap</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="You send">{cfg.format(amountSats)}</Row>
            <Row label="You receive (est.)">
              {formatThorAmount(stage.quote.expected_amount_out, 2)} {dest?.symbol}
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
              ~{Math.max(1, Math.round((stage.quote.total_swap_seconds ?? 600) / 60))} min
            </Row>
            {stage.quote.warning && (
              <p className="text-xs text-amber-500">{stage.quote.warning}</p>
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
                          Swap <strong>{cfg.format(amountSats)}</strong> for about{" "}
                          <strong>
                            {formatThorAmount(stage.quote.expected_amount_out, 2)} {dest?.symbol}
                          </strong>
                          .
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
    </main>
  );
}

function SwapProgress({
  coin,
  txid,
  quote,
  dest,
  onDone,
}: {
  coin: UtxoSwapCoin;
  txid: string;
  quote: ThorQuote;
  dest: StableDestination;
  onDone: () => void;
}) {
  const cfg = UTXO_SWAP_COINS[coin];
  const fetchStatus = useServerFn(getThorTxStatus);
  const status = useQuery({
    queryKey: ["thor-status", txid],
    queryFn: () => fetchStatus({ data: { txid } }),
    refetchInterval: (q) => (q.state.data?.outboundSent ? false : 15_000),
    retry: 3,
  });

  const steps = [
    { label: `${cfg.ticker} sent`, done: true },
    { label: "Seen by THORChain", done: !!status.data?.observed },
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
          About {formatThorAmount(quote.expected_amount_out, 2)} {dest.label} is on the way. You
          can close this — it keeps going without the app open.
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
          {status.data?.secondsRemaining ? (
            <p className="text-xs text-muted-foreground">
              About {Math.max(1, Math.round(status.data.secondsRemaining / 60))} min remaining.
            </p>
          ) : null}
          <div className="pt-2 space-y-2">
            <a
              href={cfg.explorerTxUrl(txid)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline"
            >
              View {cfg.ticker} transaction <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <br />
            <a
              href={`https://runescan.io/tx/${txid}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline"
            >
              Track the swap <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {status.data?.outboundTxid && (
              <>
                <br />
                <a
                  href={EVM_CHAINS[dest.chain].explorerTx(`0x${status.data.outboundTxid.replace(/^0x/, "")}`)}
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
