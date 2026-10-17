/**
 * Home screen for Vault-paired profiles. Completely separate from the
 * seed-wallet UI: balances are scanned from the paired account xpubs, and
 * Send opens the QR signing flow (VaultSendDialog) instead of signing locally.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, QrCode as QrIcon, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QrCode } from "@/components/wallet/QrCode";
import { VaultSendDialog } from "@/components/wallet/VaultSendDialog";
import { useWallet } from "@/lib/txc/wallet-context";
import { loadPairing, type VaultPairing, type VaultUtxoChain } from "@/lib/vault-link/pairing";
import { scanVaultWallet, type VaultChainScan } from "@/lib/vault-link/scan";
import { VAULT_CHAIN_META } from "@/lib/vault-link/derive";
import { EVM_CHAINS, EVM_CHAIN_LIST, evmClient, formatEth } from "@/lib/chains/evm";

const SATS = 100_000_000;

export function VaultHome() {
  const { activeProfileId, unlocked } = useWallet();
  const [pairing, setPairing] = useState<VaultPairing | null>(null);
  const [scans, setScans] = useState<VaultChainScan[]>([]);
  const [evmBalances, setEvmBalances] = useState<Record<string, bigint>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receive, setReceive] = useState<{ title: string; address: string } | null>(null);
  const [sendChain, setSendChain] = useState<VaultUtxoChain | "evm" | null>(null);

  useEffect(() => {
    setPairing(loadPairing(activeProfileId));
  }, [activeProfileId]);

  async function refresh(p: VaultPairing) {
    setLoading(true);
    setError(null);
    try {
      const result = await scanVaultWallet(p);
      setScans(result);
      if (p.evm) {
        const addr = p.evm.address as `0x${string}`;
        const entries = await Promise.all(
          EVM_CHAIN_LIST.map(async (c) => {
            try {
              const bal = await evmClient(c.id).getBalance({ address: addr });
              return [c.id, bal] as const;
            } catch {
              return [c.id, 0n] as const;
            }
          }),
        );
        setEvmBalances(Object.fromEntries(entries));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (pairing) void refresh(pairing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  if (!pairing) {
    return (
      <div className="mx-auto max-w-md p-4">
        <Card>
          <CardHeader>
            <CardTitle>Vault wallet</CardTitle>
            <CardDescription>
              This profile isn't paired with a Vault device yet (or the pairing data was cleared).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/vault-add">Pair with HME Vault</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const grouped = new Map<VaultUtxoChain, VaultChainScan[]>();
  for (const s of scans) {
    grouped.set(s.chain, [...(grouped.get(s.chain) ?? []), s]);
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span>
            {unlocked?.label ?? "Vault"} · signs by QR · fp <span className="font-mono">{pairing.fp}</span>
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void refresh(pairing)} disabled={loading} title="Refresh balances">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {[...grouped.entries()].map(([chain, list]) => {
        const meta = VAULT_CHAIN_META[chain];
        const total = list.reduce((s, x) => s + x.balanceSats, 0);
        const primary = list.find((s) => s.balanceSats > 0) ?? list[0];
        return (
          <Card key={chain}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{meta.name}</span>
                <span className="font-mono text-sm">
                  {(total / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })} {meta.unit}
                </span>
              </CardTitle>
              <CardDescription>
                {list.map((s) => `${s.purpose === 84 ? "segwit" : s.purpose === 49 ? "wrapped" : "legacy"} ${(s.balanceSats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })}`).join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReceive({ title: `${meta.name} (${meta.unit})`, address: primary.nextReceive })}
              >
                <QrIcon className="h-4 w-4 mr-1" /> Receive
              </Button>
              <Button size="sm" onClick={() => setSendChain(chain)} disabled={total <= 0}>
                <Send className="h-4 w-4 mr-1" /> Send
              </Button>
            </CardContent>
          </Card>
        );
      })}

      {pairing.evm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ethereum networks</CardTitle>
            <CardDescription className="font-mono break-all text-xs">{pairing.evm.address}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {EVM_CHAIN_LIST.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>{c.name}</span>
                <span className="font-mono">
                  {formatEth(evmBalances[c.id] ?? 0n)} {c.nativeSymbol}
                </span>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setReceive({ title: "Ethereum networks", address: pairing.evm!.address })}>
                <QrIcon className="h-4 w-4 mr-1" /> Receive
              </Button>
              <Button size="sm" onClick={() => setSendChain("evm")}>
                <Send className="h-4 w-4 mr-1" /> Send
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        This wallet holds no keys. Payments are prepared here, signed on your Vault device, then
        broadcast from here.
      </p>

      {receive && (
        <Dialog open onOpenChange={(o) => !o && setReceive(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Receive {receive.title}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              <QrCode value={receive.address} />
              <p className="font-mono text-xs break-all text-center">{receive.address}</p>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {sendChain && (
        <VaultSendDialog pairing={pairing} chain={sendChain} scans={scans} onClose={() => { setSendChain(null); void refresh(pairing); }} />
      )}
    </div>
  );
}
