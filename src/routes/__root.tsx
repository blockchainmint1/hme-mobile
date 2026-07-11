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
import { CONTENT_SECURITY_POLICY_META } from "../lib/security/headers";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { WalletProvider } from "../lib/txc/wallet-context";
import { SiteFooter } from "../components/SiteFooter";
import { Toaster } from "../components/ui/sonner";
import { ThemeProvider } from "../lib/theme";
import { installNativeServerFnBridge } from "../lib/native/server-fn-bridge";
import icon192 from "../assets/icons/icon-192.webp";
import icon512 from "../assets/icons/icon-512.webp";

if (typeof window !== "undefined") {
  installNativeServerFnBridge();
  // Capacitor's console bridge JSON-stringifies each argument, and
  // JSON.stringify(new Error(...)) is "{}" because Error props are
  // non-enumerable. Expand Errors so message + stack survive the bridge
  // and actually show up in Xcode / Android Studio logs.
  const expand = (a: unknown): unknown => {
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
    return a;
  };
  for (const level of ["error", "warn", "log"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => orig(...args.map(expand));
  }
  window.addEventListener("error", (e) => {
    console.error("[window.error]", e.error ?? e.message ?? e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[unhandledrejection]", (e as PromiseRejectionEvent).reason);
  });
}

const THEME_INIT_SCRIPT = `(function(){try{var k='txc.theme';var t=localStorage.getItem(k)||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){document.documentElement.classList.add('dark');}})();`;
const NATIVE_NAV_FALLBACK_SCRIPT = `(function(){if(window.__HME_NATIVE_NAV_FALLBACK__)return;window.__HME_NATIVE_NAV_FALLBACK__=true;function routeFromEvent(e){var t=e.target;if(!t||!t.closest)return null;var a=t.closest('a[data-native-route],a[href="/import"],a[href="/create"]');if(!a)return null;var h=a.getAttribute('data-native-route')||a.getAttribute('href');return h==='/import'||h==='/create'?h:null}function go(e){if(document.documentElement&&document.documentElement.dataset&&document.documentElement.dataset.hmeHydrated==='true')return;var h=routeFromEvent(e);if(!h)return;e.preventDefault();e.stopPropagation();location.assign(h)}document.addEventListener('pointerup',go,true);document.addEventListener('touchend',go,true);document.addEventListener('click',go,true);})();`;

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

  const message = error?.message || String(error);
  const stack = error?.stack || "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Your wallet data is unaffected. Try again, or
          send this error to support so we can fix it.
        </p>
        <details className="mt-4 text-left rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground open:pb-3">
          <summary className="cursor-pointer font-medium text-foreground">
            Error details
          </summary>
          <p className="mt-2 break-words text-destructive font-mono">{message}</p>
          {stack && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-tight">
              {stack}
            </pre>
          )}
        </details>
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
      // Ship the CSP as a <meta> only in production builds. In dev, Vite's HMR
      // needs inline eval + websocket connections that a strict CSP blocks, so
      // we let the SSR server add headers there instead (also PROD-gated).
      ...(import.meta.env.PROD
        ? [{ "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY_META }]
        : []),
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
      },
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
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e5412ff3-3f36-4086-9590-b2e64dae9c49/id-preview-32bb6bc2--633f1235-4607-4b38-ad25-8b0c6b359acb.lovable.app-1782729338829.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e5412ff3-3f36-4086-9590-b2e64dae9c49/id-preview-32bb6bc2--633f1235-4607-4b38-ad25-8b0c6b359acb.lovable.app-1782729338829.png",
      },
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
        <script dangerouslySetInnerHTML={{ __html: NATIVE_NAV_FALLBACK_SCRIPT }} />
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
            <div
              data-wallet-frame
              className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background sm:min-h-[calc(100dvh-3rem)] sm:rounded-[2.25rem] sm:shadow-2xl sm:ring-1 sm:ring-border overflow-hidden"
            >
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
