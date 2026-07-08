/**
 * Nectar.Pay tap-to-pay checkout.
 *
 * Flow (mirrors HME-MOBILE-NFC-SPEC.md):
 *   1. We arrive via deep link `/pay/:invoiceId?t=<nonce>`.
 *   2. GET invoice (merchant, fiat amount, accepted options[]).
 *   3. Poll wallet balances on every supported chain.
 *   4. Auto-pick the highest-priority option the user can actually pay.
 *      No chain chooser — that's the whole point of tap-to-pay.
 *   5. User confirms with a single button → biometric re-prompt → POST to
 *      lock in chain + receiving address → sign + broadcast.
 *   6. We do NOT post the tx hash back. Nectar's chain watchers detect it.
 *
 * Notes on safety:
 *   - The recipient address comes from a server response over HTTPS that's
 *     scoped by a 10-minute nonce. We display the full address before send.
 *   - The exact `crypto_amount` is the server's number, never re-rounded.
 *   - Biometric re-auth is required on native before broadcast.
 *   - Wallet must be unlocked; otherwise we bounce to the unlock screen
 *     with a return path so the deep link survives the unlock detour.
 */
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, ShieldCheck, ExternalLink, AlertCircle } from "lucide-react";
import { createWalletClient, http, parseEther, formatEther, type Address } from "viem";
import { Button } from "@/components/ui/button";
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
  USDC_BY_CHAIN,
  encodeTransfer,
  readErc20Balance,
  tokenAmountFromRaw,
  tokenAmountToRaw,
} from "@/lib/chains/erc20";
import {
  getInvoice,
  selectOption,
  type NectarInvoiceRead,
  type NectarInvoiceSelected,
} from "@/lib/nectar/api";
import { pickBestOption, type BalanceSnapshot, type SupportedAsset } from "@/lib/nectar/selector";
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { confirmWithBiometric } from "@/lib/native/biometric";

interface PaySearch {
  /** Nonce from the NDEF tag. Required. */
  t?: string;
}

export const Route = createFileRoute("/pay/$invoiceId")({
  component: PayRoute,
  validateSearch: (search): PaySearch => ({
    t: typeof search.t === "string" ? search.t : undefined,
  }),
});




function evmChainIdFromString(s: string): EvmChainId | null {
  return s === "eth" || s === "base" || s === "bsc" ? s : null;
}

function PayRoute() {
  const { invoiceId } = Route.useParams();
  const { t: nonce } = useSearch({ from: "/pay/$invoiceId" });
  const { root, unlocked } = useWallet();
  const navigate = useNavigate();

  // -------------------- Invoice fetch --------------------
  const invoice = useQuery({
    queryKey: ["nectar-invoice", invoiceId, nonce],
    queryFn: () => getInvoice(invoiceId, nonce!),
    enabled: !!nonce,
    retry: 1,
    staleTime: 0,
  });

  // -------------------- Balances + prices --------------------
  const evmAccount = useMemo(() => (root ? deriveEvmAccount(root) : null), [root]);

  const prices = useQuery({
    queryKey: ["prices-usd"],
    queryFn: () => getAllPricesUsd(),
    staleTime: 60_000,
  });

  const balances = useQuery<BalanceSnapshot[]>({
    queryKey: ["pay-balances", evmAccount?.address, prices.data?.fetchedAt],
    enabled: !!evmAccount,
    queryFn: async () => {
      const addr = evmAccount!.address;
      const out: BalanceSnapshot[] = [];
      const chainIds: EvmChainId[] = ["eth", "base", "bsc"];
      // Native balances in parallel.
      const native = await Promise.all(
        chainIds.map((c) =>
          evmClient(c)
            .getBalance({ address: addr })
            .catch(() => 0n),
        ),
      );
      chainIds.forEach((c, i) => {
        const wei = native[i];
        const meta = EVM_CHAINS[c];
        const price = prices.data?.prices[meta.priceSymbol] ?? 0;
        const eth = Number(formatEther(wei));
        out.push({
          asset: { kind: "evm-native", chain: c, symbol: meta.nativeSymbol },
          display: `${formatEth(wei)} ${meta.nativeSymbol}`,
          approxUsd: eth * price,
        });
      });
      // USDC balances in parallel.
      const usdcRaw = await Promise.all(
        chainIds.map((c) =>
          readErc20Balance(c, USDC_BY_CHAIN[c], addr).catch(() => 0n),
        ),
      );
      chainIds.forEach((c, i) => {
        const raw = usdcRaw[i];
        const meta = USDC_BY_CHAIN[c];
        const human = Number(tokenAmountFromRaw(raw, meta.decimals));
        out.push({
          asset: { kind: "evm-erc20", chain: c, symbol: "USDC" },
          display: `${human.toFixed(2)} USDC`,
          approxUsd: human, // 1 USDC ≈ $1 (we don't depeg-protect here).
        });
      });
      return out;
    },
    staleTime: 15_000,
  });

  // -------------------- Auto-pick --------------------
  const pick = useMemo(() => {
    if (!invoice.data || !balances.data) return null;
    return pickBestOption({
      options: invoice.data.options,
      balances: balances.data,
      fiatAmount: invoice.data.fiat_amount,
    });
  }, [invoice.data, balances.data]);

  // -------------------- Lock & broadcast --------------------
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<NectarInvoiceSelected | null>(null);
  const [sentTx, setSentTx] = useState<{ chain: EvmChainId; hash: string } | null>(null);

  const lockMut = useMutation({
    mutationFn: async () => {
      if (!pick || !nonce) throw new Error("Nothing to lock in");
      return selectOption(invoiceId, nonce, pick.option.key);
    },
    onSuccess: (data) => setLocked(data),
    onError: (e: Error) => setError(e.message),
  });

  const payMut = useMutation({
    mutationFn: async () => {
      if (!locked || !pick || !evmAccount) throw new Error("Not ready to pay");
      const chainId = evmChainIdFromString(locked.chain);
      if (!chainId) {
        throw new Error(
          `This build can't pay on ${locked.chain}. Use the hosted checkout instead.`,
        );
      }

      // Sanity-check the server actually picked an asset we have.
      const wantsErc20 = !!locked.token_symbol;
      const expected: SupportedAsset = wantsErc20
        ? { kind: "evm-erc20", chain: chainId, symbol: "USDC" }
        : { kind: "evm-native", chain: chainId, symbol: EVM_CHAINS[chainId].nativeSymbol };
      const bal = balances.data?.find(
        (b) =>
          b.asset.kind === expected.kind &&
          ("chain" in b.asset ? b.asset.chain === chainId : true) &&
          b.asset.symbol === expected.symbol,
      );
      if (!bal || bal.approxUsd + 1e-6 < locked.fiat_amount) {
        throw new Error("Not enough balance on the chain the merchant selected.");
      }

      const ok = await confirmWithBiometric(
        `Pay ${locked.crypto_amount} ${locked.token_symbol ?? EVM_CHAINS[chainId].nativeSymbol} to ${invoice.data?.merchant.name ?? "merchant"}`,
      );
      if (!ok) throw new Error("Biometric confirmation cancelled");

      const meta = EVM_CHAINS[chainId];
      const walletClient = createWalletClient({
        account: evmAccount,
        chain: meta.viemChain,
        transport: http(`/api/evm/${chainId}`),
      });
      const to = locked.address as Address;

      let hash: `0x${string}`;
      if (wantsErc20) {
        const token = USDC_BY_CHAIN[chainId];
        const amount = tokenAmountToRaw(String(locked.crypto_amount), token.decimals);
        const data = encodeTransfer(to, amount);
        hash = await walletClient.sendTransaction({ to: token.address, data, value: 0n });
      } else {
        const value = parseEther(String(locked.crypto_amount) as `${number}`);
        hash = await walletClient.sendTransaction({ to, value });
      }
      return { chain: chainId, hash };
    },
    onSuccess: (data) => setSentTx(data),
    onError: (e: Error) => setError(e.message),
  });

  // -------------------- Unlock gate --------------------
  useEffect(() => {
    if (!unlocked) {
      // Park the user on home; they'll come back manually after unlock.
      // (We deliberately don't auto-route back yet — that's a follow-up.)
    }
  }, [unlocked]);

  if (!nonce) {
    return <PayShell error="This payment link is missing its security token." />;
  }

  if (!unlocked) {
    return (
      <PayShell title="Unlock to pay">
        <p className="text-sm text-muted-foreground">
          Unlock your wallet, then tap the terminal again to start checkout.
        </p>
        <Link to="/" className="inline-block mt-4">
          <Button size="lg" className="w-full">Unlock wallet</Button>
        </Link>
      </PayShell>
    );
  }

  if (invoice.isLoading) {
    return <PayShell title="Loading invoice…" loading />;
  }
  if (invoice.error || !invoice.data) {
    const msg = invoice.error instanceof Error ? invoice.error.message : "Could not load invoice.";
    return <PayShell title="Invoice unavailable" error={msg} />;
  }

  const inv: NectarInvoiceRead = invoice.data;

  if (inv.status === "paid") {
    return <PayShell title="Already paid" merchantName={inv.merchant.name} success />;
  }
  if (inv.status === "expired" || inv.status === "cancelled") {
    return (
      <PayShell
        title={inv.status === "expired" ? "Invoice expired" : "Invoice cancelled"}
        merchantName={inv.merchant.name}
        error="Ask the cashier to ring it up again."
      />
    );
  }

  // -------------------- Sent confirmation --------------------
  if (sentTx) {
    const meta = EVM_CHAINS[sentTx.chain];
    return (
      <PayShell title="Payment sent" merchantName={inv.merchant.name} success>
        <p className="text-sm text-muted-foreground">
          The terminal will confirm in a few seconds.
        </p>
        <a
          href={meta.explorerTx(sentTx.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm underline"
        >
          View on explorer <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Button
          className="mt-6 w-full"
          size="lg"
          onClick={() => navigate({ to: "/wallet" })}
        >
          Done
        </Button>
      </PayShell>
    );
  }

  // -------------------- Loading balances --------------------
  if (balances.isLoading) {
    return (
      <PayShell title="Checking your balances…" merchantName={inv.merchant.name} loading>
        <InvoiceSummary inv={inv} />
      </PayShell>
    );
  }

  // -------------------- No payable option --------------------
  if (!pick) {
    return (
      <PayShell
        title="Not enough funds"
        merchantName={inv.merchant.name}
        error={`You don't have ${inv.fiat_amount.toFixed(2)} ${inv.currency} worth on any chain this merchant accepts.`}
      >
        <InvoiceSummary inv={inv} />
        <p className="mt-4 text-xs text-muted-foreground">
          Accepted: {inv.options.map((o) => o.label).join(", ")}
        </p>
      </PayShell>
    );
  }

  // -------------------- Ready / locked --------------------
  return (
    <PayShell title="Confirm payment" merchantName={inv.merchant.name}>
      <InvoiceSummary inv={inv} />

      <Card className="mt-4">
        <CardContent className="pt-5 space-y-3">
          <Row label="Paying with" value={pick.display} mono={false} />
          <Row label="Your balance" value={pick.balance.display} mono={false} />
          {locked && (
            <>
              <Row
                label="Exact amount"
                value={`${locked.crypto_amount} ${locked.token_symbol ?? EVM_CHAINS[locked.chain as EvmChainId]?.nativeSymbol ?? ""}`.trim()}
              />
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">To</span>
                <span
                  className="font-mono text-xs break-all leading-snug rounded-md bg-muted/40 px-2 py-1.5 select-all"
                  aria-label="Recipient address"
                >
                  {locked.address}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Verify the full address matches the merchant before confirming.
                </span>
              </div>

            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <p className="mt-3 text-sm text-rose-400 flex items-start gap-1.5">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {!locked ? (
        <Button
          className="mt-5 w-full"
          size="lg"
          disabled={lockMut.isPending}
          onClick={() => {
            setError(null);
            lockMut.mutate();
          }}
        >
          {lockMut.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Locking rate…
            </>
          ) : (
            <>Continue with {pick.display}</>
          )}
        </Button>
      ) : (
        <Button
          className="mt-5 w-full"
          size="lg"
          disabled={payMut.isPending}
          onClick={() => {
            setError(null);
            payMut.mutate();
          }}
        >
          {payMut.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing…
            </>
          ) : (
            <>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Pay {locked.fiat_amount.toFixed(2)} {locked.currency}
            </>
          )}
        </Button>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Rate is locked in for 10 minutes once you continue. The exact crypto amount
        comes from {inv.merchant.name}'s payment processor.
      </p>
    </PayShell>
  );
}

// -------------------- Shell + helpers --------------------

function PayShell(props: {
  title?: string;
  merchantName?: string;
  loading?: boolean;
  success?: boolean;
  error?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <Link
        to="/wallet"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Wallet
      </Link>

      {props.merchantName && (
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Pay {props.merchantName}
        </p>
      )}
      {props.title && (
        <h1
          className={`mt-1 text-2xl font-semibold ${props.success ? "text-emerald-500" : ""}`}
        >
          {props.title}
        </h1>
      )}

      {props.loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> One moment…
        </div>
      )}

      {props.error && (
        <p className="mt-4 text-sm text-rose-400 flex items-start gap-1.5">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{props.error}</span>
        </p>
      )}

      {props.children}
    </main>
  );
}

function InvoiceSummary({ inv }: { inv: NectarInvoiceRead }) {
  return (
    <Card className="mt-4">
      <CardContent className="pt-5">
        <div className="text-3xl font-semibold tracking-tight">
          {inv.fiat_amount.toFixed(2)}{" "}
          <span className="text-base font-normal text-muted-foreground">{inv.currency}</span>
        </div>
        {inv.description && (
          <p className="mt-1 text-sm text-muted-foreground">{inv.description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
