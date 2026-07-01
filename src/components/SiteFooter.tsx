import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isNative } from "@/lib/native/platform";

async function openExternal(url: string) {
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function SiteFooter() {
  // Inside the native app the footer takes up scarce vertical real estate and
  // the external <a> targets would try to hijack the WebView. Skip it entirely.
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNative()), []);
  if (native) return null;

  return (
    <footer className="border-t border-border/60 bg-background/60 py-8 mt-12">
      <div className="mx-auto max-w-5xl px-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
        <p>
          Part of the{" "}
          <button
            type="button"
            onClick={() => openExternal("https://honest.money")}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            honest.money
          </button>{" "}
          ecosystem.
        </p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/manifesto" className="hover:text-foreground">
            Manifesto
          </Link>
          <Link to="/legal/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link to="/legal/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <button
            type="button"
            onClick={() => openExternal("https://texitcoin.org/build")}
            className="hover:text-foreground"
          >
            Build on TEXITcoin
          </button>
        </nav>
      </div>
    </footer>
  );
}
