import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CHAIN_META,
  CHAIN_ORDER,
  getChainPrefs,
  setChainEnabled,
  type ChainId,
} from "@/lib/chain-prefs";

export function ChainsCard({ compact }: { compact?: boolean }) {
  const [prefs, setPrefs] = useState<Record<ChainId, boolean>>(() => getChainPrefs());

  useEffect(() => {
    const h = () => setPrefs(getChainPrefs());
    window.addEventListener("hme:chains-changed", h);
    return () => window.removeEventListener("hme:chains-changed", h);
  }, []);

  const body = (
    <>
      {CHAIN_ORDER.map((id) => {
          const meta = CHAIN_META[id];
          const isTxc = id === "txc";
          return (
            <div key={id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor={`chain-${id}`} className="text-sm block">
                  {meta.name}{" "}
                  <span className="text-xs text-muted-foreground">({meta.shortName})</span>
                </Label>
                {isTxc && (
                  <p className="text-xs text-muted-foreground">Always on — primary chain.</p>
                )}
                {meta.soon && (
                  <p className="text-xs text-muted-foreground">Coming soon</p>
                )}
              </div>
              <Switch
                id={`chain-${id}`}
                checked={prefs[id]}
                disabled={isTxc || meta.soon}
                onCheckedChange={(v) => setChainEnabled(id, v)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
