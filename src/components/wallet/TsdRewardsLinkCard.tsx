/**
 * Settings card: link a watch-only TEXITcoin account key to a TSD Swap
 * account so rewards track the user's *total* TSD across every derived
 * address — not just the canonical deposit address.
 *
 * Public key material only. No seed, no private key, no spending authority,
 * and no automatic sweeping of funds.
 *
 * Tied to a TSD Swap account, so it follows the same iOS gate as cash-out.
 */
import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCashoutApiKey } from "@/lib/cashout/api-key";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import {
  buildRewardsLink,
  clearRewardsLink,
  getRewardsLink,
  maskXpub,
  saveRewardsLink,
  type RewardsLinkRecord,
} from "@/lib/rewards/tsd-xpub";
import { linkRewardsXpub, unlinkRewardsXpub } from "@/lib/rewards/tsd-xpub.functions";
import { useWallet } from "@/lib/txc/wallet-context";

export function TsdRewardsLinkCard({ compact }: { compact?: boolean }) {
  const allowed = useExchangeFeaturesAllowed();
  const { unlocked } = useWallet();
  const [apiKey] = useCashoutApiKey();
  const [record, setRecord] = useState<RewardsLinkRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setRecord(getRewardsLink());
  }, [unlocked]);

  if (!allowed) return null;

  const seedless = !unlocked || unlocked.mode === "keyonly" || !unlocked.mnemonic;

  async function onLink() {
    if (!unlocked?.mnemonic || !apiKey) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const signed = await buildRewardsLink(unlocked.mnemonic, unlocked.passphrase ?? "");
      await linkRewardsXpub({
        data: {
          apiKey,
          payload: signed.payload,
          signature: signed.signature,
          address: signed.address,
        },
      });
      const next: RewardsLinkRecord = {
        identity: signed.payload.identity,
        xpub: signed.payload.xpub,
        linkedAt: new Date().toISOString(),
      };
      saveRewardsLink(next);
      setRecord(next);
      setNotice("Rewards now track your TSD across every address in this wallet.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link this wallet.");
    } finally {
      setBusy(false);
    }
  }

  async function onUnlink() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (apiKey) await unlinkRewardsXpub({ data: { apiKey } });
    } catch {
      /* local unlink still applies */
    } finally {
      clearRewardsLink();
      setRecord(null);
      setBusy(false);
    }
  }

  const body = (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        TSD stays on whichever address received it, so a balance can sit across several of your
        addresses. Sharing your watch-only TEXITcoin account key lets TSD Swap add them all up for
        rewards — without you moving a single coin. Public keys only: your seed phrase and private
        keys never leave this device.
      </p>

      {seedless ? (
        <p className="text-xs text-muted-foreground">Only seed-phrase wallets can be linked.</p>
      ) : !apiKey ? (
        <p className="text-xs text-muted-foreground">
          Add your TSD Swap API key in the TSD cash-out section first — it identifies the account
          rewards are credited to.
        </p>
      ) : record ? (
        <div className="space-y-2">
          <span className="flex items-center gap-1.5 text-sm text-primary">
            <Check className="h-4 w-4" /> Linked for rewards
          </span>
          <p className="font-mono text-xs text-muted-foreground break-all">
            {maskXpub(record.xpub)}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onLink()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Re-send
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onUnlink()}>
              <Trash2 className="mr-2 h-4 w-4" /> Unlink
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" disabled={busy} onClick={() => void onLink()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Link wallet for rewards
        </Button>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {notice ? <p className="text-xs text-primary">{notice}</p> : null}
    </div>
  );

  return (
    <Card className={compact ? "rounded-none border-0 bg-transparent shadow-none" : "mt-5"}>
      {!compact && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> TSD rewards
          </CardTitle>
          <CardDescription>
            Track your TSD holdings across every address for rewards.
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className={compact ? "p-0" : undefined}>{body}</CardContent>
    </Card>
  );
}
