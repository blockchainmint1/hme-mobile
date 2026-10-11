/**
 * One place to link this wallet with any ecosystem site (Nectar Pay, Bonfire,
 * File Fingerprint, TSD Swap, …). A single paste/scan box detects which kind
 * of link code it is and hands it to the matching flow. Every flow shares
 * watch-only public keys only and always asks for approval.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { NectarLinkCard } from "@/components/wallet/NectarLinkCard";
import { TsdAccountLinkCard } from "@/components/wallet/TsdAccountLinkCard";
import { parseTsdLinkInput } from "@/lib/rewards/tsd-link";
import { useWallet } from "@/lib/txc/wallet-context";

type Target = { kind: "tsd" | "site"; payload: string; n: number };

function route(raw: string, n: number): Target {
  return { kind: parseTsdLinkInput(raw) ? "tsd" : "site", payload: raw.trim(), n };
}

export function EcosystemLinksCard({ initialPayload }: { initialPayload?: string }) {
  const { unlocked } = useWallet();
  const seedless = !unlocked || unlocked.mode === "keyonly" || !unlocked.mnemonic;
  const [input, setInput] = useState(initialPayload ?? "");
  const [target, setTarget] = useState<Target | null>(
    initialPayload ? route(initialPayload, 0) : null,
  );

  function load(raw: string) {
    if (!raw.trim()) return;
    setTarget((t) => route(raw, (t?.n ?? 0) + 1));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Link this wallet with Nectar Pay, Bonfire, File Fingerprint, TSD Swap or any site that
        shows a wallet link code. Sites get watch-only keys — they can see addresses but never
        spend. You approve every link, and your seed phrase and private keys never leave this
        device.
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
