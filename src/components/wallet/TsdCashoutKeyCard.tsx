/**
 * Settings card for the TSD Swap API key.
 *
 * Pasting a key from tsd.honest.money turns on "Cash out to USDC" on the TSD
 * send screen; removing it turns the feature back off. The key also carries
 * the account's fee tier, so there are no coupon codes in the wallet.
 *
 * Exchange/off-ramp feature — hidden on iOS via `useExchangeFeaturesAllowed()`.
 */
import { useState } from "react";
import { ArrowDownUp, Check, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import { TSD_API_KEY_RE, maskKey, useCashoutApiKey } from "@/lib/cashout/api-key";

export function TsdCashoutKeyCard() {
  const allowed = useExchangeFeaturesAllowed();
  const [key, setKey] = useCashoutApiKey();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!allowed) return null;

  function save() {
    const v = input.trim();
    if (!TSD_API_KEY_RE.test(v)) {
      setError("That doesn't look like a TSD Swap API key. Copy it again from your account page.");
      return;
    }
    setError(null);
    setKey(v);
    setInput("");
  }

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowDownUp className="h-5 w-5" /> TSD cash-out
        </CardTitle>
        <CardDescription>
          Turn TSD into USDC on Ethereum from the send screen. Create an account at
          tsd.honest.money, mint an API key on your account page, and paste it here. Your account
          decides the redemption fee — no codes needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {key ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm text-primary">
              <Check className="h-4 w-4" /> Connected
            </span>
            <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
              {maskKey(key)}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setKey(null)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="tsd_live_…"
                className="flex-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="button" onClick={save} disabled={!input.trim()}>
                Save
              </Button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              Stored only on this device. It can create redemption orders that pay out to an address
              you type here — it can't move funds on its own.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
