import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFeature } from "@/lib/feature-prefs";

export function FeaturesCard() {
  const [evmSwap, setEvmSwap] = useFeature("evmSwap");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Extra features
        </CardTitle>
        <CardDescription>
          Opt-in features that add extra buttons to the wallet. Off by default to keep the
          main screen simple.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="feat-evm-swap" className="text-sm font-medium">
              EVM Swap (via Uniswap)
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adds a Swap button next to Send / Receive on Ethereum, Base, and BSC tiles.
              Opens the Uniswap app in your browser — HME Wallet never holds your swap.
            </p>
          </div>
          <Switch
            id="feat-evm-swap"
            checked={evmSwap}
            onCheckedChange={setEvmSwap}
          />
        </div>
      </CardContent>
    </Card>
  );
}
