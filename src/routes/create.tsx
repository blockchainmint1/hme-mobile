import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { generateMnemonic, generateMnemonicFromUserEntropy } from "@/lib/txc/wallet";
import { saveWallet } from "@/lib/txc/storage";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle, Check, Copy, Lock, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import { ScribblePad } from "@/components/wallet/ScribblePad";

// Hold the draft mnemonic in an in-memory module variable instead of
// sessionStorage. sessionStorage is readable by any script on the origin
// (extensions, XSS, devtools) — the seed phrase must never live there.
// Trade-off: a hard refresh during creation discards the draft and the user
// generates a fresh one. That is the correct security posture.
let draftMnemonic: string | null = null;

function getOrCreateDraftMnemonic() {
  if (draftMnemonic) return draftMnemonic;
  draftMnemonic = generateMnemonic(256);
  return draftMnemonic;
}

function clearDraftMnemonic() {
  draftMnemonic = null;
}

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create wallet — HME Wallet" },
      { name: "description", content: "Generate a new TEXITcoin wallet and back up the seed phrase." },
    ],
  }),
  component: CreatePage,
});

function CreatePage() {
  const navigate = useNavigate();
  const { loadFromMemory } = useWallet();
  const [mnemonic, setMnemonic] = useState("");
  const words = mnemonic ? mnemonic.split(" ") : [];
  const [confirmedBackup, setConfirmedBackup] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mnemonic) {
      try {
        setMnemonic(getOrCreateDraftMnemonic());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate seed phrase");
      }
    }
  }, [mnemonic]);

  async function finalize(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setError("Passwords don't match.");
      return;
    }
    if (!confirmedBackup) {
      setError("Please confirm you wrote down the seed phrase.");
      return;
    }
    if (!mnemonic) {
      setError("Seed phrase is still generating. Try again in a moment.");
      return;
    }
    setBusy(true);
    try {
      const u = { mnemonic, passphrase: "", kind: "bip84" as const, label: "Main wallet" };
      await saveWallet(u, password);
      await loadFromMemory(u);
      clearDraftMnemonic();
      navigate({ to: "/wallet" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save wallet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Back up your seed phrase</h1>
      <p className="mt-2 text-muted-foreground">
        These 24 words are the only way to recover your TEXITcoin. Write them down on paper and
        store them somewhere safe. Never share them. Never type them into a website you don't
        trust.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Add your own randomness
          </CardTitle>
          <CardDescription>
            Scribble in the pad to mix your own entropy into the seed below.
            Touching the pad immediately generates a new seed phrase — any
            words you already wrote down will no longer be valid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScribblePad
            onStart={() => {
              try {
                // Any touch invalidates the prior phrase. Regenerate from
                // fresh secure randomness right away so the user sees new
                // words the instant they tap.
                draftMnemonic = generateMnemonic(256);
                setMnemonic(draftMnemonic);
                setConfirmedBackup(false);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not regenerate seed");
              }
            }}
            onEntropy={(bytes) => {
              try {
                draftMnemonic = generateMnemonicFromUserEntropy(bytes, 256);
                setMnemonic(draftMnemonic);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not mix entropy");
              }
            }}
          />
        </CardContent>
      </Card>

      <Card className="mt-6 border-amber-700/40 bg-amber-950/10">
        <CardContent className="pt-6">
          {mnemonic ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {words.map((w, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 font-mono text-sm"
                >
                  <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-8 text-center text-sm text-destructive">
              {error}
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-background/60 px-3 py-8 text-center text-sm text-muted-foreground">
              Generating seed phrase…
            </div>
          )}
          <button
            type="button"
            disabled={!mnemonic}
            onClick={async () => {
              const ok = await copyToClipboard(mnemonic);
              if (ok) {
                toast.success("Seed copied. Paste into a paper-only backup, then clear clipboard.");
              } else {
                toast.error("Could not copy. Long-press a word to select, or write it down by hand.");
              }
            }}
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copy to clipboard
          </button>
        </CardContent>
      </Card>


      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Set a wallet password</CardTitle>
          <CardDescription>
            Encrypts your seed inside this browser. You'll enter it each time you open the wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={finalize} className="space-y-4">
            <div>
              <Label htmlFor="pw1">Password</Label>
              <Input
                id="pw1"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="pw2">Confirm password</Label>
              <Input
                id="pw2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                className="mt-1"
              />
            </div>
            <div className="flex items-start gap-3 text-sm">
              <input
                id="backup-confirmed"
                type="checkbox"
                checked={confirmedBackup}
                onChange={(e) => setConfirmedBackup(e.currentTarget.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-md border border-input bg-background accent-primary"
              />
              <Label htmlFor="backup-confirmed" className="flex-1 leading-relaxed">
                I wrote down all 24 words in order. I understand that losing them means losing my
                coins, and that the password alone cannot recover them.
              </Label>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
              </div>
            )}

            <Button type="submit" disabled={busy || !mnemonic} className="w-full">
              {busy ? "Saving..." : "Open my wallet"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
