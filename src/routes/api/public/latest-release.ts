/**
 * Stable, key-free release feed.
 *
 * Installed apps must be able to ask "what's the newest build?" without
 * depending on a baked-in API key or SDK version. This endpoint is public,
 * CORS-open and lives at a fixed path so every build — past or future — can
 * point at the same URL forever.
 *
 *   GET /api/public/latest-release?platform=android
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const PLATFORMS = new Set(["android", "ios", "web"]);

export const Route = createFileRoute("/api/public/latest-release")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const platform = (url.searchParams.get("platform") || "android").toLowerCase();
        if (!PLATFORMS.has(platform)) {
          return new Response(JSON.stringify({ error: "invalid platform" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const supabase = createClient<Database>(
          process.env["SUPABASE_URL"]!,
          process.env["SUPABASE_PUBLISHABLE_KEY"]!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const { data, error } = await supabase
          .from("app_releases")
          .select("platform, version, ipfs_cid, download_url, notes, mandatory, released_at")
          .eq("platform", platform)
          .order("released_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          return new Response(JSON.stringify({ error: "lookup failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        return new Response(JSON.stringify({ release: data ?? null }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
            ...corsHeaders,
          },
        });
      },
    },
  },
});
