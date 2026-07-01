/**
 * "Add watch-only wallet" flow.
 *
 * Watch-only tiles let people track a Cold Storage Coin or paper wallet's TXC
 * address without importing any keys. We validate the address against the TXC
 * network params so bogus / wrong-network addresses can't create a dead tile.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Eye } from "lucide-react";
import { address as addrLib } from "bitcoinjs-lib";
import { TXC_NETWORK } from "@/lib/txc/network";
import { QrScanButton, parseWalletUri } from "@/components/wallet/QrScanButton";
import { addWatchWallet } from "@/lib/watch-only";

export const Route = createFileRoute("/wallet/watch-add")({
  head: () => ({ meta: [{ title: "Add watch-only wallet — HME Wallet" }] }),
  component: WatchAddPage,
});

function isValidTxcAddress(addr: string): boolean {
  try {
    addrLib.toOutputScript(addr.trim(), TXC_NETWORK);
    return true;
  } catch {
    return false;
  }
}

function WatchAddPage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handlePaste = (raw: string) => {
    setError(null);
    try {
      const parsed = parseWalletUri(raw);
      setAddress(parsed.address);
    } catch {
      setAddress(raw.trim());
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanAddr = address.trim();
    if (!cleanAddr) return setError("Paste or scan an address first.");
    if (!isValidTxcAddress(cleanAddr)) {
      return setError("That's not a valid TEXITcoin address. Make sure you're using the TXC address (not BTC).");
    }
    addWatchWallet({
      label: label.trim() || "Watch-only",
      chain: "txc",
      address: cleanAddr,
    });
    navigate({ to: "/wallet" });
  };

  return (
    <main className="mx-auto max-w-3xl w-full px-4 py-6">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/wallet">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" /> Add watch-only wallet
          </CardTitle>
          <CardDescription>
            Track a TXC address without importing keys. Perfect for Cold Storage Coins, paper wallets,
            or any address you only need to monitor. You can view balance & history — sending stays
            locked because the private key never touches this app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                placeholder="e.g. Cold Storage Coin #1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div>
              <Label htmlFor="address">TEXITcoin address</Label>
              <div className="flex gap-2">
                <Input
                  id="address"
                  placeholder="txc1... or T..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <QrScanButton onScan={handlePaste} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Scan the public address printed on your Cold Storage Coin. Never paste a private key
                or seed here — a watch-only wallet only needs the address.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full">
              Add watch-only wallet
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
