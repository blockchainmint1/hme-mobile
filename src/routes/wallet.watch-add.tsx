/**
 * "Add watch-only wallet" flow.
 *
 * Watch-only tiles let people track a Cold Storage Coin or paper wallet's TXC
 * address without importing any keys. We validate the address against the TXC
 * network params so bogus / wrong-network addresses can't create a dead tile.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Eye, Loader2, Search } from "lucide-react";
import { address as addrLib } from "bitcoinjs-lib";
import { TXC_NETWORK } from "@/lib/txc/network";
import { QrScanButton, parseWalletUri } from "@/components/wallet/QrScanButton";
import { addWatchWallet } from "@/lib/watch-only";
import { lookupColdStorageCoin } from "@/lib/csc/coin-lookup.functions";

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
  const [coinId, setCoinId] = useState("");
  const [looking, setLooking] = useState(false);
  const [coinNote, setCoinNote] = useState<string | null>(null);
  const lookupCoin = useServerFn(lookupColdStorageCoin);

  const lookUpCoinId = async () => {
    const id = coinId.trim().replace(/\s+/g, "");
    setError(null);
    setCoinNote(null);
    if (!/^[0-9A-Za-z]{6}$/.test(id)) {
      return setError("Enter the six characters printed on the coin's sticker.");
    }
    setLooking(true);
    try {
      const res = await lookupCoin({ data: { coinId: id } });
      if (!res.found || !res.address) {
        return setError(res.message ?? "That coin ID wasn't found.");
      }
      if (!isValidTxcAddress(res.address)) {
        return setError(
          `Coin ${res.assetId} is a ${res.blockchainName ?? res.blockchainCode ?? "different"} coin, so it can't be tracked here yet.`,
        );
      }
      setAddress(res.address);
      if (!label.trim()) setLabel(res.productName ? `${res.productName} ${res.assetId}` : `Coin ${res.assetId}`);
      setCoinNote(
        `Found ${res.productName ? `${res.productName} — ` : ""}coin ${res.assetId}. Address filled in below.`,
      );
    } catch {
      setError("Couldn't look up that coin ID. Try again.");
    } finally {
      setLooking(false);
    }
  };

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
          <div className="mb-5 rounded-xl border border-border/60 bg-muted/30 p-4">
            <Label htmlFor="coinId">Cold Storage Coin ID</Label>
            <p className="mb-2 text-xs text-muted-foreground">
              Type the six characters printed on the coin's sticker and we'll fill in the address
              for you.
            </p>
            <div className="flex gap-2">
              <Input
                id="coinId"
                placeholder="e.g. 7Kd2Xp"
                value={coinId}
                onChange={(e) => setCoinId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void lookUpCoinId();
                  }
                }}
                maxLength={6}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void lookUpCoinId()}
                disabled={looking || coinId.trim().length !== 6}
              >
                {looking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="ml-1">Look up</span>
              </Button>
            </div>
            {coinNote && <p className="mt-2 text-sm text-primary">{coinNote}</p>}
          </div>

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
