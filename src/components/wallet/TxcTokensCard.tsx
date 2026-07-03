import { useState } from "react";
import { Coins, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  addCustomTxcToken,
  isBuiltinTxcToken,
  removeCustomTxcToken,
  setTxcTokenEnabled,
  useAllTxcTokens,
} from "@/lib/txc/tokens";

export function TxcTokensCard() {
  const { tokens, enabled, isCustom } = useAllTxcTokens();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" /> TXC tokens (Omni)
        </CardTitle>
        <CardDescription>
          Toggle which Omni Layer tokens show under the TXC tile. Add a custom
          property id if a new token isn't listed yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tokens.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No tokens configured yet.
          </p>
        )}
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={`txc-tok-${t.id}`}
                  className="text-sm block truncate"
                >
                  {t.symbol}
                  {isCustom(t) && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Custom
                    </span>
                  )}
                </Label>
                <p className="text-[11px] text-muted-foreground truncate">
                  {t.name ?? "Omni token"} · #{t.id} ·{" "}
                  {t.divisible ? "divisible" : "indivisible"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={`txc-tok-${t.id}`}
                  checked={enabled(t)}
                  onCheckedChange={(v) => setTxcTokenEnabled(t.id, v)}
                />
                {!isBuiltinTxcToken(t.id) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCustomTxcToken(t.id)}
                    aria-label={`Remove ${t.symbol}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <AddCustomTxcTokenDialog />
      </CardContent>
    </Card>
  );
}

function AddCustomTxcTokenDialog() {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [divisible, setDivisible] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setId("");
    setSymbol("");
    setName("");
    setDivisible(true);
    setError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = addCustomTxcToken({
      id: Number(id),
      symbol,
      name: name.trim() || undefined,
      divisible,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    reset();
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full">
          <Plus className="h-4 w-4 mr-1" /> Add custom TXC token
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add TXC token</DialogTitle>
          <DialogDescription>
            Enter the Omni Layer property id and metadata. Divisibility must
            match the on-chain issuance or amounts will render wrong.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="tt-id">Property ID</Label>
            <Input
              id="tt-id"
              type="number"
              min={1}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. 38"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="tt-symbol">Symbol</Label>
            <Input
              id="tt-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. WUSDC"
              className="mt-1"
              autoCapitalize="characters"
            />
          </div>
          <div>
            <Label htmlFor="tt-name">Name (optional)</Label>
            <Input
              id="tt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Wrapped USDC"
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2">
            <div className="text-sm">
              <div className="font-medium">Divisible</div>
              <div className="text-xs text-muted-foreground">
                Off for whole-unit tokens (like POP #37).
              </div>
            </div>
            <Switch checked={divisible} onCheckedChange={setDivisible} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Add token</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
