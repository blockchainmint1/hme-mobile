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
      { name: "description", content: "Generate a new wallet and back up the seed phrase." },
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
  const [scribbleProgress, setScribbleProgress] = useState(0);
  const [locked, setLocked] = useState(false);

  // Pre-generate a draft so we have something to mix into when the user
  // first taps the pad — but we won't show it until they lock in.
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
    if (!locked) {
      setError("Lock in your scribble first so the seed phrase stops changing.");
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
        These 24 words are the only way to recover your wallet. Write them down on paper and
        store them somewhere safe. Never share them. Never type them into a website you don't
        trust.
      </p>

      {!locked ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Add your own randomness
            </CardTitle>
            <CardDescription>
              Scribble in the pad to mix your own entropy into the seed. Your
              words stay hidden until you lock it in — that way you can't
              accidentally write down a phrase that's about to change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScribblePad
              onStart={() => {
                try {
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
              onProgress={setScribbleProgress}
            />
            <Button
              type="button"
              onClick={() => setLocked(true)}
              disabled={!mnemonic || scribbleProgress < 1}
              className="mt-4 w-full gap-2"
            >
              <Lock className="h-4 w-4" />
              {scribbleProgress < 1 ? "Keep scribbling to fill the bar…" : "Lock in & reveal seed phrase"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground text-center">
              Your randomness is always combined with secure device randomness —
              scribbling can only make the seed stronger, never weaker.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-6">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span className="font-medium">Randomness locked in</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  draftMnemonic = generateMnemonic(256);
                  setMnemonic(draftMnemonic);
                  setConfirmedBackup(false);
                  setScribbleProgress(0);
                  setLocked(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not regenerate seed");
                }
              }}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Redo
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6 border-amber-700/40 bg-amber-950/10">
        <CardContent className="pt-6">
          {!locked ? (
            <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-10 text-center text-sm text-muted-foreground">
              <Lock className="mx-auto mb-2 h-5 w-5 opacity-60" />
              Your seed phrase will appear here once you lock in the scribble above.
            </div>
          ) : mnemonic ? (
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
          {locked && (
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
          )}
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

            <Button type="submit" disabled={busy || !mnemonic || !locked} className="w-full">
              {busy ? "Saving..." : !locked ? "Lock in your scribble first" : "Open my wallet"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
