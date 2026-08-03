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

  // Omni (TSD, POP…) can only read legacy P2PKH / P2SH outputs, so a wallet
  // whose primary branch is native segwit needs a `T…` address for tokens.
  // Every branch of this seed is scanned and spendable, so handing out the
  // BIP44 address is safe — the funds show up in the same balance.
  const [mode, setMode] = useState<"txc" | "token">("txc");
  const primaryKind = unlocked?.kind ?? "bip44";
  const primaryIsOmniSafe = primaryKind === "bip44" || primaryKind === "bip49";
  const activeKind = mode === "token" && !primaryIsOmniSafe ? "bip44" : primaryKind;

  const firstUnused = account.data?.nextReceiveIndex ?? 0;

  const shown = useMemo(() => {
    if (!root || !unlocked || !accountId) return null;
    const policy = getRotationPolicy();
    const stored = getDisplayIndex(accountId, activeKind);
    const base =
      activeKind === unlocked.kind ? resolveDisplayIndex(policy, stored, firstUnused) : stored;
    const idx = Math.max(base, manualBump);
    // Persist advances so a reload doesn't rewind the displayed address.
    if (idx !== stored) setDisplayIndex(accountId, activeKind, idx);
    const derived = deriveAddress(root, activeKind, 0, idx);
    return { index: idx, address: derived.address, path: derived.path };
  }, [root, unlocked, accountId, firstUnused, manualBump, activeKind]);

  // Reset any manual bump if the account changes underneath us.
  useEffect(() => {
    setManualBump(0);
  }, [accountId, unlocked?.kind, mode]);

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

      {!primaryIsOmniSafe && (
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["txc", "token"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "txc" ? "TXC" : "Tokens (TSD…)"}
            </button>
          ))}
        </div>
      )}

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
              {mode === "token" && !primaryIsOmniSafe ? (
                <div className="text-xs text-muted-foreground text-center px-2">
                  Legacy address for Omni tokens (TSD, POP…). Balances still roll into this same
                  wallet — plain TXC works here too.
                </div>
              ) : (
                /^txc1/i.test(address) && (
                  <div className="text-xs text-destructive text-center px-2">
                    Plain TXC only. Tokens (TSD, POP…) can't be delivered to a txc1… address —
                    switch to the Tokens tab above for a legacy T… address.
                  </div>
                )
              )}


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
