/**
 * Settings → Tap card. Link an NFC card to a card pocket (branch 1107'), set
 * PIN / limits / Telegram approvers, fund it with TSD, see taps, kill it.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/lib/txc/wallet-context";
import { useExchangeFeaturesAllowed } from "@/lib/native/capabilities";
import { linkCard, listCards, updateCard, killCard } from "@/lib/card/card.functions";
import { bumpPocketIndex, cardPocket, nextPocketIndex, returnAddress, signEnvelope } from "@/lib/card/client";
import { TSD_PROPERTY_ID } from "@/lib/cashout/tsd";

type PinRule = "always" | "above" | "never";
type Cards = Awaited<ReturnType<typeof listCards>>;

function fmtTsd(units: string): string {
  const v = BigInt(units);
  return `${v / 100_000_000n}.${(v % 100_000_000n).toString().padStart(8, "0").slice(0, 2)}`;
}

function Rules({
  value,
  onChange,
  pinRequiredIfSet,
}: {
  value: { pinRule: PinRule; pin: string; pinAboveUsd: string; perTapUsd: string; dailyUsd: string };
  onChange: (v: typeof value) => void;
  pinRequiredIfSet?: boolean;
}) {
  const set = (k: keyof typeof value) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <Label htmlFor="card-per-tap" className="text-sm">Instant limit per tap ($)</Label>
        <Input id="card-per-tap" className="h-11 min-w-0 text-base md:text-base" inputMode="decimal" value={value.perTapUsd} onChange={set("perTapUsd")} />
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor="card-daily" className="text-sm">Daily cap ($)</Label>
        <Input id="card-daily" className="h-11 min-w-0 text-base md:text-base" inputMode="decimal" value={value.dailyUsd} onChange={set("dailyUsd")} />
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor="card-pin-rule" className="text-sm">Ask for PIN</Label>
        <select id="card-pin-rule" className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base" value="always" disabled>
          <option value="always">Every tap</option>
        </select>
      </div>
      {false ? (
        <div className="min-w-0 space-y-2">
          <Label htmlFor="card-pin-above" className="text-sm">PIN above ($)</Label>
          <Input id="card-pin-above" className="h-11 min-w-0 text-base md:text-base" inputMode="decimal" value={value.pinAboveUsd} onChange={set("pinAboveUsd")} />
        </div>
      ) : (
        <div className="hidden sm:block" />
      )}
      {(
        <div className="min-w-0 space-y-2 sm:col-span-2">
          <Label htmlFor="card-pin" className="text-sm">{pinRequiredIfSet ? "New PIN (leave blank to keep)" : "PIN (4–8 digits)"}</Label>
          <Input id="card-pin" className="h-11 min-w-0 text-base md:text-base" type="password" inputMode="numeric" maxLength={8} value={value.pin} onChange={set("pin")} />
        </div>
      )}
    </div>
  );
}

const DEFAULT_RULES = { pinRule: "always" as PinRule, pin: "", pinAboveUsd: "0", perTapUsd: "100", dailyUsd: "500" };

export function TapCardCard() {
  const allowed = useExchangeFeaturesAllowed();
  const { seed } = useWallet();
  const list = useServerFn(listCards);
  const link = useServerFn(linkCard);
  const update = useServerFn(updateCard);
  const kill = useServerFn(killCard);
  const [data, setData] = useState<Cards | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [uid, setUid] = useState("");
  const [label, setLabel] = useState("My card");
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!seed) return;
    try {
      setData(await list({ data: signEnvelope(seed, "list", {}) }));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, [seed, list]);

  useEffect(() => {
    if (allowed) void refresh();
  }, [allowed, refresh]);

  if (!allowed) return <p className="text-sm text-muted-foreground">Tap card isn't available on this device yet.</p>;
  if (!seed) return <p className="text-sm text-muted-foreground">Unlock your wallet to manage tap cards.</p>;

  const num = (s: string) => Math.max(0, Number(s) || 0);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setMsg(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const copy = (t: string) => {
    void navigator.clipboard?.writeText(t);
    setCopied(t);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="min-w-0 space-y-5 text-sm">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Tap your card at a NectarPay checkout. It pays in TSD from its own pocket, which is separate from your main wallet. Payments under your limit go through instantly. Bigger ones wait for your OK on Telegram.
      </p>

      {data?.cards.map((c) => (
        <div key={c.id} className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <p className="min-w-0 break-words font-medium">
              {c.label} {c.status === "locked" && <span className="text-xs text-destructive">· locked (wrong PINs)</span>}
            </p>
            <span className="shrink-0 text-xs tabular-nums">{fmtTsd(c.tsd)} TSD</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{c.pocketAddress}</span>
            <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" aria-label="Copy card pocket address" onClick={() => copy(c.pocketAddress)}>
              {copied === c.pocketAddress ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/wallet/send" search={{ to: c.pocketAddress, token: String(TSD_PROPERTY_ID) }}>Add TSD</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/wallet/send" search={{ to: c.pocketAddress, amount: "0.5" }}>Add TXC for fees</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Instant up to ${c.perTapUsd} a tap, ${c.dailyUsd} a day. PIN: {c.pinRule === "always" ? "every tap" : c.pinRule === "above" ? `above $${c.pinAboveUsd}` : "never"}.
          </p>
          <div className="rounded-md bg-muted/40 p-2 text-xs">
            {c.approvers > 0 ? `${c.approvers} Telegram approver${c.approvers > 1 ? "s" : ""} linked. ` : "No Telegram approver yet. Over-limit taps will be declined. "}
            {c.telegramCode ? (
              <>
                To add one, open{" "}
                <a className="underline" href={`https://t.me/${data.bot}?start=${c.telegramCode}`} target="_blank" rel="noreferrer">
                  @{data.bot}
                </a>{" "}
                and press Start, or send it <span className="font-mono">{c.telegramCode}</span>. A backup person (like a parent) can use the same link.
              </>
            ) : (
              <button className="underline" onClick={() => run(c.id + ":tg", async () => void (await update({ data: signEnvelope(seed, "update", { cardId: c.id, newTelegramCode: true }) })))}>
                Add an approver
              </button>
            )}
          </div>
          {c.payments.length > 0 && (
            <ul className="divide-y divide-border text-xs">
              {c.payments.map((p) => (
                <li key={p.id} className="flex justify-between py-1">
                  <span>
                    ${p.usd.toFixed(2)} · {p.merchant}
                  </span>
                  <span className={p.status === "paid" ? "" : "text-muted-foreground"}>{p.status === "approval" ? "waiting" : p.status}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {c.status === "locked" && (
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(c.id + ":unlock", async () => void (await update({ data: signEnvelope(seed, "update", { cardId: c.id, unlock: true }) })))}>
                Unlock card
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              disabled={!!busy}
              onClick={() => {
                if (!confirm(`Kill "${c.label}"? It stops working right away, and its coins move back to your main wallet.`)) return;
                void run(c.id + ":kill", async () => {
                  const r = await kill({ data: signEnvelope(seed, "kill", { cardId: c.id }) });
                  return r.txid ? "Card killed. Its coins are on the way back to your main wallet." : `Card killed. ${r.note ? `Nothing was moved (${r.note}).` : ""}`;
                });
              }}
            >
              {busy === c.id + ":kill" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Kill card / lost card
            </Button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="min-w-0 space-y-4 border-t border-border pt-5">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="card-number" className="text-sm">Card identifier</Label>
            <Input id="card-number" className="h-11 min-w-0 text-base md:text-base" value={uid} onChange={(e) => setUid(e.target.value)} placeholder="04:A2:1B:…" autoCapitalize="characters" />
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="card-name" className="text-sm">Name</Label>
            <Input id="card-name" className="h-11 min-w-0 text-base md:text-base" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
          </div>
          <Rules value={rules} onChange={setRules} />
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button
              size="sm"
              className="h-11"
              disabled={!!busy || uid.replace(/[^0-9a-z]/gi, "").length < 4}
              onClick={() =>
                run("link", async () => {
                  const index = nextPocketIndex();
                  const pocket = cardPocket(seed, index);
                  await link({
                    data: signEnvelope(seed, "link", {
                      uid,
                      label: label.trim() || "My card",
                      pinRule: "always",
                      pin: rules.pin,
                      pinAboveUsd: num(rules.pinAboveUsd),
                      perTapUsd: num(rules.perTapUsd),
                      dailyUsd: num(rules.dailyUsd),
                      pocketIndex: index,
                      pocketAddress: pocket.address,
                      pocketKeyHex: pocket.keyHex,
                      returnAddress: returnAddress(seed),
                    }),
                  });
                  bumpPocketIndex(index);
                  setAdding(false);
                  setUid("");
                  setRules(DEFAULT_RULES);
                  return "Card linked. Add TSD, plus a little TXC for network fees, then link a Telegram approver.";
                })
              }
            >
              {busy === "link" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Link card
            </Button>
            <Button size="sm" className="h-11" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="h-11 w-full sm:w-auto" variant="outline" onClick={() => setAdding(true)}>
          Link a card
        </Button>
      )}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {!data && <Loader2 className="h-4 w-4 animate-spin" />}
    </div>
  );
}
