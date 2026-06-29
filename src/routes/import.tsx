import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { validateMnemonic, normalizeMnemonic } from "@/lib/txc/wallet";
import { saveWallet } from "@/lib/txc/storage";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DerivationKind } from "@/lib/txc/network";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import wallet — TEXITcoin Wallet" },
      {
        name: "description",
        content: "Import your existing TEXITcoin seed phrase from the old TXC Wallet app.",
      },
    ],
  }),
  component: ImportPage,
});

function ImportPage() {
  const navigate = useNavigate();
  const { loadFromMemory } = useWallet();
  const [phrase, setPhrase] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [kind, setKind] = useState<DerivationKind>("bip84");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const m = normalizeMnemonic(phrase);
    if (!validateMnemonic(m)) {
      setError("That doesn't look like a valid 12 or 24-word BIP39 seed.");
      return;
    }
    if (password.length < 8) {
      setError("Wallet password needs at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const u = { mnemonic: m, passphrase, kind, label: "Imported wallet" };
      await saveWallet(u, password);
      await loadFromMemory(u);
      navigate({ to: "/wallet" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Import seed phrase</h1>
      <p className="mt-2 text-muted-foreground">
        Paste the 12 or 24-word BIP39 seed phrase from your existing TEXITcoin wallet. This stays
        on your device — it's never sent to a server.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your seed phrase</CardTitle>
          <CardDescription>One word per space, all lowercase. Order matters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={4}
              placeholder="abandon ability able about above ..."
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              autoFocus
            />

            <div>
              <Label htmlFor="bip39pp">Optional BIP39 passphrase</Label>
              <Input
                id="bip39pp"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Leave blank if you didn't set one"
                autoComplete="off"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Different from the wallet password below — this is the optional 25th-word
                passphrase you may have set when creating the original wallet.
              </p>
            </div>

            <div>
              <Label>Address type</Label>
              <RadioGroup
                value={kind}
                onValueChange={(v) => setKind(v as DerivationKind)}
                className="mt-2 space-y-2"
              >
                <label className="flex items-start gap-2 cursor-pointer">
                  <RadioGroupItem value="bip84" className="mt-1" />
                  <span>
                    <span className="font-medium">Native segwit (default)</span>{" "}
                    <span className="text-xs text-muted-foreground">— starts with txc1...</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <RadioGroupItem value="bip49" className="mt-1" />
                  <span>
                    <span className="font-medium">Wrapped segwit</span>{" "}
                    <span className="text-xs text-muted-foreground">— P2SH legacy compatibility</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <RadioGroupItem value="bip44" className="mt-1" />
                  <span>
                    <span className="font-medium">Legacy</span>{" "}
                    <span className="text-xs text-muted-foreground">— starts with T...</span>
                  </span>
                </label>
              </RadioGroup>
              <p className="text-xs text-muted-foreground mt-2">
                If you're not sure, try native segwit first. You can re-import with a different
                type from Settings.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-border/60">
              <div>
                <Label htmlFor="pw1">Wallet password</Label>
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
                <Label htmlFor="pw2">Confirm</Label>
                <Input
                  id="pw2"
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  autoComplete="new-password"
                  className="mt-1"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
              </div>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Importing..." : "Import wallet"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
