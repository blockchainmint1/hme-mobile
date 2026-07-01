import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installQueryPersistence } from "@/lib/query-persist";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Show cached data instantly on mount; refetch in background.
        // 90s stale time means a reopen within 90s of the last fetch
        // spends zero API calls — hits the persisted cache directly.
        staleTime: 90_000,
        gcTime: 24 * 60 * 60 * 1000, // keep in memory for 24h so persister can rehydrate it
        // Never silently re-hit APIs when the tab regains focus; users have
        // explicit per-tile refresh buttons plus manual pull-to-refresh.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
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
