/**
 * EVM receive page — shows the shared EVM address as text + QR.
 */
import { createFileRoute, Link, notFound, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QrCode } from "@/components/wallet/QrCode";
import { useWallet } from "@/lib/txc/wallet-context";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import { loadPairing } from "@/lib/vault-link/pairing";
import { evmSourceAddress } from "@/lib/vault-link/evm-send";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { toast } from "sonner";

export const Route = createFileRoute("/wallet/evm/$chain/receive")({
  head: () => ({ meta: [{ title: "Receive EVM coins and tokens — HME Wallet" }, { name: "description", content: "Receive coins and tokens at your HME Wallet or paired HME Vault address." }, { property: "og:title", content: "Receive EVM coins and tokens — HME Wallet" }, { property: "og:description", content: "Receive coins and tokens at your wallet address." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: EvmReceive,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});

function EvmReceive() {
  const { chain } = useParams({ from: "/wallet/evm/$chain/receive" });
  const chainId = chain as EvmChainId;
  const meta = EVM_CHAINS[chainId];
  const { root, unlocked, activeProfileId } = useWallet();
  const address = useMemo(() => evmSourceAddress(unlocked?.mode, root, unlocked?.mode === "vault" ? loadPairing(activeProfileId) : null), [root, unlocked?.mode, activeProfileId]);
  const { copied, copy } = useCopyFeedback();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/wallet"
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
              <QrCode value={address} size={220} copyValue={address} />
            </div>
          )}
          <p className="font-mono text-xs break-all text-center">{address ?? "..."}</p>
          <Button
            variant={copied ? "default" : "secondary"}
            onClick={async () => {
              if (!address) return;
              const ok = await copy(address);
              if (ok) toast.success("Address copied");
            }}
            disabled={!address}
            aria-live="polite"
          >
            {copied ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            {copied ? "Copied!" : "Copy address"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Send {meta.nativeSymbol} or any ERC-20 token on {meta.name} to this address.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
