import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VaultAnimatedQr } from "./VaultAnimatedQr";
import { QrScanButton } from "./QrScanButton";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { verifyVaultEvmSend } from "@/lib/vault-link/evm-send";
import type { EvmIntent } from "@/lib/vault-link/evm-intent";
import { evmClient, type EvmChainId } from "@/lib/chains/evm";
import type { Hex } from "viem";

export function VaultEvmSigning({ payload, chain, onSent, onBack }: { payload: string; chain: EvmChainId; onSent: (hash: Hex) => void; onBack: () => void }) {
  const collector = useRef(new PartCollector());
  const processing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  async function scan(frame: string) {
    if (processing.current) return;
    try {
      const full = collector.current.add(frame);
      if (!full) { setProgress("Reading signed transaction…"); return; }
      collector.current = new PartCollector();
      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(full.trim())) throw new Error("That QR does not contain a signed Ethereum transaction.");
      processing.current = true;
      setBusy(true);
      setError(null);
      const raw = full.trim() as Hex;
      await verifyVaultEvmSend(raw, JSON.parse(payload) as EvmIntent);
      const hash = await evmClient(chain).sendRawTransaction({ serializedTransaction: raw });
      onSent(hash);
    } catch (e) {
      collector.current = new PartCollector();
      setError(e instanceof Error ? e.message : "Could not read the signed transaction.");
      processing.current = false;
    } finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Scan with HME Vault, review the payment there, then scan its signed transaction here.</p>
    <VaultAnimatedQr text={payload} />
    <div className="flex items-center gap-2">
      {!busy && <QrScanButton continuous onScan={(frame) => void scan(frame)} />}
      <span className="text-sm text-muted-foreground">{busy ? "Broadcasting…" : progress || "Scan signed transaction"}</span>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="ghost" disabled={busy} onClick={onBack}>Back</Button>
  </div>;
}