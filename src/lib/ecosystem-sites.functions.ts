import { createServerFn } from "@tanstack/react-start";

/** Public list of honest.money ecosystem sites; empty on any failure. */
export const getEcosystemSites = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { loadEcosystemSites } = await import("./ecosystem-sites.server");
    return { sites: await loadEcosystemSites() };
  } catch (e) {
    console.warn("ecosystem registry unavailable", e);
    return { sites: [] as { host: string; label: string }[] };
  }
});
