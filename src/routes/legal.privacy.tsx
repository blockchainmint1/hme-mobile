import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — HME Wallet" },
      {
        name: "description",
        content:
          "Privacy policy for the HME Wallet. No accounts, no analytics, no tracking — your seed never leaves your device.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 prose prose-invert">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground no-underline">
        ← Home
      </Link>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Draft — last updated June 29, 2026</p>

      <h2>The short version</h2>
      <ul>
        <li>No account. No email. No password reset.</li>
        <li>No analytics, no tracking pixels, no third-party cookies.</li>
        <li>Your seed phrase is encrypted on your own device and never sent anywhere.</li>
      </ul>

      <h2>What stays on your device</h2>
      <p>
        Your BIP39 seed phrase and any optional BIP39 passphrase are encrypted with a key derived
        from your wallet password (PBKDF2-SHA256, 600,000 iterations) and stored in your
        browser's local storage. The unencrypted seed exists only in memory while the wallet is
        unlocked.
      </p>

      <h2>What we ask the network</h2>
      <p>
        To show balances and broadcast transactions, the app talks to public TEXITcoin
        infrastructure (currently <code>mempool.texitcoin.org</code>). Those servers see your
        addresses and the IP address of your device the same way any blockchain explorer does.
        We do not run those servers and do not log any of those requests on our side.
      </p>

      <h2>Price data</h2>
      <p>
        If TXC price is shown, it is fetched server-side from a public price API. Your wallet
        addresses are not sent with that request.
      </p>

      <h2>Exchange swaps (the one exception)</h2>
      <p>
        If — and only if — you place a swap through one of our third-party exchange partners
        (currently SideShift and FixedFloat), anti-money-laundering rules require us to keep a
        record of that order. For those orders we store the order reference, the coin and amount,
        the payout asset and address, the deposit transaction, and your IP address, browser
        User-Agent string, and browser language list. We keep it for 13 months and then delete it
        automatically. We disclose it only if the exchange partner or a lawful authority requests
        the details of a specific exchange.
      </p>
      <p>
        Swaps routed through THORChain, and every ordinary send, receive, or balance check, are
        not logged this way. We never link this record to your seed phrase, and we do not use it
        for analytics, profiling, or advertising.
      </p>

      <h2>Children</h2>
      <p>The app is not directed to children under 13.</p>

      <h2>Contact</h2>
      <p>
        Questions? Reach out through the{" "}
        <a href="https://honest.money" target="_blank" rel="noreferrer">
          honest.money
        </a>{" "}
        community.
      </p>
    </main>
  );
}
