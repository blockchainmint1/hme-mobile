/**
 * "Check for updates" card. It asks the backend which release is newest for
 * this platform (Android/iOS/web) and compares it with the version baked into
 * the running build. On Android a newer release offers the pinned IPFS APK; on
 * the web it also compares the served assets and offers a hard reload.
 */
import { useEffect, useState } from "react";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APK_URL,
  APP_VERSION,
  applyWebUpdate,
  checkForWebUpdate,
  compareVersions,
  fetchLatestRelease,
  installedVersion,
  releaseDownloadUrl,
  type AppRelease,
} from "@/lib/app-release";
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

type Status = "idle" | "checking" | "current" | "update" | "unknown";

export function UpdateCheckCard() {
  const [status, setStatus] = useState<Status>("idle");
  const [latest, setLatest] = useState<AppRelease | null>(null);
  const [webStale, setWebStale] = useState(false);
  const [current, setCurrent] = useState(APP_VERSION);
  const native = isNative();
  const platform = nativePlatform();
  const releasePlatform = native ? (platform === "ios" ? "ios" : "android") : "web";

  useEffect(() => {
    installedVersion()
      .then(setCurrent)
      .catch(() => undefined);
  }, []);

  async function check() {
    setStatus("checking");
    setWebStale(false);

    // Two independent questions, asked every time:
    //  1. Is there a newer published release for this platform?
    //  2. Is the web bundle we're running behind what the server ships?
    // The native shell loads its content from the server, so (2) matters
    // inside the app too — a stale webview cache is the common failure.
    const [rel, web] = await Promise.all([
      fetchLatestRelease(releasePlatform),
      checkForWebUpdate(),
    ]);
    setLatest(rel);
    setWebStale(web === "update");

    const installed = await installedVersion();
    setCurrent(installed);

    if (rel && compareVersions(rel.version, installed) > 0) {
      setStatus("update");
      return;
    }
    if (web === "update") {
      setStatus("update");
      return;
    }
    if (!rel && web === "unknown") {
      setStatus("unknown");
      return;
    }
    setStatus("current");
  }

  const downloadUrl = releaseDownloadUrl(latest) || APK_URL;
  const nativeUpdate = !!latest && compareVersions(latest.version, current) > 0;

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCw className="h-5 w-5" /> Updates
        </CardTitle>
        <CardDescription>
          Version {current}
          {native ? ` · ${platform} app` : " · web"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
          <p className="text-sm text-muted-foreground">
            You&apos;re on the latest version{latest ? ` (${latest.version})` : ""}.
          </p>
        )}

        {status === "unknown" && (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t reach the update server. Check your connection and try again — you can
            still reload the app below.
          </p>
        )}

        {status === "update" && nativeUpdate && latest && (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">Version {latest.version}</span> is available.
              {latest.mandatory ? " This is a required update." : ""}
            </p>
            {latest.notes && <p className="text-sm text-muted-foreground">{latest.notes}</p>}
          </div>
        )}

        {status === "update" && nativeUpdate && releasePlatform === "ios" && (
          <p className="text-sm text-muted-foreground">
            Updates for the iOS app arrive through the App Store.
          </p>
        )}

        {status === "update" && nativeUpdate && releasePlatform === "android" && (
          <Button className="w-full" onClick={() => openExternal(downloadUrl)}>
            <Download className="h-4 w-4 mr-2" /> Download {latest?.version ?? "latest"} APK
          </Button>
        )}

        {webStale && (
          <>
            <p className="text-sm">Newer app code is live. Reload to get it.</p>
            <Button className="w-full" onClick={() => void applyWebUpdate()}>
              Update now
            </Button>
            <p className="text-xs text-muted-foreground">
              Your wallet stays on this device — updating only refreshes the app code.
            </p>
          </>
        )}

        {!webStale && status === "unknown" && (
          <Button className="w-full" onClick={() => void applyWebUpdate()}>
            Reload app
          </Button>
        )}

        {native && platform === "android" && !nativeUpdate && (
          <Button variant="ghost" className="w-full" onClick={() => openExternal(downloadUrl)}>
            <Download className="h-4 w-4 mr-2" /> Download latest APK anyway
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
