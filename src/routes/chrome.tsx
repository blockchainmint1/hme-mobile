import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { downloadExtensionZip, EXTENSION_ZIP_NAME } from "@/lib/extension-download";
import type { ReactNode } from "react";

export const Route = createFileRoute("/chrome")({
  head: () => ({
    meta: [
      { title: "Browser extension install guide — HME Wallet" },
      {
        name: "description",
        content:
          "Install the honest.money wallet as a browser extension in about two minutes: download, unzip, load unpacked. Works in Chrome, Edge, Brave, Arc and Opera.",
      },
      { property: "og:title", content: "honest.money browser extension — install guide" },
      {
        property: "og:description",
        content:
          "The same wallet engine as the phone app, in your browser: hold TEXITcoin, and sign in to websites with one click.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChromeExtensionPage,
});

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-xs font-semibold text-foreground">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <div className="mt-1 space-y-1 text-sm text-muted-foreground [&>*]:leading-relaxed">
          {children}
        </div>
      </div>
    </li>
  );
}

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border/60 bg-card/40 p-5 text-sm text-muted-foreground ${className}`}
    >
      <h2 className="font-semibold text-foreground mb-2">{title}</h2>
      {children}
    </section>
  );
}

function ChromeExtensionPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Home
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
        honest.money in your browser
      </h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        The same wallet engine as the phone app, as a browser extension: create or import a wallet,
        hold TEXITcoin, and sign in to websites with one click instead of scanning a code. Everything
        below is the install guide — the button hands you the current package.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={downloadExtensionZip} size="lg">
          Download the extension
        </Button>
        <span className="text-xs text-muted-foreground">
          {EXTENSION_ZIP_NAME} · Chrome, Edge, Brave, Arc, Opera
        </span>
      </div>

      <Panel title="Install — about two minutes" className="mt-8">
        <ol className="space-y-4">
          <Step n={1} title="Download the package">
            <p>Use the button above. It is a plain zip file, nothing to run or install.</p>
          </Step>
          <Step n={2} title="Unzip it">
            <p>
              Keep the unzipped folder somewhere permanent. Your browser loads the extension from
              that folder every time it starts, so deleting or moving it later breaks the extension.
            </p>
          </Step>
          <Step n={3} title="Open your extensions page">
            <p>
              Open a new tab, paste <code className="text-foreground">chrome://extensions</code> into
              the address bar and press Enter. Edge: <code>edge://extensions</code> · Brave:{" "}
              <code>brave://extensions</code> · Opera: <code>opera://extensions</code>.
            </p>
          </Step>
          <Step n={4} title="Turn on Developer mode">
            <p>The toggle sits in the top-right corner of that page.</p>
          </Step>
          <Step n={5} title="Click Load unpacked">
            <p>
              Then pick the unzipped folder — the folder itself, not the zip file. It should contain{" "}
              <code className="text-foreground">manifest.json</code>.
            </p>
          </Step>
          <Step n={6} title="Pin it and open it">
            <p>
              Click the puzzle-piece icon in the toolbar and pin{" "}
              <strong className="text-foreground">honest.money wallet</strong>. Open it and either
              create a new wallet or import a seed phrase you already use.
            </p>
          </Step>
        </ol>
        <p className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
          Your browser will show a banner about developer-mode extensions and may offer to switch
          them off. Choose <strong className="text-foreground">Keep</strong> — that message appears
          for every manually installed extension, not because anything is wrong with this one.
        </p>
      </Panel>

      <Panel title="What it does today" className="mt-4">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Create a new wallet (a 12-word backup phrase) or import one you already have, locked
            behind a password.
          </li>
          <li>
            Import the same phrase you use in the phone app and both will control the same wallet.
          </li>
          <li>See your TEXITcoin balance, copy your receive address, and send TXC.</li>
          <li>
            Sign in to honest.money sites — like Bonfire — with one click, no QR code and no phone.
          </li>
          <li>
            Show up in &ldquo;Connect Wallet&rdquo; lists on sites that support multiple wallets,
            alongside whatever else you have installed rather than replacing it. The first time a
            site asks, a window opens showing which site and which address it will see; approve or
            reject, and approved sites are remembered.
          </li>
          <li>
            Before signing any message or login request, it shows you exactly what you are signing.
          </li>
        </ul>
      </Panel>

      <Panel title="What it doesn't do yet" className="mt-4">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            It will not move money on a website&rsquo;s behalf. A site that asks for a payment gets a
            clear &ldquo;not supported yet&rdquo; answer, and you send from the wallet&rsquo;s own
            Send screen.
          </li>
          <li>
            The wallet window itself is TEXITcoin only for now — Bitcoin, Litecoin, Dogecoin,
            Solana, Tron and the rest live in the phone app.
          </li>
          <li>
            There is no Chrome Web Store listing yet, which is why these steps exist and why updates
            are manual (below).
          </li>
        </ul>
      </Panel>

      <Panel title="Updating to a newer build" className="mt-4">
        <p>
          Download the new zip, unzip it, and copy its contents over the old folder. Then open{" "}
          <code className="text-foreground">chrome://extensions</code> and click the{" "}
          <strong className="text-foreground">reload</strong> (↻) icon on the honest.money wallet
          card.
        </p>
        <p className="mt-2">
          Don&rsquo;t click <em>Remove</em> to update — your wallet is stored in that extension
          entry, and removing it erases it, leaving your seed phrase as the only way back in.
        </p>
      </Panel>

      <Panel title="If something goes wrong" className="mt-4">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-foreground">Load unpacked is greyed out</strong> — Developer mode
            isn&rsquo;t on yet (step 4).
          </li>
          <li>
            <strong className="text-foreground">A manifest or icon error</strong> — you picked the
            zip file or the wrong folder. Choose the unzipped folder that holds{" "}
            <code>manifest.json</code>.
          </li>
          <li>
            <strong className="text-foreground">A website doesn&rsquo;t notice the wallet</strong> —
            refresh the page. Sites look for wallets when they load, so a page opened before
            installing won&rsquo;t see it.
          </li>
          <li>
            <strong className="text-foreground">The browser nags you every start-up</strong> — normal
            for manually installed extensions. Click Keep.
          </li>
        </ul>
      </Panel>

      <Panel title="Your keys stay yours" className="mt-4">
        <p>
          Your seed phrase is encrypted with your password and saved in the extension&rsquo;s own
          browser storage — not on our servers, and not somewhere another extension can read. While
          unlocked, the key lives only in the open window&rsquo;s memory and disappears the moment
          you close it. Websites never receive your keys; they only ever get a signature you
          explicitly approved. The code is in the open at{" "}
          <a
            href="https://github.com/blockchainmint1/hme-mobile"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            github.com/blockchainmint1/hme-mobile
          </a>
          .
        </p>
      </Panel>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={downloadExtensionZip}>
          Download the extension
        </Button>
        <Link to="/manifesto" className="text-sm text-muted-foreground hover:text-foreground">
          Why this exists →
        </Link>
      </div>
    </main>
  );
}
