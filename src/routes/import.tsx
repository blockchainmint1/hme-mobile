import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  validateMnemonic,
  normalizeMnemonic,
  seedFromMnemonic,
  rootFromSeed,
  deriveAddress,
} from "@/lib/txc/wallet";
import { saveWallet } from "@/lib/txc/storage";
import { useWallet } from "@/lib/txc/wallet-context";
import { getAddressStats } from "@/lib/txc/mempool";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { DerivationKind } from "@/lib/txc/network";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";

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

const KIND_LABEL: Record<DerivationKind, string> = {
  bip84: "Native segwit (txc1…)",
  bip49: "Wrapped segwit (3…)",
  bip44: "Legacy (T…)",
};

interface Candidate {
  kind: DerivationKind;
  address: string;
  txCount: number;
}

function ImportPage() {
  const navigate = useNavigate();
  const { loadFromMemory } = useWallet();
  const [phrase, setPhrase] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  async function finish(kind: DerivationKind) {
    const m = normalizeMnemonic(phrase);
    setBusy(true);
    setStatus("Saving wallet…");
    try {
      const u = { mnemonic: m, passphrase, kind, label: "Imported wallet" };
      await saveWallet(u, password);
      await loadFromMemory(u);
      navigate({ to: "/wallet" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setBusy(false);
      setStatus("");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCandidates(null);
    const m = normalizeMnemonic(phrase);
    if (!validateMnemonic(m)) {
      setError("That doesn't look like a valid 12 or 24-word seed phrase.");
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
    setStatus("Checking your wallet on the TEXITcoin network…");

    try {
      const seed = await seedFromMnemonic(m, passphrase);
      const root = rootFromSeed(seed);
      const kinds: DerivationKind[] = ["bip84", "bip49", "bip44"];

      // Probe address index 0 of each derivation in parallel.
      const probes = await Promise.all(
        kinds.map(async (kind) => {
          const d = deriveAddress(root, kind, 0, 0);
          try {
            const stats = await getAddressStats(d.address);
            const tx = stats.chain_stats.tx_count + stats.mempool_stats.tx_count;
            return { kind, address: d.address, txCount: tx } as Candidate;
          } catch {
            return { kind, address: d.address, txCount: 0 } as Candidate;
          }
        }),
      );

      const active = probes.filter((p) => p.txCount > 0);

      if (active.length === 0) {
        // No history found — go with modern default. User can re-import if needed.
        await finish("bip84");
        return;
      }
      if (active.length === 1) {
        await finish(active[0].kind);
        return;
      }
      // Multiple match — let user pick.
      setCandidates(active);
      setBusy(false);
      setStatus("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setBusy(false);
      setStatus("");
    }
  }

  if (candidates) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">We found more than one wallet</h1>
        <p className="mt-2 text-muted-foreground">
          Your seed phrase has activity on multiple address types. Pick the one you want to
          import. (You can import the others later from Settings.)
        </p>
        <div className="mt-6 space-y-3">
          {candidates.map((c) => (
            <button
              key={c.kind}
              onClick={() => finish(c.kind)}
              disabled={busy}
              className="w-full rounded-lg border border-border p-4 text-left hover:bg-muted/50 disabled:opacity-50"
            >
              <div className="font-medium">{KIND_LABEL[c.kind]}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground break-all">
                {c.address}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {c.txCount} transaction{c.txCount === 1 ? "" : "s"}
              </div>
            </button>
          ))}
        </div>
        {busy && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {status}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Import your wallet</h1>
      <p className="mt-2 text-muted-foreground">
        Paste your seed phrase from the old TXC Wallet app and choose a new password. We'll
        figure out the rest. Nothing leaves your device.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Seed phrase</CardTitle>
          <CardDescription>12 or 24 words, separated by spaces.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={4}
              placeholder="abandon ability able about above ..."
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono"
              autoFocus
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="pw1">New password</Label>
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
            <p className="-mt-2 text-xs text-muted-foreground">
              This password unlocks the wallet on this device. It's separate from your seed
              phrase.
            </p>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                Advanced
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <Label htmlFor="bip39pp" className="text-xs">
                  BIP39 passphrase (25th word)
                </Label>
                <Input
                  id="bip39pp"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Leave blank if you didn't set one"
                  autoComplete="off"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Only fill this in if you explicitly set a passphrase when you first created
                  your wallet. Almost nobody does.
                </p>
              </CollapsibleContent>
            </Collapsible>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
              </div>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {status || "Working…"}
                </span>
              ) : (
                "Import wallet"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
