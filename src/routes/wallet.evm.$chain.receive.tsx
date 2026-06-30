/**
 * EVM receive page — shows the shared EVM address as text + QR.
 */
import { createFileRoute, Link, notFound, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QrCode } from "@/components/QrCode";
import { useWallet } from "@/lib/txc/wallet-context";
import { EVM_CHAINS, deriveEvmAccount, type EvmChainId } from "@/lib/chains/evm";
import { copyText } from "@/lib/clipboard";

export const Route = createFileRoute("/wallet/evm/$chain/receive")({
  component: EvmReceive,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});

function EvmReceive() {
  const { chain } = useParams({ from: "/wallet/evm/$chain/receive" });
  const chainId = chain as EvmChainId;
  const meta = EVM_CHAINS[chainId];
  const { root } = useWallet();
  const address = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/wallet/evm/$chain"
        params={{ chain: chainId }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Receive {meta.nativeSymbol}</h1>
      <p className="text-sm text-muted-foreground mb-6">on {meta.name}</p>

      <Card>
        <CardContent className="pt-6 flex flex-col items-center gap-4">
          {address && (
            <div className="bg-white p-3 rounded-lg">
              <QrCode value={address} size={220} />
            </div>
          )}
          <p className="font-mono text-xs break-all text-center">{address ?? "..."}</p>
          <Button
            variant="secondary"
            onClick={() => address && copyText(address)}
            disabled={!address}
          >
            <Copy className="h-4 w-4 mr-2" /> Copy address
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Send {meta.nativeSymbol} or any ERC-20 token on {meta.name} to this address.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
