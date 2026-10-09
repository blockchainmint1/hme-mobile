/**
 * Quietly link this wallet to a Nectar Pay merchant by handing over
 * watch-only account xpubs. Lives collapsed inside Settings — no wallet
 * home-screen surface.
 */
import { useEffect, useState } from "react";
import { Link2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { useWallet } from "@/lib/txc/wallet-context";
import {
  consentMode,
  deriveWalletKeys,
  fetchAnyManifest,
  NECTAR_TRUSTED_HOST,
  listLinks,
  parseLinkInput,
  removeLink,
  saveLink,
  submitLink,
  type ConsentMode,
  type NectarLinkRecord,
  type NectarManifest,
} from "@/lib/nectar/link";
import { isEcosystemSite, loginSiteName } from "@/lib/web-login-hosts";
import { submitRequested, type RequestedManifest } from "@/lib/xpub-link/requested";

export function NectarLinkCard({ compact, initialPayload }: { compact?: boolean; initialPayload?: string }) {
  const { unlocked } = useWallet();
  const seedless = !unlocked || unlocked.mode === "keyonly" || !unlocked.mnemonic;

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manifest, setManifest] = useState<NectarManifest | null>(null);
  const [requested, setRequested] = useState<RequestedManifest | null>(null);
  const [ackHost, setAckHost] = useState(false);
  const [mode, setMode] = useState<ConsentMode>("silent");
  const [ackNewWallet, setAckNewWallet] = useState(false);
  const [links, setLinks] = useState<NectarLinkRecord[]>([]);

  useEffect(() => {
    setLinks(listLinks());
  }, [unlocked]);

  // A link QR scanned from the main camera arrives here pre-filled.
  const [handledInitial, setHandledInitial] = useState(false);
  useEffect(() => {
    if (handledInitial || !initialPayload || !unlocked?.mnemonic) return;
    setHandledInitial(true);
    setInput(initialPayload);
    void onLoad(initialPayload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayload, unlocked, handledInitial]);

  async function onLoad(raw: string) {
    setError(null);
    setNotice(null);
    setManifest(null);
    setRequested(null);
    setAckHost(false);
    setAckNewWallet(false);
    const url = parseLinkInput(raw);
    if (!url) {
      setError("That isn't a wallet link.");
      return;
    }
    if (!unlocked?.mnemonic) return;
    setBusy(true);
    try {
      const any = await fetchAnyManifest(url);
      if (any.kind === "requested") {
        setRequested(any);
        return;
      }
      const m = any;
      const keys = await deriveWalletKeys(unlocked.mnemonic, unlocked.passphrase ?? "");
      setMode(consentMode(m, keys.identityAddress));
      setManifest(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that link.");
    } finally {
      setBusy(false);
    }
  }

  async function onApproveRequested() {
    if (!requested || !unlocked?.mnemonic) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitRequested({
        manifest: requested,
        mnemonic: unlocked.mnemonic,
        passphrase: unlocked.passphrase ?? "",
      });
      saveLink({
        merchantId: `${requested.host}:${requested.keys[0]!.path}`,
        merchantName: `${res.appName} (${requested.host})`,
        url: requested.manifestUrl,
        linkedAt: new Date().toISOString(),
      });
      setLinks(listLinks());
      setRequested(null);
      setInput("");
      setNotice(`Linked to ${res.appName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    if (!manifest || !unlocked?.mnemonic) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitLink({
        manifest,
        mnemonic: unlocked.mnemonic,
        passphrase: unlocked.passphrase ?? "",
      });
      const record: NectarLinkRecord = {
        merchantId: res.store_id ?? manifest.store_id ?? manifest.challenge_id,
        merchantName: res.merchant_name ?? manifest.merchant_name ?? "Nectar Pay merchant",
        url: manifest.manifest_url,
        linkedAt: new Date().toISOString(),
      };
      saveLink(record);
      setLinks(listLinks());
      setManifest(null);
      setInput("");
      setNotice(`Linked to ${record.merchantName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed.");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Shares watch-only account keys (xpubs) with Nectar Pay, Bonfire, or any site that
        shows a wallet link code. Sites can see addresses but never spend. Your seed phrase and private keys never leave this device.
      </p>

      {seedless ? (
        <p className="text-xs text-muted-foreground">
          Only seed-phrase wallets can be linked.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste link URL"
              className="text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <QrScanButton
              onScan={(text) => {
                setInput(text);
                void onLoad(text);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || !input.trim()}
              onClick={() => void onLoad(input)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Read"}
            </Button>
          </div>

          {requested && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm font-medium">{requested.appName}</div>
              <div className="text-xs text-muted-foreground break-all">{requested.host}</div>
              {isEcosystemSite(requested.host) ? (
                <p className="text-xs text-primary">
                  Verified honest.money ecosystem site ({loginSiteName(requested.host)}).
                </p>
              ) : (
                <p className="text-xs text-destructive">
                  Not a listed honest.money ecosystem site. Only continue if you started this yourself.
                </p>
              )}
              {requested.purpose && (
                <p className="text-xs text-muted-foreground">{requested.purpose}</p>
              )}
              <div className="text-xs">
                Requesting one watch-only key:{" "}
                <span className="font-mono">
                  {requested.keys[0]!.chain} {requested.keys[0]!.path}
                </span>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <Checkbox checked={ackHost} onCheckedChange={(v) => setAckHost(v === true)} />
                <span>
                  I trust <b>{requested.host}</b> to see the addresses on this branch. It can't
                  spend anything.
                </span>
              </label>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy || !ackHost} onClick={() => void onApproveRequested()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Share xpub"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRequested(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {manifest && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm font-medium">
                {manifest.merchant_name ?? "Nectar Pay merchant"}
              </div>
              {manifest.from !== NECTAR_TRUSTED_HOST && (
                <div className="text-xs text-destructive break-all">
                  Not Nectar Pay: {manifest.from}. Only continue if you trust this site.
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Requesting: {manifest.chains.join(", ")}
              </div>
              {mode === "blocked" ? (
                <p className="text-xs text-destructive">
                  Another wallet is already on file for this merchant. Ask them to re-issue the
                  link with new wallets allowed.
                </p>
              ) : (
                <>
                  {mode === "confirm-new-wallet" && (
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox
                        checked={ackNewWallet}
                        onCheckedChange={(v) => setAckNewWallet(v === true)}
                      />
                      <span>
                        This merchant has a different wallet on file. Link this wallet instead.
                      </span>
                    </label>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || (mode === "confirm-new-wallet" && !ackNewWallet)}
                      onClick={() => void onApprove()}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Share xpubs"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setManifest(null)}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

          {links.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-xs font-medium text-muted-foreground">Linked merchants</div>
              {links.map((l) => (
                <div key={l.merchantId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {l.merchantName}
                    <span className="text-muted-foreground">
                      {" "}
                      · {new Date(l.linkedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Forget ${l.merchantName}`}
                    onClick={() => {
                      removeLink(l.merchantId);
                      setLinks(listLinks());
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (compact) return body;

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" /> Merchant xpub link
        </CardTitle>
        <CardDescription>Link this wallet to Nectar Pay, Bonfire, and other sites.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
