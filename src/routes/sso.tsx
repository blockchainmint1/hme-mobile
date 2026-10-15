import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { redeemHmeTicket } from "@/lib/hme-profile/profile.functions";
import { PENDING_KEY } from "@/lib/hme-profile/store";

export const Route = createFileRoute("/sso")({
  head: () => ({
    meta: [
      { title: "Linking your Honest Money profile — HME Wallet" },
      { name: "description", content: "Finishing the link between your wallet and your honest.money profile." },
      { property: "og:title", content: "Linking your Honest Money profile" },
      { property: "og:description", content: "Finishing the link between your wallet and your honest.money profile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SsoReturn,
});

function SsoReturn() {
  const redeem = useServerFn(redeemHmeTicket);
  const [msg, setMsg] = useState("Finishing sign-in…");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const token = q.get("token") ?? "";
    const state = q.get("state") ?? "";
    // Drop the ticket from the address bar / history right away.
    window.history.replaceState(null, "", "/sso");
    redeem({ data: { token, state } })
      .then((r) => {
        const message = { type: "hme-profile-receipt", ...r };
        if (window.opener) {
          // Only a verified receipt (no raw ticket) is posted; the wallet
          // re-checks it server-side, so a fake message can't link anything.
          window.opener.postMessage(message, "*");
          setMsg("Linked. You can close this window.");
          setTimeout(() => window.close(), 600);
        } else {
          sessionStorage.setItem(PENDING_KEY, JSON.stringify(message));
          localStorage.setItem(PENDING_KEY, JSON.stringify(message));
          setMsg("Signed in. Go back to Settings to finish linking.");
        }
        setDone(true);
      })
      .catch((e: Error) => {
        setMsg(e.message || "Sign-in failed.");
        setDone(true);
      });
  }, [redeem]);

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center space-y-4">
      <h1 className="text-xl font-semibold">Honest Money profile</h1>
      <p className="text-sm text-muted-foreground">{msg}</p>
      {done && !window.opener && (
        <Link to="/wallet/settings" className="text-sm underline">
          Back to Settings
        </Link>
      )}
    </main>
  );
}
