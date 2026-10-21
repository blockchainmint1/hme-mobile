import { createFileRoute } from "@tanstack/react-router";
import { UtxoSwap } from "@/components/wallet/UtxoSwap";

export const Route = createFileRoute("/wallet/doge/swap")({
  head: () => ({
    meta: [
      { title: "Swap DOGE to stablecoins — HME Wallet" },
      {
        name: "description",
        content:
          "Swap Dogecoin for USDC or USDT through the best-paying route — THORChain or a non-custodial instant exchange — signed on your device inside HME Wallet.",
      },
      { property: "og:title", content: "Swap DOGE to stablecoins — HME Wallet" },
      {
        property: "og:description",
        content: "DOGE to USDC/USDT swaps with no bridge and no custodian.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <UtxoSwap coin="doge" />,
});
