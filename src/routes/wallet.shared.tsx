import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Nfc, QrCode } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { DelegateLinkCard } from "@/components/wallet/DelegateLinkCard";
import { TradingPocketCard } from "@/components/wallet/TradingPocketCard";
import { TapCardCard } from "@/components/wallet/TapCardCard";
import { DELEGATE_LINKS_EVENT, listDelegateLinks, peekManifestType } from "@/lib/xpub-link/delegate";
import { parseLinkInput } from "@/lib/nectar/link";
import { useFeature } from "@/lib/feature-prefs";

export const Route = createFileRoute("/wallet/shared")({
  head: () => ({
    meta: [
      { title: "Shared wallets — HME Wallet" },
      { name: "description", content: "Small wallets a partner can spend from, kept separate from your main wallet." },
    ],
  }),
  component: SharedWalletsPage,
});

function SharedWalletsPage() {
  const [enabled, setEnabled] = useFeature("sharedWallets");
  const [links, setLinks] = useState(() => listDelegateLinks().length);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<{ kind: "delegate" | "other"; url: string; n: number } | null>(null);

  async function load(raw: string) {
    if (!raw.trim()) return;
    const url = parseLinkInput(raw);
    const kind =
      url && (await peekManifestType(url)) === "hm-link-delegate" ? ("delegate" as const) : ("other" as const);
    setTarget({ kind, url: (url ?? raw).trim(), n: (target?.n ?? 0) + 1 });
    setInput(kind === "delegate" ? (url ?? raw).trim() : input);
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Shared wallets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A small wallet you fill yourself. The partner can spend only what's in it — never your
          main wallet — and you can move it back or shut it off anytime. Your seed phrase backup
          already covers these.
        </p>
      </div>

      {!enabled && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-muted-foreground">
              Shared wallets are turned off in Extra features. Anything already shared keeps working.
            </p>
            <Button onClick={() => setEnabled(true)}>Turn on</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-4 w-4" /> Trading sites
          </CardTitle>
          <CardDescription className="text-xs">
            Like Seeds Exchange. Scan the QR code on the site's profile page to share a wallet with it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste or scan the site's link code"
              className="text-xs"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
            <QrScanButton
              onScan={(text) => {
                setInput(text);
                void load(text);
              }}
            />
            <Button type="button" variant="outline" disabled={!input.trim()} onClick={() => void load(input)}>
              Read
            </Button>
          </div>

          {target?.kind === "delegate" && (
            <div className="mt-4">
              <DelegateLinkCard key={`d-${target.n}`} manifestUrl={target.url} />
            </div>
          )}
          {target?.kind === "other" && (
            <p className="mt-3 text-xs text-muted-foreground">
              That doesn't look like a trading-site link. Other ecosystem sites link in Settings →
              Ecosystem links.{" "}
              <Link to="/wallet/settings" className="underline">
                Open Settings
              </Link>
            </p>
          )}

          {links === 0 && target?.kind !== "delegate" && (
            <p className="mt-3 text-xs text-muted-foreground">Nothing shared with a trading site yet.</p>
          )}
        </CardContent>
      </Card>
      {links > 0 && <TradingPocketCard />}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Nfc className="h-4 w-4" /> Tap cards (NectarPay)
          </CardTitle>
          <CardDescription className="text-xs">
            Link a card, fill its wallet with TSD, and tap to pay at NectarPay checkouts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TapCardCard />
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <QrCode className="h-3.5 w-3.5 shrink-0" />
        Tip: the same scanner also lives in Settings → Ecosystem links.
      </p>
    </main>
  );
}
