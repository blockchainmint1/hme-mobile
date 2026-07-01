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
  server: {
    androidScheme: "https",
    // Allowlist only the domains we intentionally load in the WebView
    // (e.g. universal-link entry). External links use Browser.open() so
    // this stays tight; wildcard would defeat the point.
    allowNavigation: ["mobile.honest.money", "nectar-pay.com"],
  },
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
      // Auto-hide so a JS/hydration failure can never leave an invisible native
      // splash overlay blocking every tap on the landing page.
      launchAutoHide: true,
      launchShowDuration: 900,
      backgroundColor: "#0b0f14",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0f14",
    },
    PrivacyScreen: {
      // Do NOT enable at app startup. On iOS 17+ the screenshot-prevention
      // implementation wraps the app window in a secure UITextField, and that
      // can swallow every tap on the landing page. We still enable the privacy
      // screen explicitly only while the seed phrase is being shown.
      enable: false,
      imageName: "Splash",
      contentMode: "center",
      // Keep the app-switcher privacy cover, but avoid the iOS secure-textfield
      // screenshot hack globally; it is the most likely cause of the "nothing is
      // clickable" native build.
      preventScreenshots: false,
    },
  },
};

export default config;
