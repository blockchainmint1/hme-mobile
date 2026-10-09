import { createFileRoute } from "@tanstack/react-router";
import { NectarLinkCard } from "@/components/wallet/NectarLinkCard";

export const Route = createFileRoute("/wallet/xpub-link")({
  validateSearch: (s: Record<string, unknown>): { payload?: string } => ({
    payload: typeof s.payload === "string" ? s.payload : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Link your wallet to a site — Honest Money" },
      { name: "description", content: "Share one watch-only TXC key with a site you trust. It can never spend your coins." },
      { property: "og:title", content: "Link your wallet to a site — Honest Money" },
      { property: "og:description", content: "Share one watch-only TXC key with a site you trust." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: XpubLinkPage,
});

function XpubLinkPage() {
  const { payload } = Route.useSearch();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <NectarLinkCard initialPayload={payload} />
    </div>
  );
}
