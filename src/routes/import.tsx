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
import { formatTxc } from "@/lib/txc/units";
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
      { title: "Import wallet — HME Wallet" },
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
  bip49: "Wrapped segwit",
  bip44: "Legacy (T…)",
};

const IMPORT_GAP_LIMIT = 20;
const IMPORT_MAX_INDEX = 120;

interface Candidate {
  kind: DerivationKind;
  address: string;
  txCount: number;
  balanceSats: number;
  usedAddresses: number;
}

interface ImportScanResult extends Candidate {
  checkedAddresses: number;
  failedChecks: number;
}

async function scanChainForImport(
  root: ReturnType<typeof rootFromSeed>,
  kind: DerivationKind,
  change: 0 | 1,
): Promise<Omit<ImportScanResult, "kind" | "address">> {
  let checkedAddresses = 0;
  let failedChecks = 0;
  let txCount = 0;
  let balanceSats = 0;
  let usedAddresses = 0;

  for (let start = 0; start < IMPORT_MAX_INDEX; start += IMPORT_GAP_LIMIT) {
    const batch = Array.from({ length: IMPORT_GAP_LIMIT }, (_, offset) =>
      deriveAddress(root, kind, change, start + offset),
    );
    checkedAddresses += batch.length;

    const stats = await Promise.all(
      batch.map(async (derived) => {
        try {
          return { derived, stats: await getAddressStats(derived.address), failed: false };
        } catch {
          return { derived, stats: null, failed: true };
        }
      }),
    );

    let batchHadActivity = false;
    for (const item of stats) {
      if (item.failed || !item.stats) {
        failedChecks += 1;
        continue;
      }
      const chain = item.stats.chain_stats;
      const mempool = item.stats.mempool_stats;
      const itemTxCount = chain.tx_count + mempool.tx_count;
      const itemBalance =
        chain.funded_txo_sum -
        chain.spent_txo_sum +
        mempool.funded_txo_sum -
        mempool.spent_txo_sum;
      if (itemTxCount > 0 || itemBalance > 0) {
        batchHadActivity = true;
        usedAddresses += 1;
        txCount += itemTxCount;
        balanceSats += itemBalance;
      }
    }

    // Standard wallet discovery: stop after a full unused gap window.
    if (!batchHadActivity) break;
  }

  return { txCount, balanceSats, usedAddresses, checkedAddresses, failedChecks };
}

async function scanKindForImport(
  root: ReturnType<typeof rootFromSeed>,
  kind: DerivationKind,
): Promise<ImportScanResult> {
  const firstAddress = deriveAddress(root, kind, 0, 0).address;
  const [external, internal] = await Promise.all([
    scanChainForImport(root, kind, 0),
    scanChainForImport(root, kind, 1),
  ]);

  return {
    kind,
    address: firstAddress,
    txCount: external.txCount + internal.txCount,
    balanceSats: external.balanceSats + internal.balanceSats,
    usedAddresses: external.usedAddresses + internal.usedAddresses,
    checkedAddresses: external.checkedAddresses + internal.checkedAddresses,
    failedChecks: external.failedChecks + internal.failedChecks,
  };
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

      setStatus("Looking for activity across TEXITcoin address types…");
      const probes = await Promise.all(kinds.map((kind) => scanKindForImport(root, kind)));

      const failedChecks = probes.reduce((sum, p) => sum + p.failedChecks, 0);
      const checkedAddresses = probes.reduce((sum, p) => sum + p.checkedAddresses, 0);
      if (checkedAddresses > 0 && failedChecks === checkedAddresses) {
        throw new Error("Couldn't reach the TEXITcoin network. Check your connection and try again.");
      }

      const active = probes.filter((p) => p.txCount > 0);

      if (active.length === 0) {
        // No history found — don't silently choose the wrong address type.
        setCandidates(probes);
        setBusy(false);
        setStatus("");
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
        <h1 className="text-2xl font-bold">
          {candidates.some((c) => c.txCount > 0)
            ? "We found more than one wallet"
            : "Choose the wallet type"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {candidates.some((c) => c.txCount > 0)
            ? "Your seed phrase has activity on multiple address types. Pick the one you want to import."
            : "We didn't find TEXITcoin activity in the normal scan window. If this is an old wallet, Legacy is usually the best next try; otherwise use Native segwit for a new wallet."}
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
                {c.usedAddresses > 0 ? ` · ${c.usedAddresses} used address${c.usedAddresses === 1 ? "" : "es"}` : ""}
                {c.balanceSats > 0 ? ` · ${formatTxc(c.balanceSats)}` : ""}
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
