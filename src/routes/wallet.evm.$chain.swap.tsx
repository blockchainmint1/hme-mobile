/**
 * In-app EVM swap. Uses LI.FI to fetch a quote server-side, then signs the
 * transaction on-device with the user's HME seed and broadcasts through our
 * same-origin RPC proxy — no external wallet connect, no external site.
 *
 * Same-chain swaps only. Supports the chain's native token plus any known
 * ERC-20 (USDC / USDT / PYUSD, plus user-added custom tokens).
 */
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowDown, Loader2, RefreshCw } from "lucide-react";
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
} from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useWallet } from "@/lib/txc/wallet-context";
import {
  EVM_CHAINS,
  deriveEvmAccount,
  evmClient,
  type EvmChainId,
} from "@/lib/chains/evm";
import {
  readErc20Balance,
  tokenAmountFromRaw,
  tokenAmountToRaw,
  type Erc20TokenMeta,
} from "@/lib/chains/erc20";
import { useTokensForChain } from "@/lib/token-prefs";
import { hapticSuccess, hapticError } from "@/lib/native/ui";
import { getSwapQuote, NATIVE_TOKEN_ADDRESS, type SwapQuote } from "@/lib/chains/swap.functions";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import { ExchangeUnavailable } from "@/components/wallet/ExchangeUnavailable";
import { sendEvmTransaction } from "@/lib/chains/evm-send";
import { assertReviewedExecution } from "@/lib/security/execution-policy";
import {
  LIFI_NATIVE,
  requiredSpender,
  verifyLifiDeployment,
  verifyLifiQuote,
  type LifiChain,
} from "@/lib/security/lifi-policy";

/**
 * A refreshed route may guarantee a little less than the one the user saw
 * (prices move between the tap and the signature). Anything below this
 * fraction of the accepted minimum is a material change and is refused so the
 * user can re-confirm, instead of being signed silently.
 */
const ACCEPTED_MIN_DRIFT_BPS = 50n; // 0.5%

type AssetKind =
  | { kind: "native" }
  | { kind: "erc20"; token: Erc20TokenMeta };

function assetKey(a: AssetKind): string {
  return a.kind === "native" ? "native" : a.token.address.toLowerCase();
}
function assetSymbol(a: AssetKind, meta: (typeof EVM_CHAINS)[EvmChainId]) {
  return a.kind === "native" ? meta.nativeSymbol : a.token.symbol;
}
function assetDecimals(a: AssetKind): number {
  return a.kind === "native" ? 18 : a.token.decimals;
}
function assetAddress(a: AssetKind): string {
  return a.kind === "native" ? NATIVE_TOKEN_ADDRESS : a.token.address;
}

export const Route = createFileRoute("/wallet/evm/$chain/swap")({
  head: () => ({ meta: [{ title: "Swap EVM assets — HME Wallet" }, { name: "description", content: "Exchange supported Ethereum-network coins and tokens in HME Wallet." }, { property: "og:title", content: "Swap EVM assets — HME Wallet" }, { property: "og:description", content: "Exchange supported Ethereum-network coins and tokens." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: EvmSwapGate,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});

function EvmSwapGate() {
  const exchangeAllowed = useExchangeFeaturesAllowed();
  const { unlocked } = useWallet();
  if (unlocked?.mode === "vault") return <main className="mx-auto max-w-3xl px-4 py-6"><h1 className="text-2xl font-semibold">Swap unavailable for Vault</h1><p className="my-4 text-muted-foreground">HME Vault supports coin and token transfers, but not swap approvals.</p><Button asChild variant="outline"><Link to="/wallet">Back to wallet</Link></Button></main>;
  if (!exchangeAllowed) return <ExchangeUnavailable title="Swap" />;
  return <EvmSwap />;
}

function EvmSwap() {
  const { chain } = useParams({ from: "/wallet/evm/$chain/swap" });
  const chainId = chain as EvmChainId;
  const meta = EVM_CHAINS[chainId];
  const tokens = useTokensForChain(chainId);
  const { root } = useWallet();
  const navigate = useNavigate();
  const fetchQuote = useServerFn(getSwapQuote);

  const account = useMemo(() => (root ? deriveEvmAccount(root) : null), [root]);
  const allAssets: AssetKind[] = useMemo(
    () => [{ kind: "native" as const }, ...tokens.map((t) => ({ kind: "erc20" as const, token: t }))],
    [tokens],
  );

  // Default: native → first ERC-20 (usually USDC).
  const defaultTo: AssetKind = tokens[0]
    ? { kind: "erc20", token: tokens[0] }
    : { kind: "native" };
  const [from, setFrom] = useState<AssetKind>({ kind: "native" });
  const [to, setTo] = useState<AssetKind>(defaultTo);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(0.01);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  const nativeBal = useQuery({
    queryKey: ["evm-balance", chainId, account?.address],
    enabled: !!account,
    queryFn: () => evmClient(chainId).getBalance({ address: account!.address }),
    staleTime: 15_000,
  });
  const tokenBalances = useQueries({
    queries: tokens.map((t) => ({
      queryKey: ["erc20-balance", chainId, t.address, account?.address],
      enabled: !!account,
      queryFn: () => readErc20Balance(chainId, t, account!.address),
      staleTime: 30_000,
    })),
  });

  function balanceFor(a: AssetKind): bigint | null {
    if (a.kind === "native") return nativeBal.data ?? null;
    const idx = tokens.findIndex((t) => t.address === a.token.address);
    return (tokenBalances[idx]?.data as bigint | undefined) ?? null;
  }
  function prettyBalance(a: AssetKind): string {
    const raw = balanceFor(a);
    if (raw == null) return "…";
    return Number(tokenAmountFromRaw(raw, assetDecimals(a))).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  }

  const rawAmount = useMemo(() => {
    if (!amount || Number(amount) <= 0) return null;
    try {
      return tokenAmountToRaw(amount, assetDecimals(from));
    } catch {
      return null;
    }
  }, [amount, from]);

  // Auto-quote when both assets picked + amount entered.
  const quoteArgs = useMemo(
    () => ({
      chain: chainId,
      fromToken: assetAddress(from),
      toToken: assetAddress(to),
      fromAmount: rawAmount?.toString() ?? "0",
      fromAddress: account?.address ?? "0x",
      slippage,
    }),
    [chainId, from, to, rawAmount, account?.address, slippage],
  );

  const quote = useQuery<SwapQuote>({
    queryKey: [
      "swap-quote",
      chainId,
      assetKey(from),
      assetKey(to),
      rawAmount?.toString() ?? "",
      account?.address,
      slippage,
    ],
    enabled: !!account && !!rawAmount && assetKey(from) !== assetKey(to),
    queryFn: () => fetchQuote({ data: quoteArgs }),
    // Quotes go stale fast; refresh so we never sign a minutes-old route.
    staleTime: 15_000,
    refetchInterval: 20_000,
    retry: 0,
  });


  const receiveDisplay = useMemo(() => {
    if (!quote.data) return null;
    return Number(
      tokenAmountFromRaw(BigInt(quote.data.estimate.toAmount), assetDecimals(to)),
    ).toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [quote.data, to]);

  const swap = useMutation({
    mutationFn: async () => {
      if (!account) throw new Error("Wallet locked");
      if (!rawAmount) throw new Error("Enter an amount");
      if (!quote.data) throw new Error("No quote to confirm");
      if (chainId === "zcu") throw new Error("Swaps aren't available on this network");
      assertReviewedExecution("lifi");

      const walletClient = createWalletClient({
        account,
        chain: meta.viemChain,
        transport: http(`/api/evm/${chainId}`),
      });
      const pub = evmClient(chainId);
      const lifiChain = chainId as LifiChain;

      // The intent is what the user saw when they pressed the button. Every
      // quote used from here on — for the approval spender and for the
      // signed transaction — must bind to it; a quote is not an authority.
      const shown = quote.data;
      const intent = {
        chain: lifiChain,
        user: account.address,
        fromToken: from.kind === "native" ? LIFI_NATIVE : from.token.address,
        toToken: to.kind === "native" ? LIFI_NATIVE : to.token.address,
        fromAmount: rawAmount,
        minAmountOutFloor:
          (BigInt(shown.estimate.toAmountMin) * (10_000n - ACCEPTED_MIN_DRIFT_BPS)) / 10_000n,
      };
      verifyLifiQuote(shown, intent);
      setStage("Checking LI.FI contract…");
      await verifyLifiDeployment(lifiChain, pub);

      // ERC-20 approval, if needed. Done BEFORE the final quote so the
      // route we sign is as fresh as possible. The spender is the pinned
      // Diamond, never a quote field; the amount is exactly the intent.
      if (from.kind === "erc20") {
        setStage("Checking approval…");
        const approvalTo: Address = requiredSpender(lifiChain, shown);
        const current = await pub.readContract({
          address: from.token.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, approvalTo],
        });
        // Approve generously so a re-quoted (slightly larger) amount still fits.
        const required = rawAmount;
        if (current < required) {
          // USDT-style tokens revert when moving a non-zero allowance to
          // another non-zero value — reset to 0 first.
          if (current > 0n) {
            setStage("Resetting approval…");
            const resetHash = await sendEvmTransaction(chainId, walletClient, {
              to: from.token.address,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [approvalTo, 0n],
              }),
              value: 0n,
            });
            await pub.waitForTransactionReceipt({ hash: resetHash });
          }
          setStage("Approving…");
          const approveHash = await sendEvmTransaction(chainId, walletClient, {
            to: from.token.address,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [approvalTo, required],
            }),
            value: 0n,
          });
          const rec = await pub.waitForTransactionReceipt({ hash: approveHash });
          if (rec.status !== "success") throw new Error("Token approval failed on-chain");
        }
      }

      // Always sign against a freshly fetched route — a quote that sat on
      // screen for a minute will revert on slippage.
      setStage("Refreshing route…");
      const q = await fetchQuote({ data: quoteArgs });
      // The refreshed route must still be the swap the user confirmed: same
      // Diamond, same tokens and amount, output to this wallet, and a minimum
      // no more than ACCEPTED_MIN_DRIFT_BPS below what they accepted.
      const verified = verifyLifiQuote(q, intent);

      setStage("Swapping…");
      const tx = {
        to: q.transactionRequest.to,
        data: q.transactionRequest.data,
        value: verified.value,
      };
      // Simulate first. A revert means the router would reject this route,
      // and a quote-supplied gasLimit is attacker-controlled, so estimation
      // failure blocks signing rather than falling back to the quoted limit.
      let gas: bigint;
      try {
        gas = await pub.estimateGas({ account, ...tx });
        gas = (gas * 130n) / 100n;
      } catch (e) {
        throw new Error(
          `The router rejected this swap (likely price moved). Try again, or raise slippage. Details: ${
            (e as Error).message.split("\n")[0]
          }`,
        );
      }

      return await sendEvmTransaction(chainId, walletClient, { ...tx, gas });
    },
    onError: (e: Error) => {
      hapticError();
      setStage(null);
      setError(e.message);
    },
    onSuccess: (hash) => {
      hapticSuccess();
      setStage(null);
      setTxHash(hash);
    },
  });


  function flip() {
    setFrom(to);
    setTo(from);
    setAmount("");
    setError(null);
    setTxHash(null);
  }

  if (txHash) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold mb-2">Swap submitted</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Your swap is on its way. It usually confirms within a minute.
        </p>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <a
              className="text-sm underline break-all"
              href={meta.explorerTx(txHash)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on explorer
            </a>
            <Button asChild className="w-full" size="lg">
              <Link to="/wallet">Back to wallet</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const sameAsset = assetKey(from) === assetKey(to);
  const fromBal = balanceFor(from);
  const insufficient = rawAmount != null && fromBal != null && rawAmount > fromBal;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/wallet"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Swap</h1>
      <p className="text-sm text-muted-foreground mb-6">on {meta.name}</p>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* From */}
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>From</span>
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => {
                  const raw = balanceFor(from);
                  if (raw != null) setAmount(tokenAmountFromRaw(raw, assetDecimals(from)));
                }}
              >
                Max: {prettyBalance(from)}
              </button>
            </label>
            <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                placeholder="0.0"
                inputMode="decimal"
              />
              <AssetSelect
                value={from}
                options={allAssets}
                onChange={(a) => {
                  if (assetKey(a) === assetKey(to)) setTo(from);
                  setFrom(a);
                }}
                meta={meta}
              />
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={flip}
              className="rounded-full border border-border/60 bg-card/50 p-2 hover:bg-card"
              aria-label="Flip"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>

          {/* To */}
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>To (estimated)</span>
              <span>Balance: {prettyBalance(to)}</span>
            </label>
            <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
              <Input
                value={receiveDisplay ?? ""}
                readOnly
                placeholder={quote.isFetching ? "…" : "0.0"}
                className="bg-muted/20"
              />
              <AssetSelect
                value={to}
                options={allAssets}
                onChange={(a) => {
                  if (assetKey(a) === assetKey(from)) setFrom(to);
                  setTo(a);
                }}
                meta={meta}
              />
            </div>
          </div>

          {sameAsset && (
            <p className="text-xs text-amber-400">Pick two different tokens.</p>
          )}
          {insufficient && (
            <p className="text-xs text-rose-400">
              Not enough {assetSymbol(from, meta)}.
            </p>
          )}
          {quote.error && (
            <p className="text-xs text-rose-400">{(quote.error as Error).message}</p>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Slippage
            </span>
            <div className="flex gap-1">
              {[0.005, 0.01, 0.02, 0.03].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlippage(s)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    slippage === s
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s * 100}%
                </button>
              ))}
            </div>
          </div>


          {quote.data && !sameAsset && !insufficient && (
            <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Route</span>
                <span className="text-foreground">
                  {quote.data.toolDetails?.name ?? quote.data.tool}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Minimum received</span>
                <span className="text-foreground">
                  {Number(
                    tokenAmountFromRaw(
                      BigInt(quote.data.estimate.toAmountMin),
                      assetDecimals(to),
                    ),
                  ).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                  {assetSymbol(to, meta)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Gas (est.)</span>
                <span className="text-foreground">
                  ~${quote.data.estimate.gasCosts?.[0]?.amountUSD ?? "—"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => quote.refetch()}
                className="mt-1 inline-flex items-center gap-1 underline hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" /> Refresh quote
              </button>
            </div>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <Button
            onClick={() => {
              setError(null);
              swap.mutate();
            }}
            disabled={
              !quote.data ||
              sameAsset ||
              insufficient ||
              swap.isPending ||
              quote.isFetching
            }
            className="w-full"
            size="lg"
          >
            {(swap.isPending || quote.isFetching) && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            {swap.isPending ? (stage ?? "Swapping…") : "Review & swap"}

          </Button>

          <p className="text-[10px] text-muted-foreground">
            Quotes and routing powered by LI.FI. Gas is paid in{" "}
            {meta.nativeSymbol}. Transactions are signed on this device.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function AssetSelect({
  value,
  options,
  onChange,
  meta,
}: {
  value: AssetKind;
  options: AssetKind[];
  onChange: (a: AssetKind) => void;
  meta: (typeof EVM_CHAINS)[EvmChainId];
}) {
  return (
    <select
      value={assetKey(value)}
      onChange={(e) => {
        const k = e.target.value;
        const found = options.find((o) => assetKey(o) === k);
        if (found) onChange(found);
      }}
      className="rounded-md border border-border/60 bg-card/60 px-3 py-2 text-sm font-medium min-w-24"
    >
      {options.map((o) => (
        <option key={assetKey(o)} value={assetKey(o)}>
          {assetSymbol(o, meta)}
        </option>
      ))}
    </select>
  );
}
