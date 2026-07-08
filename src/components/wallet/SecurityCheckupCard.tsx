/**
 * Security Checkup: a client-side self-test the user can open from Settings to
 * see, at a glance, whether their wallet is running in a hardened state.
 *
 * Every check runs locally. Nothing here is a substitute for the server-side
 * and native hardening tracked in SECURITY-AUDIT.md; it surfaces the things a
 * user can actually see or act on, plus one integrity signal (bundled vs
 * remote-loaded) that maps directly to the H1 risk.
 */
import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Info, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getBiometricStatus } from "@/lib/native/biometric";
import { isNative, nativePlatform } from "@/lib/native/platform";
import { hasWallet } from "@/lib/txc/storage";

type Level = "pass" | "warn" | "info";
interface Check {
  level: Level;
  label: string;
  detail: string;
}

/**
 * Best-effort integrity signal. In a bundled native build the webview origin is
 * capacitor://localhost (iOS) or https://localhost (Android). If a native app
 * reports a real remote hostname, its code was downloaded at runtime (H1).
 */
function loadOrigin(): { bundled: boolean; origin: string } {
  if (typeof window === "undefined") return { bundled: true, origin: "" };
  const { protocol, hostname, origin } = window.location;
  const bundled = protocol === "capacitor:" || hostname === "localhost" || hostname === "127.0.0.1";
  return { bundled, origin };
}

/** Heuristic jailbreak/root hint. Native OS-backed detection is a follow-up. */
function looksTampered(): boolean {
  try {
    // Cydia/Frida-style globals occasionally leak into the webview on
    // jailbroken devices. This is only a hint, never a guarantee.
    const w = window as unknown as Record<string, unknown>;
    return Boolean(w.cydia || w.__frida || w.frida);
  } catch {
    return false;
  }
}

export function SecurityCheckupCard() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: Check[] = [];
      const native = isNative();
      const { bundled, origin } = loadOrigin();

      // Encrypted wallet present.
      out.push(
        hasWallet()
          ? {
              level: "pass",
              label: "Wallet is encrypted on this device",
              detail: "Your seed is stored as AES-GCM ciphertext, unlocked only by your password.",
            }
          : {
              level: "info",
              label: "No wallet on this device yet",
              detail: "Create or import a wallet to enable the rest of these checks.",
            },
      );

      // Installed app vs browser.
      out.push(
        native
          ? {
              level: "pass",
              label: `Running as the installed ${nativePlatform()} app`,
              detail: "Biometric unlock and OS secure storage are available.",
            }
          : {
              level: "info",
              label: "Running in a web browser",
              detail:
                "For biometric unlock and hardware-backed key storage, install the iOS or Android app.",
            },
      );

      // App integrity: bundled vs remote-loaded (H1).
      if (native) {
        out.push(
          bundled
            ? {
                level: "pass",
                label: "App code is bundled in the binary",
                detail: "The app is not downloading its code from a remote server at launch.",
              }
            : {
                level: "warn",
                label: "App code is loaded from a remote server",
                detail: `This build runs code fetched from ${origin} at launch. A signed, bundled build is strongly recommended.`,
              },
        );
      }

      // Biometric status.
      try {
        const bio = await getBiometricStatus();
        if (!native) {
          // already covered by the browser note
        } else if (!bio.available) {
          out.push({
            level: "info",
            label: "Biometrics not set up on this device",
            detail: "Enable Face ID / fingerprint in your device settings to use biometric unlock.",
          });
        } else if (bio.enabled) {
          out.push({
            level: "pass",
            label: "Biometric unlock is on",
            detail:
              "Face ID / fingerprint is required to unlock. Your password is still needed to reveal the seed.",
          });
        } else {
          out.push({
            level: "warn",
            label: "Biometric unlock is off",
            detail: "Turn it on below so your password is not typed on every open.",
          });
        }
      } catch {
        /* ignore */
      }

      // Auto-lock (always on).
      out.push({
        level: "pass",
        label: "Auto-lock is active",
        detail:
          "The wallet locks after 5 minutes idle and immediately when you background the app.",
      });

      // Screenshot protection (Android system-enforced; iOS best-effort).
      out.push({
        level: "info",
        label: "Protect your seed screen",
        detail: native
          ? "On Android the seed screen blocks screenshots. iOS cannot block on-device screenshots, so make sure no one is watching."
          : "Never screenshot your seed phrase. Write it on paper.",
      });

      // Tamper hint.
      if (native && looksTampered()) {
        out.push({
          level: "warn",
          label: "This device may be jailbroken or rooted",
          detail:
            "Secure storage can be weaker on a modified device. Prefer a stock device for large balances.",
        });
      }

      if (!cancelled) setChecks(out);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Security checkup
        </CardTitle>
        <CardDescription>
          A quick self-test of this device. Run it after any big change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {!checks ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        ) : (
          checks.map((c, i) => <CheckRow key={i} check={c} />)
        )}
      </CardContent>
    </Card>
  );
}

function CheckRow({ check }: { check: Check }) {
  const Icon = check.level === "pass" ? ShieldCheck : check.level === "warn" ? ShieldAlert : Info;
  const color =
    check.level === "pass"
      ? "text-emerald-500"
      : check.level === "warn"
        ? "text-amber-500"
        : "text-muted-foreground";
  return (
    <div className="flex items-start gap-2.5">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium">{check.label}</div>
        <div className="text-xs text-muted-foreground">{check.detail}</div>
      </div>
    </div>
  );
}
