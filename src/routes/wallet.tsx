import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Settings as Cog, Download, Sparkles, Eye, ScanLine } from "lucide-react";
import { scanAccount } from "@/lib/txc/scan";
import { satsToTxc, formatFiat } from "@/lib/txc/units";
import { getTxcPriceUsd } from "@/lib/txc/price.functions";
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { EVM_CHAIN_LIST, deriveEvmAccount, evmClient, type EvmChainId } from "@/lib/chains/evm";
import { listWatchWallets, watchChangedEvent, type WatchWallet } from "@/lib/watch-only";
import { getAddressStats } from "@/lib/txc/mempool";
import { getEnabledChains } from "@/lib/chain-prefs";
import { parsePaymentUri } from "@/lib/pay-uri";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [{ title: "Wallet — HME Wallet" }],
  }),
  component: WalletLayout,
});

function WalletLayout() {
  const { unlocked, root } = useWallet();
  const navigate = useNavigate();
  const [showPortfolio, setShowPortfolio] = useState(false);

  useEffect(() => {
    if (!unlocked) navigate({ to: "/" });
  }, [unlocked, navigate]);

  const fetchPrice = useServerFn(getTxcPriceUsd);
  const price = useQuery({
    queryKey: ["txc-price"],
    queryFn: () => fetchPrice(),
    staleTime: 60_000,
    enabled: !!unlocked,
  });

  const account = useQuery({
    queryKey: ["account", unlocked?.kind, unlocked?.mnemonic.slice(0, 12)],
    enabled: !!root && !!unlocked,
    queryFn: () => scanAccount(root!, unlocked!.kind),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const evmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);
  const allPricesFn = useServerFn(getAllPricesUsd);
  const allPrices = useQuery({
    queryKey: ["all-prices"],
    queryFn: () => allPricesFn(),
    staleTime: 60_000,
    enabled: !!unlocked,
  });
  const evmBalances = useQueries({
    queries: EVM_CHAIN_LIST.map((c) => ({
      queryKey: ["evm-balance", c.id, evmAddress],
      enabled: !!evmAddress,
      queryFn: () => evmClient(c.id).getBalance({ address: evmAddress! }),
      staleTime: 30_000,
    })),
  });

  // Watch-only wallets contribute to the portfolio total too.
  const [watchList, setWatchList] = useState<WatchWallet[]>(() => listWatchWallets());
  useEffect(() => {
    const h = () => setWatchList(listWatchWallets());
    window.addEventListener(watchChangedEvent(), h);
    return () => window.removeEventListener(watchChangedEvent(), h);
  }, []);
  const watchBalances = useQueries({
    queries: watchList.map((w) => ({
      queryKey: ["watch-stats", w.chain, w.address],
      queryFn: () => getAddressStats(w.address),
      staleTime: 60_000,
      enabled: !!unlocked,
    })),
  });

  const portfolioUsd = useMemo(() => {
    let total = 0;
    if (price.data?.usd && account.data) {
      total += satsToTxc(account.data.balanceSats) * price.data.usd;
    }
    EVM_CHAIN_LIST.forEach((c, i) => {
      const bal = evmBalances[i]?.data;
      const usd = allPrices.data?.prices[c.priceSymbol];
      if (bal != null && usd != null) {
        total += (Number(bal) / 1e18) * usd;
      }
    });
    // Watch-only TXC balances (funded - spent, in sats).
    if (price.data?.usd) {
      watchList.forEach((_, i) => {
        const s = watchBalances[i]?.data;
        if (!s) return;
        const bal =
          s.chain_stats.funded_txo_sum -
          s.chain_stats.spent_txo_sum +
          s.mempool_stats.funded_txo_sum -
          s.mempool_stats.spent_txo_sum;
        total += satsToTxc(bal) * (price.data?.usd ?? 0);
      });
    }
    return total;
  }, [price.data, account.data, evmBalances, allPrices.data, watchList, watchBalances]);

  // EVM chain picker when a scanned URI doesn't specify a chain.
  const [pickChain, setPickChain] = useState<
    | { address: string; assetSymbol?: string; amount?: string }
    | null
  >(null);

  function handleScan(raw: string) {
    const intent = parsePaymentUri(raw);
    if (intent.kind === "txc") {
      navigate({
        to: "/wallet/send",
        search: { to: intent.address, amount: intent.amount },
      });
      return;
    }
    if (intent.kind === "evm") {
      if (!intent.address) {
        toast.error("QR is missing a recipient address");
        return;
      }
      const enabledEvm = getEnabledChains().filter((c) =>
        (["eth", "base", "bsc"] as string[]).includes(c),
      ) as EvmChainId[];
      if (intent.chain && enabledEvm.includes(intent.chain)) {
        navigate({
          to: "/wallet/evm/$chain/send",
          params: { chain: intent.chain },
          search: {
            to: intent.address,
            amount: intent.amount,
            asset: intent.assetSymbol,
          },
        });
        return;
      }
      // No chain in URI (or chain disabled) — ask the user which EVM network to use.
      setPickChain({
        address: intent.address,
        assetSymbol: intent.assetSymbol,
        amount: intent.amount,
      });
      return;
    }
    if (intent.kind === "nectar-invoice") {
      // Hosted checkout — open in system browser; tap-to-pay handoff kicks in from there.
      window.open(intent.url, "_blank", "noopener");
      return;
    }
    toast.error("Couldn't recognize that QR code");
  }

  if (!unlocked) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur supports-[backdrop-filter]:bg-card/30 sticky top-0 z-20">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setShowPortfolio((v) => !v)}
            className="flex-1 min-w-0 text-left group"
            title="Tap to toggle"
          >
            {showPortfolio ? (
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Portfolio</span>
                <span className="font-semibold truncate">
                  {formatFiat(portfolioUsd)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">TXC</span>
                <span className="font-semibold truncate">
                  {price.data?.usd
                    ? `$${price.data.usd.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
                    : "—"}
                </span>
              </div>
            )}
          </button>

          <QrScanButton
            onDetected={handleScan}
            triggerLabel="Scan"
            title="Scan payment QR"
          >
            <Button variant="ghost" size="icon" title="Scan QR">
              <ScanLine className="h-5 w-5" />
              <span className="sr-only">Scan QR</span>
            </Button>
          </QrScanButton>



          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Add wallet">
                <Plus className="h-5 w-5" />
                <span className="sr-only">Add wallet</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/create">
                  <Sparkles className="h-4 w-4 mr-2" /> Create new wallet
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/import">
                  <Download className="h-4 w-4 mr-2" /> Import wallet
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/wallet/watch-add">
                  <Eye className="h-4 w-4 mr-2" /> Add watch-only
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button asChild variant="ghost" size="icon" title="Settings">
            <Link to="/wallet/settings">
              <Cog className="h-5 w-5" />
              <span className="sr-only">Settings</span>
            </Link>
          </Button>
        </div>
      </header>
      <div className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
