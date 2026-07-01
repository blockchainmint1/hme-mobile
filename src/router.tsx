import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installQueryPersistence } from "@/lib/query-persist";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Show cached data instantly on mount; refetch in background.
        staleTime: 30_000,
        gcTime: 24 * 60 * 60 * 1000, // keep in memory for 24h so persister can rehydrate it
      },
    },
  });

  // Only runs in the browser; safely no-ops during SSR.
  installQueryPersistence(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
