/**
 * Loads the honest.money trusted-site registry once per app start and keeps
 * the last good copy on the device so labels work offline. Runs in web, APK
 * and extension (server fns are bridged on native/extension).
 */
import { useEffect } from "react";
import { setEcosystemSites } from "@/lib/web-login-hosts";
import { getEcosystemSites } from "@/lib/ecosystem-sites.functions";

const KEY = "hme:ecosystem-sites";

export function useEcosystemSites(): void {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setEcosystemSites(JSON.parse(saved));
    } catch {
      /* ignore */
    }
    getEcosystemSites()
      .then(({ sites }) => {
        if (!sites.length) return;
        setEcosystemSites(sites);
        try {
          localStorage.setItem(KEY, JSON.stringify(sites));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, []);
}
