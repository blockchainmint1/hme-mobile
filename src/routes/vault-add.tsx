/**
 * Add a Vault wallet: pair with an HME Vault device by scanning its
 * watch-only pairing QR. We store only account xpubs + fingerprint — this
 * profile can see balances and build transactions, but every signature
 * happens on the Vault device.
 */
import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ScanLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { useWallet } from "@/lib/txc/wallet-context";
import { createVaultWallet, saveWalletToNewProfile } from "@/lib/txc/storage";
import { getSessionPassword } from "@/lib/txc/session-cache";
import { parsePairing, savePairing, type VaultPairing } from "@/lib/vault-link/pairing";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { pairingPreviewAddresses, VAULT_CHAIN_META } from "@/lib/vault-link/derive";

export const Route = createFileRoute("/vault-add")({
  head: () => ({
    meta: [
      { title: "Add a Vault wallet — HME Wallet" },
      { name: "description", content: "Pair an HME Vault offline signer by QR code." },
      { property: "og:title", content: "Add a Vault wallet — HME Wallet" },
      { property: "og:description", content: "Pair an HME Vault offline signer by QR code." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VaultAddPage,
});

function VaultAddPage() {
  const navigate = useNavigate();
  const { loadFromMemory, refreshProfiles } = useWallet();
  const [raw, setRaw] = useState("");
  const [pairing, setPairing] = useState<VaultPairing | null>(null);
  const [label, setLabel] = useState("Vault");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ have: number; total: number } | null>(null);
  const collectorRef = useRef<PartCollector | null>(null);

  function tryParse(text: string) {
    setError(null);
    try {
      setPairing(parsePairing(text));
    } catch (e) {
      setPairing(null);
      setError((e as Error).message);
    }
  }

  // Vault shows the pairing payload as an animated QR when it's long: each
  // frame is one HMQR2 chunk. Collect frames until the transfer completes,
  // then parse the reassembled payload. Single-frame codes parse directly.
  function onScanned(text: string) {
    if (pairing) return;
    if (!text.startsWith("HMQR")) {
      setRaw(text);
      tryParse(text);
      return;
    }
    try {
      const collector = (collectorRef.current ??= new PartCollector());
      const done = collector.add(text);
      setScanProgress(collector.progress);
      if (done) {
        collectorRef.current = null;
        setScanProgress(null);
        setRaw(done);
        tryParse(done);
      }
    } catch (e) {
      collectorRef.current = null;
      setScanProgress(null);
      setError((e as Error).message);
    }
  }

  async function create() {
    if (!pairing) return;
    const password = getSessionPassword();
    if (!password) {
      setError("Your session has locked. Go back, unlock your wallet, and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const unlocked = await createVaultWallet(password, label.trim() || "Vault");
      const profileId = await saveWalletToNewProfile(unlocked, password);
      savePairing(profileId, pairing);
      await loadFromMemory(unlocked);
      refreshProfiles();
      toast.success("Vault wallet added");
      void navigate({ to: "/wallet" });
    } catch (e) {
      setError((e as Error).message || "Couldn't create the Vault wallet.");
    } finally {
      setBusy(false);
    }
  }

  const preview = pairing ? pairingPreviewAddresses(pairing) : [];

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Add a Vault wallet
          </CardTitle>
          <CardDescription>
            Pair with HME Vault, the offline signing app. This wallet can see balances and prepare
            payments, but every signature happens on the Vault device — no seed or private key is
            ever stored here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pairing && (
            <>
              <p className="text-sm text-muted-foreground">
                On your Vault device, open the wallet and choose{" "}
                <span className="font-medium text-foreground">Share watch-only keys</span>, then
                scan the QR it shows.
              </p>
              <div className="flex items-center gap-2">
                <QrScanButton
                  onScan={(text) => {
                    setRaw(text);
                    tryParse(text);
                  }}
                />
                <span className="text-xs text-muted-foreground">Scan the Vault pairing QR</span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">…or paste the pairing code:</p>
                <Textarea
                  value={raw}
                  onChange={(e) => {
                    setRaw(e.target.value);
                    if (e.target.value.trim()) tryParse(e.target.value);
                    else {
                      setPairing(null);
                      setError(null);
                    }
                  }}
                  placeholder='{"hmvault":1,…}'
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
            </>
          )}

          {pairing && (
            <>
              <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-2">
                <p className="text-sm">
                  Wallet fingerprint: <span className="font-mono font-medium">{pairing.fp}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Check this matches what your Vault device shows. If it doesn't, cancel — you may
                  be pairing with the wrong device.
                </p>
                <div className="space-y-1 pt-1">
                  {preview.map((p) => (
                    <div key={`${p.chain}-${p.purpose}`} className="text-xs">
                      <span className="text-muted-foreground">
                        {VAULT_CHAIN_META[p.chain].unit} ·{" "}
                        {p.purpose === 84 ? "segwit" : p.purpose === 49 ? "wrapped" : "legacy"}:
                      </span>{" "}
                      <span className="font-mono break-all">{p.address}</span>
                    </div>
                  ))}
                  {pairing.evm && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">ETH/EVM:</span>{" "}
                      <span className="font-mono break-all">{pairing.evm.address}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Confirm the first address of each chain matches the address shown on your Vault
                  device.
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Name for this wallet</p>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
              </div>

              <div className="flex gap-2">
                <Button onClick={create} disabled={busy} className="flex-1">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4 mr-2" />}
                  {busy ? "Adding…" : "Add Vault wallet"}
                </Button>
                <Button variant="ghost" onClick={() => { setPairing(null); setRaw(""); setError(null); }}>
                  Start over
                </Button>
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/wallet" })}>
        Back to wallet
      </Button>
    </div>
  );
}
