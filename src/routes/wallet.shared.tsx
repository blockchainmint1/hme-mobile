import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Nfc, QrCode } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TradingPocketCard } from "@/components/wallet/TradingPocketCard";
import { TapCardCard } from "@/components/wallet/TapCardCard";
import { DELEGATE_LINKS_EVENT, listDelegateLinks } from "@/lib/xpub-link/delegate";
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
  const [links, setLinks] = useState(0);
  useEffect(() => {
    const h = () => setLinks(listDelegateLinks().length);
    h();
    window.addEventListener(DELEGATE_LINKS_EVENT, h);
    return () => window.removeEventListener(DELEGATE_LINKS_EVENT, h);
  }, []);

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
          <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
            <Link to="/wallet/settings">
              <QrCode className="mr-2 h-4 w-4" /> Scan a site's QR (Settings → Ecosystem links)
            </Link>
          </Button>
          {links === 0 && (
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
    </main>
  );
}
