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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import {
  addCustomToken,
  removeCustomToken,
  setTokenEnabled,
  useAllTokensForChain,
} from "@/lib/token-prefs";
import type { Address } from "viem";

const CHAINS: EvmChainId[] = ["eth", "base", "bsc"];

export function TokensCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" /> Tokens
        </CardTitle>
        <CardDescription>
          Choose which L2 tokens to show on each EVM chain. Hidden tokens are
          still resolvable if you scan a payment link for them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {CHAINS.map((c) => (
          <ChainTokens key={c} chain={c} />
        ))}
        <AddCustomTokenDialog />
      </CardContent>
    </Card>
  );
}

function ChainTokens({ chain }: { chain: EvmChainId }) {
  const meta = EVM_CHAINS[chain];
  const { tokens, enabled, isCustom } = useAllTokensForChain(chain);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: meta.accent }}
        />
        <p className="text-sm font-medium">{meta.name}</p>
      </div>
      {tokens.length === 0 && (
        <p className="text-xs text-muted-foreground">No tokens configured.</p>
      )}
      <div className="space-y-2">
        {tokens.map((t) => (
          <div
            key={t.address}
            className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2"
          >
            <div className="min-w-0">
              <Label
                htmlFor={`tok-${chain}-${t.address}`}
                className="text-sm block truncate"
              >
                {t.symbol}
                {isCustom(t) && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Custom
                  </span>
                )}
              </Label>
              <p className="text-[11px] text-muted-foreground truncate font-mono">
                {t.address}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`tok-${chain}-${t.address}`}
                checked={enabled(t)}
                onCheckedChange={(v) => setTokenEnabled(chain, t.address, v)}
              />
              {isCustom(t) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCustomToken(chain, t.address)}
                  aria-label={`Remove ${t.symbol}`}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddCustomTokenDialog() {
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<EvmChainId>("eth");
  const [symbol, setSymbol] = useState("");
  const [address, setAddress] = useState("");
  const [decimals, setDecimals] = useState("18");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSymbol("");
    setAddress("");
    setDecimals("18");
    setError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = addCustomToken(chain, {
      symbol,
      address: address.trim() as Address,
      decimals: Number(decimals),
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
          <Plus className="h-4 w-4 mr-1" /> Add custom token
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add custom token</DialogTitle>
          <DialogDescription>
            Paste the contract address for an ERC-20 token. Symbol and decimals
            must match the token on-chain.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="ct-chain">Chain</Label>
            <Select value={chain} onValueChange={(v) => setChain(v as EvmChainId)}>
              <SelectTrigger id="ct-chain" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAINS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {EVM_CHAINS[c].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ct-symbol">Symbol</Label>
            <Input
              id="ct-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. DAI"
              className="mt-1"
              autoCapitalize="characters"
            />
          </div>
          <div>
            <Label htmlFor="ct-address">Contract address</Label>
            <Input
              id="ct-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="ct-decimals">Decimals</Label>
            <Input
              id="ct-decimals"
              type="number"
              min={0}
              max={36}
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
              className="mt-1"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add token</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
