/**
 * Send / Receive buttons for a Vault-paired profile on the normal wallet
 * home screen. Everything up to signing is the same experience; Send opens
 * the QR signing flow (VaultSendDialog) instead of signing on this device.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, QrCode as QrIcon, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QrCode } from "@/components/wallet/QrCode";
import { VaultSendDialog } from "@/components/wallet/VaultSendDialog";
import type { VaultPairing, VaultUtxoChain } from "@/lib/vault-link/pairing";
import type { VaultChainScan } from "@/lib/vault-link/scan";
import { scanVaultChainAll } from "@/lib/vault-link/snapshot";
import { VAULT_CHAIN_META } from "@/lib/vault-link/derive";

const UTXO: VaultUtxoChain[] = ["txc", "isk", "btc", "ltc", "doge"];

export function VaultBottomActions({
  pairing,
  chain,
  receiveAddress,
}: {
  pairing: VaultPairing;
  chain: string;
  receiveAddress: string | null;
}) {
  const qc = useQueryClient();
  const isUtxo = (UTXO as string[]).includes(chain);
  const sendChain: VaultUtxoChain | "evm" = isUtxo ? (chain as VaultUtxoChain) : "evm";
  const title = isUtxo ? `${VAULT_CHAIN_META[chain as VaultUtxoChain].name}` : "Ethereum networks";
  const [showReceive, setShowReceive] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [scans, setScans] = useState<VaultChainScan[] | null>(null);

  async function openSend() {
    if (!isUtxo) {
      setScans([]);
      return;
    }
    setPreparing(true);
    try {
      setScans(await scanVaultChainAll(pairing, chain as VaultUtxoChain));
    } catch (e) {
      toast.error((e as Error).message || "Couldn't load your coins — try again.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Button size="lg" variant="outline" className="flex-1" disabled={!receiveAddress} onClick={() => setShowReceive(true)}>
        <QrIcon className="h-4 w-4 mr-2" /> Receive
      </Button>
      <Button size="lg" className="flex-1" disabled={preparing} onClick={() => void openSend()}>
        {preparing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Send
      </Button>

      {showReceive && receiveAddress && (
        <Dialog open onOpenChange={(o) => !o && setShowReceive(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Receive {title}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              <QrCode value={receiveAddress} copyValue={receiveAddress} />
              <p className="font-mono text-xs break-all text-center">{receiveAddress}</p>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {scans && (
        <VaultSendDialog
          pairing={pairing}
          chain={sendChain}
          scans={scans}
          onClose={() => {
            setScans(null);
            void qc.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
