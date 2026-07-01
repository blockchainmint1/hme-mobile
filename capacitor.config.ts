import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync } from "node:fs";

const webDir = existsSync("dist/client/index.html") ? "dist/client" : ".output/public";

/**
 * Capacitor config for the HME Wallet mobile app.
 *
 * The web app is served from TanStack Start's static SPA output.
 * `vite.config.ts` writes Capacitor's entry file to `dist/client/index.html`;
 * the `.output/public` fallback keeps sync tolerant of alternate adapters.
 * When developing against a live Lovable preview, set `server.url` to the
 * preview URL instead of bundling.
 */
const config: CapacitorConfig = {
  appId: "money.honest.txcwallet",
  appName: "HME Wallet",
  webDir,
  backgroundColor: "#0b0f14",
  ios: {
    contentInset: "always",
    backgroundColor: "#0b0f14",
  },
  android: {
    backgroundColor: "#0b0f14",
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#0b0f14",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0f14",
    },
  },
};

export default config;
