/**
 * EVM chain detail page: shows balance, address, send/receive actions.
 * /wallet/evm/$chain  (chain ∈ eth | base | bsc)
 */
import { createFileRoute, Link, notFound, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { ArrowLeft, ExternalLink, QrCode, RefreshCw, Send } from "lucide-react";
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
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { formatFiat } from "@/lib/txc/units";

export const Route = createFileRoute("/wallet/evm/$chain")({
  component: EvmChainPage,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});

function EvmChainPage() {
  const { chain } = useParams({ from: "/wallet/evm/$chain" });
  const chainId = chain as EvmChainId;
  const meta = EVM_CHAINS[chainId];
  const { root } = useWallet();
  const fetchPrices = useServerFn(getAllPricesUsd);

  const account = useMemo(() => (root ? deriveEvmAccount(root) : null), [root]);
  const address = account?.address ?? null;

  const balance = useQuery({
    queryKey: ["evm-balance", chainId, address],
    enabled: !!address,
    queryFn: async () => {
      const client = evmClient(chainId);
      return client.getBalance({ address: address as `0x${string}` });
    },
    staleTime: 20_000,
  });

  const prices = useQuery({
    queryKey: ["prices"],
    queryFn: () => fetchPrices(),
    staleTime: 60_000,
  });

  const priceUsd = prices.data?.prices[meta.priceSymbol] ?? null;
  const balanceEth = balance.data ? Number(balance.data) / 1e18 : null;
  const balanceUsd = priceUsd != null && balanceEth != null ? balanceEth * priceUsd : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link to="/wallet" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> All chains
      </Link>

      <section
        className="rounded-2xl p-6 text-white shadow-xl"
        style={{
          background: `linear-gradient(135deg, ${meta.accent} 0%, ${meta.accent}CC 60%, #111 140%)`,
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm opacity-80">{meta.name}</p>
          <button
            onClick={() => balance.refetch()}
            className="opacity-80 hover:opacity-100"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${balance.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="mt-2 text-4xl font-bold tracking-tight">
          {balance.isLoading
            ? "..."
            : `${balance.data != null ? formatEth(balance.data) : "0"} ${meta.nativeSymbol}`}
        </p>
        <p className="text-sm opacity-80">
          {balanceUsd != null ? formatFiat(balanceUsd) : priceUsd == null ? "Price unavailable" : "—"}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button asChild size="lg" variant="secondary" className="bg-white/15 hover:bg-white/25 text-white border-0">
            <Link to="/wallet/evm/$chain/receive" params={{ chain: chainId }}>
              <QrCode className="h-4 w-4 mr-2" /> Receive
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="bg-white/15 hover:bg-white/25 text-white border-0">
            <Link to="/wallet/evm/$chain/send" params={{ chain: chainId }}>
              <Send className="h-4 w-4 mr-2" /> Send
            </Link>
          </Button>
        </div>
      </section>

      <Card className="mt-6">
        <CardContent className="pt-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Address</p>
          <p className="font-mono text-xs break-all">{address ?? "..."}</p>
          {address && (
            <a
              href={meta.explorerAddress(address)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View on explorer <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Same address works for ERC-20 tokens on {meta.name}. Token list coming soon.
      </p>
    </main>
  );
}
