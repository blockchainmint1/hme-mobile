/** Pending trade proposals for an "approve every trade" link. Polls while open. */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/txc/wallet-context";
import type { DelegateLinkRecord } from "@/lib/xpub-link/delegate";
import { approveTrade, declineTrade, fetchTrades, inspectTrade, type TradeView } from "@/lib/seeds/trades";

function fmt(s: bigint): string {
  const whole = s / 100_000_000n;
  const frac = (s % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""}`;
}

export function SeedsTradesList({ link }: { link: DelegateLinkRecord }) {
  const { unlocked } = useWallet();
  const [views, setViews] = useState<TradeView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!unlocked?.mnemonic) return;
    const proposals = await fetchTrades(link).catch(() => []);
    const vs = await Promise.all(
      proposals.map((p) => inspectTrade({ link, proposal: p, mnemonic: unlocked.mnemonic!, passphrase: unlocked.passphrase ?? "" })),
    );
    setViews(vs);
  }, [link, unlocked]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (views.length === 0) return <p className="text-xs text-muted-foreground">No trades waiting for approval.</p>;

  async function act(v: TradeView, decision: "approve" | "decline") {
    if (!unlocked?.mnemonic) return;
    setBusy(v.proposal.id);
    setMsg(null);
    try {
      if (decision === "approve") await approveTrade({ link, view: v, mnemonic: unlocked.mnemonic, passphrase: unlocked.passphrase ?? "" });
      else await declineTrade({ link, tradeId: v.proposal.id, mnemonic: unlocked.mnemonic, passphrase: unlocked.passphrase ?? "" });
      setMsg(decision === "approve" ? "Trade approved and sent to Seeds." : "Trade declined.");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">
        {link.appName} wants to trade ({views.length})
      </p>
      {views.map((v) => (
        <div key={v.proposal.id} className="space-y-1 rounded-md border border-primary/40 p-3 text-xs">
          {v.proposal.summary && <p className="font-medium">{v.proposal.summary.slice(0, 200)}</p>}
          {v.token && (
            <p>
              {v.token.youPay > 0n && (
                <>
                  You pay <b>{v.token.divisible ? fmt(v.token.youPay) : v.token.youPay.toString()} {v.token.symbol}</b>
                </>
              )}
              {v.token.youPay > 0n && v.token.youGet > 0n && " · "}
              {v.token.youGet > 0n && (
                <>
                  you get <b>{v.token.divisible ? fmt(v.token.youGet) : v.token.youGet.toString()} {v.token.symbol}</b>
                </>
              )}
            </p>
          )}
          {v.chain && (
            <p>
              You pay <b>{fmt(v.youPay)} {v.chain}</b>
              {v.youGet > 0n && (
                <>
                  {" "}· you get <b>{fmt(v.youGet)} {v.chain}</b>
                </>
              )}
              {v.fee != null && <> · network fee {fmt(v.fee)}</>}
            </p>
          )}
          <ul className="space-y-0.5 text-muted-foreground">
            {v.outputs.map((o, i) => (
              <li key={i} className="flex justify-between gap-2 font-mono">
                <span className="truncate">{o.mine ? "↩ your pocket" : o.address}</span>
                <span>{fmt(o.value)}</span>
              </li>
            ))}
          </ul>
          {v.refused && <p className="text-destructive">{v.refused}</p>}
          <div className="flex gap-2 pt-1">
            <Button size="sm" disabled={!!busy || !!v.refused} onClick={() => act(v, "approve")}>
              {busy === v.proposal.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(v, "decline")}>
              Decline
            </Button>
          </div>
        </div>
      ))}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
