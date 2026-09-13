import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/swap-selftest")({
  server: {
    handlers: {
      GET: async () => {
        const { quoteAllProviders } = await import("@/lib/swap-providers/registry.server");
        try {
          const r = await quoteAllProviders({
            coin: "ltc",
            dest: {
              asset: "BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913",
              symbol: "USDC",
              chain: "base",
              label: "USDC on Base",
            },
            amountSats: 100_000_000,
            destination: "0x0000000000000000000000000000000000000001",
            refundAddress: "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
          });
          return Response.json(r);
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
