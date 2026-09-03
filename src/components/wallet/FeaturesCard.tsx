import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFeature } from "@/lib/feature-prefs";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";

export function FeaturesCard({ compact }: { compact?: boolean }) {
  const [evmSwap, setEvmSwap] = useFeature("evmSwap");
  const [utxoSwap, setUtxoSwap] = useFeature("utxoSwap");
  const [confirmLast4, setConfirmLast4] = useFeature("confirmLast4");
  const [hideSpam, setHideSpam] = useFeature("hideSpamTokens");
  const exchangeAllowed = useExchangeFeaturesAllowed();
  return (
    <Card>
      {!compact && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Extra features
          </CardTitle>
          <CardDescription>
            Opt-in features and safety checks. Toggle to fit how you use the wallet.
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="feat-confirm-last4" className="text-sm font-medium">
              Confirm last 4 of address
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Before sending on Ethereum, Base, or BSC, re-type the last 4 characters
              of the recipient address. Helps catch clipboard-swap malware. On by default.
            </p>
          </div>
          <Switch
            id="feat-confirm-last4"
            checked={confirmLast4}
            onCheckedChange={setConfirmLast4}
          />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="feat-hide-spam" className="text-sm font-medium">
              Hide worthless / spam tokens
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Filters imposter tokens from the Ethereum, Base, and BSC activity list —
              airdropped coins that mimic USDC/USDT, phishing symbols with URLs, and
              unknown contracts you never sent to. On by default.
            </p>
          </div>
          <Switch
            id="feat-hide-spam"
            checked={hideSpam}
            onCheckedChange={setHideSpam}
          />
        </div>
        {exchangeAllowed && (
          <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="feat-evm-swap" className="text-sm font-medium">
              In-app Swap
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adds a Swap button on Ethereum, Base, and BSC tiles. Quotes and routing
              are powered by LI.FI; transactions are signed on this device and
              broadcast through HME Wallet — no external wallet connect required.
            </p>
          </div>
          <Switch
            id="feat-evm-swap"
            checked={evmSwap}
            onCheckedChange={setEvmSwap}
          />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="feat-utxo-swap" className="text-sm font-medium">
              Swap LTC / DOGE to stablecoins
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adds a Swap button on the Litecoin and Dogecoin tiles. Swaps run natively
              over THORChain — your coins are signed on this device and the stablecoin is
              paid out to this wallet's EVM address. No bridge, no custodian.
            </p>
          </div>
          <Switch
            id="feat-utxo-swap"
            checked={utxoSwap}
            onCheckedChange={setUtxoSwap}
          />
        </div>
          </>
        )}

      </CardContent>
    </Card>
  );
}
