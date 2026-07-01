import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { deriveAddress } from "@/lib/txc/wallet";
import { DERIVATION_PATHS } from "@/lib/txc/network";
import { QrCode } from "@/components/wallet/QrCode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Copy, Plus, Share2 } from "lucide-react";
import { toast } from "sonner";
import { shareText } from "@/lib/native/ui";
import { copyToClipboard } from "@/lib/clipboard";
import {
  getDisplayIndex,
  getRotationPolicy,
  resolveDisplayIndex,
  setDisplayIndex,
} from "@/lib/address-prefs";

export const Route = createFileRoute("/wallet/receive")({
  head: () => ({ meta: [{ title: "Receive — HME Wallet" }] }),
  component: ReceivePage,
});

function ReceivePage() {
  const { root, unlocked } = useWallet();

  const accountId = useMemo(
    () => (root ? root.neutered().toBase58().slice(0, 24) : ""),
    [root],
  );

  const account = useQuery({
    queryKey: ["account", unlocked?.kind, accountId],
    enabled: !!root && !!unlocked && !!accountId,
    queryFn: () => scanAccount(root!, unlocked!.kind),
    staleTime: 30_000,
  });

  // `manualBump` lets the "New address" button advance past the on-chain
  // firstUnusedIndex without waiting for a payment to come in.
  const [manualBump, setManualBump] = useState(0);

  const firstUnused = account.data?.nextReceiveIndex ?? 0;

  const shown = useMemo(() => {
    if (!root || !unlocked || !accountId) return null;
    const policy = getRotationPolicy();
    const stored = getDisplayIndex(accountId, unlocked.kind);
    const base = resolveDisplayIndex(policy, stored, firstUnused);
    const idx = Math.max(base, manualBump);
    // Persist advances so a reload doesn't rewind the displayed address.
    if (idx !== stored) setDisplayIndex(accountId, unlocked.kind, idx);
    const derived = deriveAddress(root, unlocked.kind, 0, idx);
    return { index: idx, address: derived.address, path: derived.path };
  }, [root, unlocked, accountId, firstUnused, manualBump]);

  // Reset any manual bump if the account changes underneath us.
  useEffect(() => {
    setManualBump(0);
  }, [accountId, unlocked?.kind]);

  const address = shown?.address ?? "";

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Receive TXC</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Share this address with the sender. Old addresses always keep working — anything sent to
        them still lands in your wallet.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your deposit address</CardTitle>
          <CardDescription>{unlocked?.label}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {account.isLoading || !shown ? (
            <div className="w-60 h-60 rounded-lg bg-muted animate-pulse" />
          ) : address ? (
            <>
              <QrCode value={`texitcoin:${address}`} size={240} />
              <code className="font-mono text-sm text-center break-all px-2">{address}</code>
              <div className="text-xs text-muted-foreground text-center">
                Address #{shown.index} · <span className="font-mono">{shown.path}</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const ok = await copyToClipboard(address);
                    if (ok) toast.success("Address copied");
                    else toast.error("Could not copy. Long-press the address to select it.");
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" /> Copy
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const ok = await shareText({
                      title: "My TXC address",
                      text: address,
                      dialogTitle: "Share TXC address",
                    });
                    if (!ok) {
                      const copied = await copyToClipboard(address);
                      if (copied) toast.success("Address copied");
                    }
                  }}
                >
                  <Share2 className="h-4 w-4 mr-2" /> Share
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    // Advance past current display and past the on-chain frontier.
                    setManualBump(Math.max(shown.index + 1, firstUnused));
                    toast.success("Fresh address generated");
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" /> New
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground text-center max-w-xs">
                Rotation policy is in Settings. All addresses under{" "}
                <span className="font-mono">{DERIVATION_PATHS[unlocked!.kind]}/0/i</span> belong to
                this wallet.
              </p>
            </>
          ) : (
            <p className="text-sm text-destructive">Couldn't load an address. Try again.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
