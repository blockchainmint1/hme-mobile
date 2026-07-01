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
  formatEth,
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
  component: EvmSwap,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});

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
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

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
  const quote = useQuery<SwapQuote>({
    queryKey: [
      "swap-quote",
      chainId,
      assetKey(from),
      assetKey(to),
      rawAmount?.toString() ?? "",
      account?.address,
    ],
    enabled: !!account && !!rawAmount && assetKey(from) !== assetKey(to),
    queryFn: () =>
      fetchQuote({
        data: {
          chain: chainId,
          fromToken: assetAddress(from),
          toToken: assetAddress(to),
          fromAmount: rawAmount!.toString(),
          fromAddress: account!.address,
        },
      }),
    staleTime: 20_000,
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
      if (!quote.data) throw new Error("No quote yet");
      const q = quote.data;

      const walletClient = createWalletClient({
        account,
        chain: meta.viemChain,
        transport: http(`/api/evm/${chainId}`),
      });

      // ERC-20 approval, if needed.
      if (from.kind === "erc20") {
        const approvalTo = q.estimate.approvalAddress as Address;
        const current = await evmClient(chainId).readContract({
          address: from.token.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, approvalTo],
        });
        const required = BigInt(q.estimate.fromAmount);
        if (current < required) {
          const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [approvalTo, required],
          });
          const approveHash = await walletClient.sendTransaction({
            to: from.token.address,
            data,
            value: 0n,
          });
          await evmClient(chainId).waitForTransactionReceipt({ hash: approveHash });
        }
      }

      const hash = await walletClient.sendTransaction({
        to: q.transactionRequest.to,
        data: q.transactionRequest.data,
        value: BigInt(q.transactionRequest.value ?? "0x0"),
      });
      return hash;
    },
    onError: (e: Error) => {
      hapticError();
      setError(e.message);
    },
    onSuccess: (hash) => {
      hapticSuccess();
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
            {swap.isPending
              ? from.kind === "erc20"
                ? "Approving & swapping…"
                : "Swapping…"
              : "Review & swap"}
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
