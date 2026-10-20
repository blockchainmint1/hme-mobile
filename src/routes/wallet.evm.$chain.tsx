/**
 * EVM chain layout — pass-through so /wallet/evm/$chain/send and /receive render.
 * The chain "detail" is shown inline on /wallet as the active tile, so this route
 * has no standalone UI of its own.
 */
import { createFileRoute, Outlet, notFound } from "@tanstack/react-router";
import { EVM_CHAINS } from "@/lib/chains/evm";

export const Route = createFileRoute("/wallet/evm/$chain")({
  head: () => ({ meta: [{ title: "Ethereum-network wallet — HME Wallet" }, { name: "description", content: "Manage your supported EVM coins and tokens in HME Wallet." }, { property: "og:title", content: "Ethereum-network wallet — HME Wallet" }, { property: "og:description", content: "Manage supported EVM assets with HME Wallet." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <Outlet />,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});
