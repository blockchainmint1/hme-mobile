import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { hasWallet } from "@/lib/txc/storage";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  getBiometricStatus,
  unlockWithBiometric,
} from "@/lib/native/biometric";
import txcIcon from "@/assets/txc-icon-512.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TEXITcoin Wallet — self-custodial TXC" },
      {
        name: "description",
        content:
          "Open a TEXITcoin wallet in seconds. Import an existing seed phrase from the old TXC Wallet app, or create a new one. Your keys stay on your device.",
      },
      { property: "og:title", content: "TEXITcoin Wallet — self-custodial TXC" },
      {
        property: "og:description",
        content: "Send and receive TXC. Import or create a wallet in seconds.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const { unlock, unlocked } = useWallet();
  const [exists, setExists] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState<{ available: boolean; enabled: boolean }>({
    available: false,
    enabled: false,
  });

  useEffect(() => {
    setExists(hasWallet());
    getBiometricStatus().then(setBio).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (unlocked) navigate({ to: "/wallet" });
  }, [unlocked, navigate]);

  const tryBiometric = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const pw = await unlockWithBiometric();
      if (!pw) {
        setBusy(false);
        return;
      }
      const ok = await unlock(pw);
      if (!ok) setError("Stored biometric password no longer matches. Use your password.");
      else navigate({ to: "/wallet" });
    } finally {
      setBusy(false);
    }
  }, [unlock, navigate]);

  // Auto-prompt biometrics once on landing if it's enabled.
  useEffect(() => {
    if (exists && bio.enabled && !unlocked) {
      void tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exists, bio.enabled]);

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const ok = await unlock(password);
    setBusy(false);
    if (!ok) setError("Wrong password.");
    else navigate({ to: "/wallet" });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pt-16 pb-12">
      <header className="text-center mb-12">
        <img
          src={txcIcon.url}
          alt="TEXITcoin"
          className="w-16 h-16 rounded-2xl mb-5 shadow-lg shadow-amber-900/40"
        />
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">TEXITcoin Wallet</h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          A self-custodial wallet for TEXITcoin (TXC). Your seed phrase stays on your device,
          encrypted with your password.
        </p>
      </header>

      {exists ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Unlock your wallet</CardTitle>
            <CardDescription>Enter the password you set when this wallet was created.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onUnlock} className="space-y-4">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Wallet password"
                autoFocus
                autoComplete="current-password"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={busy || !password}>
                  {busy ? "Unlocking..." : "Unlock"}
                </Button>
                {bio.enabled && (
                  <Button type="button" variant="secondary" onClick={tryBiometric} disabled={busy}>
                    <Fingerprint className="h-4 w-4 mr-1.5" />
                    Use biometrics
                  </Button>
                )}
                <Button asChild variant="ghost">
                  <Link to="/import">Import a different wallet</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-border/60 hover:border-primary/60 transition-colors">
            <CardHeader>
              <CardTitle>I already have a wallet</CardTitle>
              <CardDescription>
                Already use the old TXC Wallet app? Open it, write down your 12 / 24-word seed,
                and import it here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link to="/import">Import seed phrase</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 hover:border-primary/60 transition-colors">
            <CardHeader>
              <CardTitle>Create a new wallet</CardTitle>
              <CardDescription>
                Generate a fresh 12-word seed phrase. You'll back it up on the next screen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" className="w-full">
                <Link to="/create">Create new wallet</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <section className="mt-12 rounded-xl border border-border/60 bg-card/40 p-5 text-sm text-muted-foreground">
        <h2 className="font-semibold text-foreground mb-2">Moving from the old TXC Wallet app?</h2>
        <p>
          This is a brand-new app. It <strong>cannot</strong> read the old app's storage, so
          installing it will <strong>not</strong> overwrite or change anything in your existing
          wallet. To move funds: open the old app, back up your seed phrase, then choose
          <em> Import seed phrase</em> here.
        </p>
      </section>
    </main>
  );
}
