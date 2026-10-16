/**
 * Home-screen card for the Trading pocket (Seeds). Shows its own balances and
 * receive addresses, links to move coins in, pending trade approvals, and the
 * Revoke button. Renders nothing until a trading link exists.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, Check, Copy, Loader2 } from "lucide-react";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/lib/txc/wallet-context";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import {
  DELEGATE_LINKS_EVENT,
  listDelegateLinks,
  removeDelegateLink,
  revokeDelegate,
  type DelegateLinkRecord,
} from "@/lib/xpub-link/delegate";
import {
  evmPocketBalances,
  pocketReceiveAddress,
  retirePocketAccount,
  sweepPocket,
  utxoPocketBalance,
  type PocketChain,
  type SweepResult,
} from "@/lib/seeds/pocket";
import { SeedsTradesList } from "@/components/wallet/SeedsTradesList";

const SEND_ROUTE: Record<string, string> = {
  TXC: "/wallet/send",
  ISK: "/wallet/isk/send",
  BTC: "/wallet/btc/send",
  LTC: "/wallet/ltc/send",
};

function fmtSats(s: bigint): string {
  const neg = s < 0n;
  const v = neg ? -s : s;
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

interface Row {
  chain: PocketChain;
  address: string;
  balance: string | null;
}

function PocketRows({ link }: { link: DelegateLinkRecord }) {
  const { unlocked } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!unlocked?.mnemonic) return;
    let live = true;
    (async () => {
      const seed = await seedFromMnemonic(unlocked.mnemonic!, unlocked.passphrase ?? "");
      const base = link.chains.map((c) => ({ chain: c, address: pocketReceiveAddress(seed, c, link.account), balance: null }));
      if (live) setRows(base);
      const filled = await Promise.all(
        base.map(async (r): Promise<Row> => {
          try {
            if (r.chain === "EVM") {
              const b = await evmPocketBalances(seed, link.account);
              const parts = Object.entries(b)
                .filter(([, v]) => v && v > 0n)
                .map(([k, v]) => `${formatEther(v!).slice(0, 10)} ${k.toUpperCase()}`);
              return { ...r, balance: parts.length ? parts.join(" · ") : "0" };
            }
            return { ...r, balance: `${fmtSats(await utxoPocketBalance(seed, r.chain, link.account))} ${r.chain}` };
          } catch {
            return { ...r, balance: "—" };
          }
        }),
      );
      seed.fill(0);
      if (live) setRows(filled);
    })();
    return () => {
      live = false;
    };
  }, [unlocked, link]);

  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((r) => (
        <li key={r.chain} className="flex items-center gap-2 py-2">
          <span className="w-12 font-medium">{r.chain}</span>
          <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{r.address}</span>
          <span className="text-xs tabular-nums">{r.balance ?? <Loader2 className="h-3 w-3 animate-spin" />}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={`Copy ${r.chain} trading address`}
            onClick={() => {
              void navigator.clipboard?.writeText(r.address);
              setCopied(r.chain);
              setTimeout(() => setCopied(null), 1500);
            }}
          >
            {copied === r.chain ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
          {r.chain === "EVM" ? (
            <Button asChild size="icon" variant="ghost" className="h-7 w-7" aria-label="Move ETH to Trading">
              <Link to="/wallet/evm/$chain/send" params={{ chain: "eth" }} search={{ to: r.address }}>
                <ArrowDownToLine className="h-3 w-3" />
              </Link>
            </Button>
          ) : (
            <Button asChild size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move ${r.chain} to Trading`}>
              <Link to={SEND_ROUTE[r.chain] as "/wallet/send"} search={{ to: r.address }}>
                <ArrowDownToLine className="h-3 w-3" />
              </Link>
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function TradingPocketCard() {
  const allowed = useExchangeFeaturesAllowed();
  const { unlocked } = useWallet();
  const [links, setLinks] = useState<DelegateLinkRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setLinks(listDelegateLinks());
    h();
    window.addEventListener(DELEGATE_LINKS_EVENT, h);
    return () => window.removeEventListener(DELEGATE_LINKS_EVENT, h);
  }, [unlocked]);

  if (!allowed || links.length === 0 || !unlocked?.mnemonic) return null;

  async function moveBack(link: DelegateLinkRecord): Promise<SweepResult[]> {
    const seed = await seedFromMnemonic(unlocked!.mnemonic!, unlocked!.passphrase ?? "");
    try {
      return await sweepPocket(seed, link.account, link.chains);
    } finally {
      seed.fill(0);
    }
  }

  function describe(rs: SweepResult[]): string {
    const sent = rs.filter((r) => r.txid).map((r) => r.chain);
    const skipped = rs.filter((r) => r.skipped && r.skipped !== "empty").map((r) => `${r.chain} (${r.skipped})`);
    return [
      sent.length ? `Moved back to your main wallet: ${sent.join(", ")}.` : "Nothing needed moving.",
      skipped.length ? `Not moved: ${skipped.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  async function revoke(link: DelegateLinkRecord) {
    if (!confirm(`Revoke ${link.appName}'s access? Coins in this shared wallet will be moved back to your main wallet.`)) return;
    setBusy(link.linkId);
    setResult(null);
    let serverNote = "";
    try {
      await revokeDelegate({ record: link, mnemonic: unlocked!.mnemonic!, passphrase: unlocked!.passphrase ?? "" });
    } catch (e) {
      serverNote = ` ${link.appName} couldn't be reached (${(e as Error).message}), so revoke there too.`;
    }
    let sweepNote = "";
    if (link.mode === "access") {
      sweepNote = describe(await moveBack(link).catch(() => []));
      // An old spending key must never control new deposits.
      if (!listDelegateLinks().some((l) => l.linkId !== link.linkId && l.mode === "access" && l.account === link.account))
        retirePocketAccount();
    }
    removeDelegateLink(link.linkId);
    setResult(`Revoked ${link.appName}. ${sweepNote}${serverNote} Tokens (TSD, USDC) stay put — send them from the shared wallet address manually if needed.`.trim());
    setBusy(null);
  }

  return (
    <Card className="mx-4 my-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Shared with trading sites</CardTitle>
        <CardDescription className="text-xs">
          Separate from your main wallet. The site can only trade what you move here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {links.map((link) => (
          <div key={link.linkId} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-medium">{link.appName}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  · {link.mode === "access" ? "has access (instant trades)" : "you approve each trade"} · branch {link.account}
                </span>
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(link.linkId + ":move");
                    setResult(describe(await moveBack(link).catch(() => [])));
                    setBusy(null);
                  }}
                >
                  {busy === link.linkId + ":move" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Move back
                </Button>
                <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => revoke(link)}>
                  {busy === link.linkId && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Revoke
                </Button>
              </div>
            </div>
            <PocketRows link={link} />
            {link.mode === "approve" && <SeedsTradesList link={link} />}
          </div>
        ))}
        {result && <p className="text-xs text-muted-foreground">{result}</p>}
      </CardContent>
    </Card>
  );
}
