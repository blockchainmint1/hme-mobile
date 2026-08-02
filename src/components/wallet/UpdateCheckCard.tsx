/**
 * "Check for updates" card. On the web/PWA it compares the running build's
 * assets with what the server is serving now and offers a hard reload. In the
 * native shell the bundle is frozen at install time, so it points at the
 * latest APK instead.
 */
import { useState } from "react";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APK_URL, APP_VERSION, applyWebUpdate, checkForWebUpdate } from "@/lib/app-release";
import { isNative, nativePlatform } from "@/lib/native/platform";

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

export function UpdateCheckCard() {
  const [status, setStatus] = useState<"idle" | "checking" | "current" | "update" | "unknown">(
    "idle",
  );
  const native = isNative();
  const platform = nativePlatform();

  async function check() {
    setStatus("checking");
    setStatus(await checkForWebUpdate());
  }

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCw className="h-5 w-5" /> Updates
        </CardTitle>
        <CardDescription>
          Version {APP_VERSION}
          {native ? ` · ${platform} app` : " · web"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {native ? (
          <>
            <p className="text-sm text-muted-foreground">
              {platform === "android"
                ? "Installed apps don't update themselves here — grab the latest build below or from your store listing."
                : "Updates for the iOS app arrive through the App Store."}
            </p>
            {platform === "android" && (
              <Button variant="outline" className="w-full" onClick={() => openExternal(APK_URL)}>
                <Download className="h-4 w-4 mr-2" /> Download latest APK
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              variant="outline"
              className="w-full"
              onClick={check}
              disabled={status === "checking"}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${status === "checking" ? "animate-spin" : ""}`} />
              {status === "checking" ? "Checking…" : "Check for updates"}
            </Button>
            {status === "current" && (
              <p className="text-sm text-muted-foreground">You're on the latest version.</p>
            )}
            {status === "unknown" && (
              <p className="text-sm text-muted-foreground">
                Couldn't reach the update server. You can still reload to refresh the app.
              </p>
            )}
            {(status === "update" || status === "unknown") && (
              <Button className="w-full" onClick={() => void applyWebUpdate()}>
                {status === "update" ? "Update now" : "Reload app"}
              </Button>
            )}
            {status === "update" && (
              <p className="text-xs text-muted-foreground">
                Your wallet stays on this device — updating only refreshes the app code.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
