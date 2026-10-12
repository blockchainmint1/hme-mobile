/**
 * Approval screen for an `hm-link-delegate` code (Seeds Exchange). The user
 * picks "give access" (instant trades, spending key shared) or "approve every
 * trade" (watch-only, each trade confirmed in the wallet).
 */
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useWallet } from "@/lib/txc/wallet-context";
import {
  fetchDelegateManifest,
  submitDelegate,
  type DelegateManifest,
  type DelegateMode,
} from "@/lib/xpub-link/delegate";
import { activePocketAccount } from "@/lib/seeds/pocket";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";

const CHAIN_LABEL: Record<string, string> = {
  TXC: "TXC / TSD",
  ISK: "ISK",
  BTC: "BTC",
  LTC: "LTC",
  EVM: "ETH / Base / BNB / Zero Chill",
};

export function DelegateLinkCard({ manifestUrl, onDone }: { manifestUrl: string; onDone?: () => void }) {
  const { unlocked } = useWallet();
  const allowed = useExchangeFeaturesAllowed();
  const [manifest, setManifest] = useState<DelegateManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DelegateMode | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchDelegateManifest(manifestUrl)
      .then((m) => live && setManifest(m))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [manifestUrl]);

  if (!allowed) return <p className="text-xs text-muted-foreground">Trading links aren't available in this version of the app.</p>;
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (done) return <p className="text-sm text-emerald-500">{done}</p>;
  if (!manifest)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Reading link…
      </p>
    );

  const account = activePocketAccount();

  async function approve() {
    if (!manifest || !mode || !unlocked?.mnemonic) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await submitDelegate({ manifest, mode, mnemonic: unlocked.mnemonic, passphrase: unlocked.passphrase ?? "" });
      setDone(
        mode === "access"
          ? `Linked. ${rec.appName} can now trade from your Trading pocket. Revoke it any time from the Trading pocket card.`
          : `Linked. ${rec.appName} will send each trade to your wallet for approval.`,
      );
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold">How should {manifest.appName} trade for you?</p>
          <p className="text-xs text-muted-foreground">
            Verified honest.money ecosystem site ({manifest.host}). Trades use a separate Trading pocket
            (branch {account}). Your main wallet is never shared.
          </p>
          {manifest.purpose && <p className="mt-1 text-xs text-muted-foreground">“{manifest.purpose}”</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Chains: {manifest.chains.map((c) => CHAIN_LABEL[c] ?? c).join(" · ")}
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => {
            setMode("access");
            setAck(false);
          }}
          className={`rounded-md border p-3 text-left ${mode === "access" ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <p className="text-sm font-medium">Give {manifest.appName} access</p>
          <p className="text-xs text-muted-foreground">Instant trades. No pop-ups.</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
            <ShieldAlert className="h-3 w-3" /> {manifest.appName} can spend anything you put in your Trading pocket until you revoke.
          </p>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("approve");
            setAck(false);
          }}
          className={`rounded-md border p-3 text-left ${mode === "approve" ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <p className="text-sm font-medium">Approve every trade</p>
          <p className="text-xs text-muted-foreground">
            {manifest.appName} holds no key. Each trade shows up in your wallet and you tap to approve it. Slower, but
            nothing moves without you.
          </p>
        </button>
      </div>

      {mode && (
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
          <span>
            {mode === "access"
              ? `I understand ${manifest.appName} can move the coins in my Trading pocket. Revoking moves them back and retires that pocket.`
              : `I'll approve or decline each ${manifest.appName} trade myself.`}
          </span>
        </label>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" disabled={!mode || !ack || busy || !unlocked?.mnemonic} onClick={approve} className="w-full">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {mode === "access" ? "Give access" : mode === "approve" ? "Link (approve each trade)" : "Pick an option"}
      </Button>
    </div>
  );
}
