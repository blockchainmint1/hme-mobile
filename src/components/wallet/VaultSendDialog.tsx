/**
 * Vault send flow: build an unsigned transaction, show it to the HME Vault
 * device as a (possibly animated) QR, scan the signed transaction back,
 * verify it matches what was requested, then broadcast.
 *
 * Nothing is ever signed here — this dialog only prepares and broadcasts.
 */
import { useMemo, useRef, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { VaultAnimatedQr } from "@/components/wallet/VaultAnimatedQr";
import { TxidCard } from "@/components/wallet/TxidCard";
import { PartCollector } from "@/lib/vault-link/qr-parts";
import { buildVaultPsbt, verifySignedTx } from "@/lib/vault-link/psbt-build";
import { buildNativeIntent } from "@/lib/vault-link/evm-intent";
import { chainIo, type VaultChainScan } from "@/lib/vault-link/scan";
import { VAULT_CHAIN_META } from "@/lib/vault-link/derive";
import type { VaultPairing, VaultUtxoChain } from "@/lib/vault-link/pairing";
import { EVM_CHAINS, evmClient, type EvmChainId } from "@/lib/chains/evm";
import { getFeeEstimates as txcFees } from "@/lib/txc/mempool";
import { getFeeEstimates as iskFees } from "@/lib/isk/mempool";
import { getFeeEstimates as btcFees } from "@/lib/btc/mempool";
import { getFeeEstimates as ltcFees } from "@/lib/ltc/mempool";
import { getFeeEstimates as dogeFees } from "@/lib/doge/mempool";

const FEE_FN: Record<VaultUtxoChain, () => Promise<{ halfHourFee: number }>> = {
  txc: txcFees,
  isk: iskFees,
  btc: btcFees,
  ltc: ltcFees,
  doge: dogeFees,
};

const SATS = 100_000_000;

type Step =
  | { name: "form" }
  | { name: "show"; payload: string; expected: { address: string; valueSats: number }[] }
  | { name: "done"; txid: string };

export function VaultSendDialog({
  pairing,
  chain,
  scans,
  onClose,
}: {
  pairing: VaultPairing;
  /** UTXO chain id, or "evm" for the paired Ethereum-style account. */
  chain: VaultUtxoChain | "evm";
  scans: VaultChainScan[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ name: "form" });
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evmChain, setEvmChain] = useState<EvmChainId>("eth");
  const collector = useRef(new PartCollector());

  const isEvm = chain === "evm";
  const meta = !isEvm ? VAULT_CHAIN_META[chain] : null;
  const chainScans = useMemo(() => scans.filter((s) => s.chain === chain), [scans, chain]);
  const [purpose, setPurpose] = useState<44 | 49 | 84 | null>(null);
  const activePurpose: 44 | 49 | 84 | null = purpose ?? chainScans[0]?.purpose ?? null;
  const activeScan = chainScans.find((s) => s.purpose === activePurpose) ?? chainScans[0];

  async function buildUtxo() {
    if (!meta || !activeScan) return;
    const sats = Math.round(Number(amount) * SATS);
    if (!Number.isFinite(sats) || sats <= 0) throw new Error("Enter an amount.");
    if (!to.trim()) throw new Error("Enter the recipient address.");

    const fees = await FEE_FN[chain as VaultUtxoChain]();
    const feeRate = Math.max(1, Math.ceil(fees.halfHourFee));

    // Greedy largest-first coin selection within the chosen address type.
    const sorted = [...activeScan.utxos].sort((a, b) => b.value - a.value);
    const inVsize = activePurpose === 84 ? 68 : activePurpose === 49 ? 91 : 148;
    const picked: typeof sorted = [];
    let total = 0;
    let feeSats = 0;
    for (const u of sorted) {
      picked.push(u);
      total += u.value;
      const vsize = 10 + picked.length * inVsize + 2 * 34;
      feeSats = vsize * feeRate;
      if (total >= sats + feeSats) break;
    }
    if (total < sats + feeSats) throw new Error("Not enough confirmed funds for this payment plus the network fee.");

    // Legacy inputs need the full previous transaction.
    const prevTxHex: Record<string, string> = {};
    if (activePurpose === 44) {
      const io = chainIo(chain as VaultUtxoChain);
      for (const u of picked) {
        prevTxHex[`${u.txid}:${u.vout}`] = await io.txHex(u.txid);
      }
    }

    const built = buildVaultPsbt({
      pairing,
      chain: chain as VaultUtxoChain,
      inputs: picked,
      prevTxHex,
      outputs: [{ address: to.trim(), valueSats: sats }],
      feeSats,
      changePurpose: activePurpose ?? 44,
      changeIndex: activeScan.utxos.filter((u) => u.change === 1).length,
    });
    setStep({ name: "show", payload: built.psbtBase64, expected: [{ address: to.trim(), valueSats: sats }] });
  }

  async function buildEvm() {
    const evm = pairing.evm;
    if (!evm) throw new Error("This Vault pairing has no Ethereum key.");
    const chainMeta = EVM_CHAINS[evmChain];
    const pub = evmClient(evmChain);
    const valueWei = BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n;
    if (valueWei <= 0n) throw new Error("Enter an amount.");
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) throw new Error("Enter a valid 0x recipient address.");
    const [nonce, fees] = await Promise.all([
      pub.getTransactionCount({ address: evm.address as `0x${string}`, blockTag: "pending" }),
      pub.estimateFeesPerGas().catch(() => null),
    ]);
    const gas = 21_000n;
    const feeFields = fees?.maxFeePerGas
      ? { type: "eip1559" as const, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 1_000_000_000n }
      : { type: "legacy" as const, gasPrice: await pub.getGasPrice() };
    const json = buildNativeIntent({
      pairing,
      chainId: chainMeta.viemChain.id,
      to: to.trim(),
      valueWei,
      nonce,
      gas,
      fees: feeFields,
    });
    setStep({ name: "show", payload: json, expected: [] });
  }

  async function build() {
    setBusy(true);
    setError(null);
    try {
      if (isEvm) await buildEvm();
      else await buildUtxo();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onScanned(code: string) {
    try {
      const full = collector.current.add(code);
      if (!full) return; // waiting for more frames
      collector.current = new PartCollector();
      if (step.name !== "show") return;
      setBusy(true);
      setError(null);
      try {
        if (isEvm) {
          const hex = full.trim();
          if (!/^0x[0-9a-fA-F]+$/.test(hex)) throw new Error("That QR code didn't contain a signed transaction.");
          const pub = evmClient(evmChain);
          const hash = await pub.sendRawTransaction({ serializedTransaction: hex as `0x${string}` });
          setStep({ name: "done", txid: hash });
        } else {
          const { txid } = verifySignedTx(full, chain as VaultUtxoChain, step.expected);
          const io = chainIo(chain as VaultUtxoChain);
          const realTxid = await io.broadcast(full.trim());
          setStep({ name: "done", txid: realTxid || txid });
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    } catch (e) {
      collector.current = new PartCollector();
      setError((e as Error).message);
    }
  }

  const unit = isEvm ? EVM_CHAINS[evmChain].nativeSymbol : meta?.unit ?? "";
  const vaultNetworkName = isEvm ? "EVM" : (chain as string).toUpperCase();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send {isEvm ? "EVM" : meta?.name} via Vault</DialogTitle>
          <DialogDescription>
            The transaction is prepared here and signed on your Vault device by QR.
          </DialogDescription>
        </DialogHeader>

        {step.name === "form" && (
          <div className="space-y-3">
            {isEvm && (
              <div className="space-y-1">
                <Label>Network</Label>
                <Select value={evmChain} onValueChange={(v) => setEvmChain(v as EvmChainId)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(EVM_CHAINS).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isEvm && chainScans.length > 1 && (
              <div className="space-y-1">
                <Label>Address type</Label>
                <Select value={String(activePurpose)} onValueChange={(v) => setPurpose(Number(v) as 44 | 49 | 84)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {chainScans.map((s) => (
                      <SelectItem key={s.purpose} value={String(s.purpose)}>
                        {s.purpose === 84 ? "Native segwit" : s.purpose === 49 ? "Wrapped segwit" : "Legacy"} ·{" "}
                        {(s.balanceSats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })} {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isEvm && activeScan && (
              <p className="text-xs text-muted-foreground">
                Available: {(activeScan.balanceSats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })} {unit}
              </p>
            )}
            <div className="space-y-1">
              <Label>To</Label>
              <div className="flex gap-2">
                <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={isEvm ? "0x…" : "Address"} className="font-mono text-xs" />
                <QrScanButton onScan={(t) => setTo(t.replace(/^[a-z]+:/i, "").split("?")[0])} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Amount ({unit})</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button onClick={build} disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Prepare for Vault signing"}
            </Button>
          </div>
        )}

        {step.name === "show" && (
          <div className="space-y-3">
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>On your Vault device, choose <span className="font-medium text-foreground">{vaultNetworkName}</span> and tap Scan.</li>
              <li>Point it at this code and review the payment on the Vault screen.</li>
              <li>After signing, scan the Vault's signed-transaction QR below.</li>
            </ol>
            <VaultAnimatedQr text={step.payload} />
            <div className="flex items-center gap-2">
              <QrScanButton onScan={(t) => void onScanned(t)} />
              <span className="text-xs text-muted-foreground">
                {busy ? "Broadcasting…" : "Scan the signed transaction from Vault"}
              </span>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button variant="ghost" size="sm" onClick={() => setStep({ name: "form" })}>
              Back
            </Button>
          </div>
        )}

        {step.name === "done" && (
          <div className="space-y-3">
            <p className="text-sm">Broadcast to the network.</p>
            <TxidCard txid={step.txid} />
            <Button className="w-full" onClick={() => { toast.success("Sent"); onClose(); }}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
