/**
 * EVM chain layout — pass-through so /wallet/evm/$chain/send and /receive render.
 * The chain "detail" is shown inline on /wallet as the active tile, so this route
 * has no standalone UI of its own.
 */
import { createFileRoute, Outlet, notFound } from "@tanstack/react-router";
import { EVM_CHAINS } from "@/lib/chains/evm";

export const Route = createFileRoute("/wallet/evm/$chain")({
  component: () => <Outlet />,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});
