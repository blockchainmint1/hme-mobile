import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { fetchLoginMessage, parseLoginInput, signInToNectar, type NectarLoginRequest } from "@/lib/nectar/auth";
import { lastSignedInAt, rememberSignIn } from "@/lib/web-login-history";
import { useWallet } from "@/lib/txc/wallet-context";

/**
 * "Sign in to a website" flow: scan any site's sign-in QR, review the exact
 * login message, approve, and the signature goes back to the site. No payment
 * is authorized. Sites we don't recognize get a warning plus a second confirm.
 */
export function WebsiteSignInCard({ initialPayload }: { initialPayload?: string }) {
  const { unlocked } = useWallet();
  const seedless = !unlocked || unlocked.mode === "keyonly" || !unlocked.mnemonic;

  const [loginRequest, setLoginRequest] = useState<(NectarLoginRequest & { message: string }) | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginDone, setLoginDone] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [confirmedUnknown, setConfirmedUnknown] = useState(false);
  const handledInitial = useRef(false);

  const seenBefore = useMemo(
    () => (loginRequest ? lastSignedInAt(loginRequest.origin) : null),
    [loginRequest],
  );

  async function onScan(text: string) {
    setLoginError(null);
    setLoginDone(false);
    setLoginRequest(null);
    setConfirmedUnknown(false);
    try {
      const request = parseLoginInput(text);
      setLoginRequest(await fetchLoginMessage(request));
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Could not read this sign-in request.");
    }
  }

  // A sign-in QR scanned from the main camera arrives as initialPayload.
  useEffect(() => {
    if (handledInitial.current || !initialPayload) return;
    handledInitial.current = true;
    void onScan(initialPayload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayload]);

  async function onApprove() {
    if (!unlocked?.mnemonic || !loginRequest) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      await signInToNectar({
        request: loginRequest,
        mnemonic: unlocked.mnemonic,
        passphrase: unlocked.passphrase,
      });
      rememberSignIn(loginRequest.origin);
      setLoginDone(true);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Could not complete sign-in.");
    } finally {
      setLoginBusy(false);
    }
  }

  if (seedless) {
    return (
      <p className="text-sm text-muted-foreground">
        Website sign-in needs a seed-based wallet. Key-only wallets can&apos;t sign in here yet.
      </p>
    );
  }

  const unknownSite = loginRequest?.tier === "unknown";
  const needsExtraConfirm = unknownSite && !confirmedUnknown;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Sign in to a website</p>
          <p className="text-xs text-muted-foreground">
            Scan a sign-in QR from any site that supports wallet sign-in. We sign you in with your
            wallet — no payment is authorized.
          </p>
        </div>
        <QrScanButton onScan={onScan} />
      </div>
      {loginRequest && (
        <div className="space-y-3 rounded-md border border-border/60 p-3">
          {unknownSite ? (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="space-y-1 text-xs">
                <p className="font-medium text-foreground">{loginRequest.origin}</p>
                <p className="text-muted-foreground">
                  This site isn&apos;t one the wallet recognizes. Only continue if you started this
                  sign-in yourself and the address above is exactly the site you expect. Signing
                  proves you own your address — it never moves any funds.
                </p>
                {seenBefore && (
                  <p className="text-muted-foreground">
                    You signed in here before on {new Date(seenBefore).toLocaleDateString()}.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>
                <span className="font-medium text-foreground">{loginRequest.siteName}</span>{" "}
                (<span className="font-medium text-foreground">{loginRequest.origin}</span>) is asking
                this wallet to sign a temporary login message.
              </span>
            </p>
          )}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">{loginRequest.message}</pre>
          {needsExtraConfirm ? (
            <Button onClick={() => setConfirmedUnknown(true)} size="sm" variant="outline">
              I trust {loginRequest.origin} — continue
            </Button>
          ) : (
            <Button onClick={onApprove} disabled={loginBusy || loginDone} size="sm">
              {loginDone
                ? "Signed in"
                : loginBusy
                  ? "Signing…"
                  : `Approve sign-in to ${loginRequest.siteName}`}
            </Button>
          )}
        </div>
      )}
      {loginError && <p className="text-sm text-destructive">{loginError}</p>}
      {loginDone && (
        <p className="text-sm text-emerald-500">
          The site accepted the signature. You can return to the sign-in window.
        </p>
      )}
    </div>
  );
}
