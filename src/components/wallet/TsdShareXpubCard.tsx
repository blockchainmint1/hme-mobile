/**
 * Settings card: show the watch-only TEXITcoin account key as a QR code so
 * another app (e.g. TSD Swap) can scan it to track TSD across every derived
 * address. Public key material only — no seed, no spending authority.
 */
import { useState } from "react";
import { Copy, Loader2, QrCode as QrIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCode } from "@/components/wallet/QrCode";
import { deriveAccountXpub } from "@/lib/rewards/tsd-xpub";
import { useWallet } from "@/lib/txc/wallet-context";

export function TsdShareXpubCard({ compact }: { compact?: boolean }) {
  const { unlocked } = useWallet();
  const [xpub, setXpub] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const seedless = !unlocked || unlocked.mode === "keyonly" || !unlocked.mnemonic;

  async function onShow() {
    if (!unlocked?.mnemonic) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deriveAccountXpub(unlocked.mnemonic, unlocked.passphrase ?? "");
      setXpub(res.xpub);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not derive your account key.");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!xpub) return;
    try {
      await navigator.clipboard.writeText(xpub);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  const body = (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Scan this from your TSD Swap account to share your watch-only TEXITcoin account key. It
        lets TSD Swap add up your TSD across every address in this wallet. Public keys only — your
        seed phrase and private keys never leave this device.
      </p>

      {seedless ? (
        <p className="text-xs text-muted-foreground">Only seed-phrase wallets can share a key.</p>
      ) : xpub ? (
        <div className="space-y-3">
          <div className="flex justify-center">
            <QrCode value={xpub} size={220} />
          </div>
          <p className="font-mono text-[11px] text-muted-foreground break-all">{xpub}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void onCopy()}>
              <Copy className="mr-2 h-4 w-4" /> {copied ? "Copied" : "Copy key"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setXpub(null)}>
              Hide
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" disabled={busy} onClick={() => void onShow()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrIcon className="mr-2 h-4 w-4" />}
          Show QR code
        </Button>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );

  return (
    <Card className={compact ? "rounded-none border-0 bg-transparent shadow-none" : "mt-5"}>
      {!compact && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrIcon className="h-5 w-5" /> Share account key
          </CardTitle>
          <CardDescription>Scan your watch-only TEXITcoin account key.</CardDescription>
        </CardHeader>
      )}
      <CardContent className={compact ? "p-0" : undefined}>{body}</CardContent>
    </Card>
  );
}
