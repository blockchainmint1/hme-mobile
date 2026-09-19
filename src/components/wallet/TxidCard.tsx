import { useState } from "react";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";
import { hapticSuccess, shareText } from "@/lib/native/ui";

/**
 * Success-screen block shown after a broadcast on any chain: the full
 * transaction id in a copyable card plus an optional explorer link.
 * Keeps every chain's send screen consistent — copy first, explorer second.
 */
export function TxidCard({
  txid,
  explorerUrl,
  label = "Transaction ID",
  explorerLabel = "View on explorer",
}: {
  txid: string;
  explorerUrl?: string | null;
  label?: string;
  explorerLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyToClipboard(txid)) {
      hapticSuccess();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function share() {
    // Share the txid (plus the explorer link when we have one); if the
    // device can't share, fall back to copying so the id is still at hand.
    const shared = await shareText({
      title: label,
      text: explorerUrl ? `${txid}\n${explorerUrl}` : txid,
      url: explorerUrl ?? undefined,
      dialogTitle: "Share transaction",
    });
    if (!shared) await copy();
  }

  return (
    <div className="mx-auto mt-5 w-full max-w-sm rounded-xl border border-border/60 bg-card/60 p-4 text-left">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-1.5 block w-full text-left font-mono text-xs break-all text-foreground/90"
        title="Tap to copy"
      >
        {txid}
      </button>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          onClick={() => void copy()}
          variant={copied ? "secondary" : "default"}
          className="flex-1"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-400" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" /> Copy
            </>
          )}
        </Button>
        <Button
          type="button"
          onClick={() => void share()}
          variant="secondary"
          className="flex-1"
        >
          <Share2 className="h-4 w-4" /> Share
        </Button>
        {explorerUrl && (
          <Button asChild variant="secondary" className="flex-1">
            <a href={explorerUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
