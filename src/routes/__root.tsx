import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { WalletProvider } from "../lib/txc/wallet-context";
import { SiteFooter } from "../components/SiteFooter";
import { Toaster } from "../components/ui/sonner";
import { ThemeProvider } from "../lib/theme";
import icon192 from "../assets/icons/icon-192.webp";
import icon512 from "../assets/icons/icon-512.webp";

const THEME_INIT_SCRIPT = `(function(){try{var k='txc.theme';var t=localStorage.getItem(k)||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){document.documentElement.classList.add('dark');}})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. You can retry or head home. Your wallet data is unaffected.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "HME Wallet" },
      { name: "format-detection", content: "telephone=no" },
      { title: "HME Wallet — TEXITcoin & EVM multi-chain wallet" },
      {
        name: "description",
        content:
          "HME Wallet — a self-custodial multi-chain wallet for TEXITcoin (TXC), Ethereum, Base, and BSC. Part of the Honest Money ecosystem.",
      },
      { name: "theme-color", content: "#0b0f14" },
      { property: "og:title", content: "HME Wallet" },
      {
        property: "og:description",
        content:
          "Self-custodial multi-chain wallet for TEXITcoin and EVM assets. Hold your own keys.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "HME Wallet" },
      {
        name: "twitter:description",
        content:
          "Self-custodial multi-chain wallet for TEXITcoin and EVM assets. Hold your own keys.",
      },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e5412ff3-3f36-4086-9590-b2e64dae9c49/id-preview-32bb6bc2--633f1235-4607-4b38-ad25-8b0c6b359acb.lovable.app-1782729338829.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e5412ff3-3f36-4086-9590-b2e64dae9c49/id-preview-32bb6bc2--633f1235-4607-4b38-ad25-8b0c6b359acb.lovable.app-1782729338829.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/webp", sizes: "192x192", href: icon192 },
      { rel: "apple-touch-icon", sizes: "512x512", href: icon512 },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // Wire up Nectar.Pay tap-to-pay deep links (nectar:// + https universal
  // link). Native-only — no-op on web. See lib/native/deeplink.ts.
  useEffect(() => {
    document.documentElement.dataset.hmeHydrated = "true";
    let cancel: (() => void) | undefined;
    let cancelled = false;
    import("../lib/native/deeplink").then(({ registerPayDeepLinkListener }) => {
      registerPayDeepLinkListener(router).then((unsub) => {
        if (cancelled) unsub();
        else cancel = unsub;
      });
    });
    return () => {
      cancelled = true;
      cancel?.();
    };
  }, [router]);

  // Configure iOS/Android status bar + keyboard once on mount. No-op on web.
  useEffect(() => {
    import("../lib/native/ui").then(({ initNativeChrome }) => {
      initNativeChrome();
    });
    // Fire-and-forget observability init (no-op when VITE_SENTRY_DSN is unset).
    import("../lib/native/observability").then(({ initObservability }) => {
      initObservability();
    });
  }, []);

  // Android hardware back button: navigate in-app when we can, otherwise
  // minimize the app instead of exiting so users don't lose transient state.
  useEffect(() => {
    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { isNative, nativePlatform } = await import("../lib/native/platform");
        if (!isNative() || nativePlatform() !== "android") return;
        const { App } = await import("@capacitor/app");
        const sub = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack && window.history.length > 1) window.history.back();
          else App.minimizeApp().catch(() => {});
        });
        remove = () => sub.remove().catch(() => {});
      } catch {
        /* plugin missing */
      }
    })();
    return () => remove?.();
  }, []);

  // Simple offline banner — @capacitor/network is only wired natively; on
  // the web we fall back to the browser's navigator.onLine + events.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { isNative } = await import("../lib/native/platform");
        if (isNative()) {
          const { Network } = await import("@capacitor/network");
          const status = await Network.getStatus();
          setOffline(!status.connected);
          const sub = await Network.addListener("networkStatusChange", (s) => {
            setOffline(!s.connected);
          });
          remove = () => sub.remove().catch(() => {});
          return;
        }
      } catch {
        /* fall through to web */
      }
      const on = () => setOffline(false);
      const off = () => setOffline(true);
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      remove = () => {
        window.removeEventListener("online", on);
        window.removeEventListener("offline", off);
      };
    })();
    return () => remove?.();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WalletProvider>
          {/* Mobile-only frame: on phones it fills the screen; on larger screens
              we center a phone-width column so the app always feels like a mobile app. */}
          <div data-wallet-frame className="min-h-[100dvh] w-full bg-muted/40 sm:py-6">
            <div data-wallet-frame className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background sm:min-h-[calc(100dvh-3rem)] sm:rounded-[2.25rem] sm:shadow-2xl sm:ring-1 sm:ring-border overflow-hidden">
              {offline && (
                <div className="bg-amber-500/15 text-amber-300 text-xs text-center py-1.5 px-3 border-b border-amber-500/30">
                  You&apos;re offline — balances and prices may be out of date.
                </div>
              )}
              <div className="flex-1 pt-[env(safe-area-inset-top)]">
                <Outlet />
              </div>
              <div className="pb-[env(safe-area-inset-bottom)]">
                <SiteFooter />
              </div>
            </div>
          </div>
          <Toaster richColors closeButton position="top-center" />
        </WalletProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
