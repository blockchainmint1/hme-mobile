/**
 * One place to link this wallet with any ecosystem site (Nectar Pay, Bonfire,
 * File Fingerprint, TSD Swap, Seeds, …). A single paste/scan box detects which
 * kind of link code it is and hands it to the matching flow. Look-only links
 * share watch-only keys; trading links (Seeds) offer "give access" or
 * "approve every trade". Every flow asks for approval.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { NectarLinkCard } from "@/components/wallet/NectarLinkCard";
import { TsdAccountLinkCard } from "@/components/wallet/TsdAccountLinkCard";
import { DelegateLinkCard } from "@/components/wallet/DelegateLinkCard";
import { parseTsdLinkInput } from "@/lib/rewards/tsd-link";
import { parseLinkInput } from "@/lib/nectar/link";
import { peekManifestType } from "@/lib/xpub-link/delegate";
import { useWallet } from "@/lib/txc/wallet-context";

type Target = { kind: "tsd" | "site" | "delegate"; payload: string; n: number };

async function route(raw: string, n: number): Promise<Target> {
  if (parseTsdLinkInput(raw)) return { kind: "tsd", payload: raw.trim(), n };
  const url = parseLinkInput(raw);
  if (url && (await peekManifestType(url)) === "hm-link-delegate") return { kind: "delegate", payload: url, n };
  return { kind: "site", payload: raw.trim(), n };
}

export function EcosystemLinksCard({ initialPayload }: { initialPayload?: string }) {
  const { unlocked } = useWallet();
  const seedless = !unlocked || unlocked.mode === "keyonly" || !unlocked.mnemonic;
  const [input, setInput] = useState(initialPayload ?? "");
  const [target, setTarget] = useState<Target | null>(null);
  const [n, setN] = useState(0);

  function load(raw: string) {
    if (!raw.trim()) return;
    const next = n + 1;
    setN(next);
    void route(raw, next).then(setTarget);
  }

  useEffect(() => {
    if (initialPayload) load(initialPayload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayload]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Link this wallet with Nectar Pay, Bonfire, File Fingerprint, TSD Swap, Seeds or any site that
        shows a wallet link code. Most sites get watch-only keys — they can see addresses but never
        spend. Trading sites only ever touch your separate Trading pocket. You approve every link, and
        your seed phrase never leaves this device.
      </p>

      {seedless ? (
        <p className="text-xs text-muted-foreground">Only seed-phrase wallets can be linked.</p>
      ) : (
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste link URL"
            className="text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          <QrScanButton
            onScan={(text) => {
              setInput(text);
              load(text);
            }}
          />
          <Button type="button" variant="outline" disabled={!input.trim()} onClick={() => load(input)}>
            Read
          </Button>
        </div>
      )}

      {target?.kind === "delegate" && <DelegateLinkCard key={`d-${target.n}`} manifestUrl={target.payload} />}

      {/* Each flow keeps its own approval screen and list of linked sites. */}
      <NectarLinkCard
        compact
        hideInput
        key={`site-${target?.kind === "site" ? target.n : "idle"}`}
        initialPayload={target?.kind === "site" ? target.payload : undefined}
      />
      <TsdAccountLinkCard
        compact
        hideInput
        key={`tsd-${target?.kind === "tsd" ? target.n : "idle"}`}
        initialPayload={target?.kind === "tsd" ? target.payload : undefined}
      />
    </div>
  );
}
