import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for the HME Wallet mobile app.
 *
 * The web app is served from TanStack Start's static SPA output.
 * `bun run build` writes or mirrors the static bundle to `dist/client` and
 * generates `dist/client/index.html`, which is the native webview entry point.
 * When developing against a live Lovable preview, set `server.url` to the
 * preview URL instead of bundling.
 */
const config: CapacitorConfig = {
  appId: "money.honest.txcwallet",
  appName: "HME Wallet",
  webDir: "dist/client",
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
