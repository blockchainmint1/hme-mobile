/**
 * Manual escape hatch — clears the persisted TXC scan hint and re-walks the
 * full BIP44 gap limit on next open. Normally the fast-frontier refresh keeps
 * things accurate on its own; this is here for recovery if funds are ever
 * received on an address way outside the known window.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/lib/txc/wallet-context";

export function DeepRescanCard() {
  const { root, unlocked } = useWallet();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const rescan = async () => {
    if (!root || !unlocked) return;
    setBusy(true);
    setMsg(null);
    try {
      // Wipe persisted scan hints for this account across all address kinds.
      const prefix = "hme.scan-hint.";
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) localStorage.removeItem(k);
      }
      await qc.invalidateQueries({ queryKey: ["account"] });
      await qc.invalidateQueries({ queryKey: ["txs"] });
      setMsg("Rescan started — balance and history will refresh in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" /> Deep rescan (TXC)
        </CardTitle>
        <CardDescription>
          Normal refreshes only check the addresses you're actively using. Run a
          deep rescan if a balance ever looks wrong or you've restored an older
          backup that used many addresses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={rescan} disabled={busy}>
          {busy ? "Rescanning…" : "Run deep rescan"}
        </Button>
        {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      </CardContent>
    </Card>
  );
}
