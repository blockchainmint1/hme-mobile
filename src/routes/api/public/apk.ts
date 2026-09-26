/**
 * APK download endpoint, driven entirely by the `app_releases` table.
 *
 *   GET /api/public/apk                    → newest android release
 *   GET /api/public/apk?platform=ios       → newest release for another platform
 *   GET /api/public/apk?v=0.1.202609261639 → one specific recorded version
 *
 * Why we stream instead of redirecting (unchanged): the pinned CDN asset comes
 * back as `application/zip` with `Content-Disposition: inline`, so Chrome saves
 * a ".zip" that can't be tapped to install and Android's download manager has
 * nothing it trusts to finish on. We pull the same bytes and override the type
 * and filename to the official Android package MIME type, copying upstream's
 * `Content-Length` verbatim — a known length plus a matching byte count is what
 * makes the download flip to "complete" and offer Install.
 *
 * Why the release lookup lives here: a release recorded once in `app_releases`
 * is served by this URL straight away. Cutting a new build is then "pin the
 * file, record the row" — no website redeploy and no code edit in between, so
 * the update flow can never drift out of sync with what's actually published.
 * If the database is ever unreachable we fall back to the last build baked into
 * this file, so the download link keeps working either way.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Last release baked into this build — used only if the lookup fails. */
const FALLBACK_CID = "QmRjW2Jn1XKa9r6UZrQWRLS6Ax9zpxgdjQyu9Y6iwZvxts";
const FALLBACK_VERSION = "0.1.202609261639";

const IPFS_GATEWAY = "https://txc.mypinata.cloud/ipfs";
const PLATFORMS = new Set(["android", "ios", "web"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Disposition, Accept-Ranges, X-Release-Version",
  "Access-Control-Max-Age": "86400",
} as const;

type ReleaseRow = {
  version: string | null;
  ipfs_cid: string | null;
  download_url: string | null;
};

/** IPFS CIDs are base58btc — tolerate the v0/v1 shapes, reject anything else. */
function isCid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{20,80}$/.test(value);
}

/** Keep the download name safe to put in a header (no quotes, no newlines). */
function safeFilename(value: unknown, version: string | null): string {
  if (typeof value === "string") {
    const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 120);
    if (cleaned) return cleaned;
  }
  if (typeof version === "string") {
    const cleaned = version.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60);
    if (cleaned) return `hme-wallet-${cleaned}-release.apk`;
  }
  return `hme-wallet-${FALLBACK_VERSION}-release.apk`;
}

/** The row's own link, but only when it points at an actual file somewhere. */
function directFileUrl(row: ReleaseRow | null): string | null {
  const raw = row?.download_url;
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  // Never fetch our own endpoint back — that would loop.
  if (/\/api\/public\/apk(\?|$)/i.test(raw)) return null;
  // The gateway URL for the same file is what we'd build anyway.
  if (raw.includes("/ipfs/")) return null;
  return raw;
}

/** Filename the release row asked for, if it carried one in its link. */
function filenameFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const found = new URL(raw).searchParams.get("filename");
    return found && found.trim() ? found.trim() : null;
  } catch {
    return null;
  }
}

function downloadHeaders(filename: string, length: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": `attachment; filename="${filename}"`,
    // No transformation/ranging surprises between us and the phone.
    "Cache-Control": "public, max-age=60",
    "Accept-Ranges": "none",
    ...corsHeaders,
  };
  if (length) h["Content-Length"] = length;
  return h;
}

/** Newest recorded release for a platform, optionally a specific version. */
async function lookupRelease(platform: string, version: string | null): Promise<ReleaseRow | null> {
  try {
    const supabase = createClient<Database>(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    let query = supabase
      .from("app_releases")
      .select("version, ipfs_cid, download_url")
      .eq("platform", platform);
    if (version) query = query.eq("version", version);
    const { data, error } = await query
      .order("released_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as ReleaseRow;
  } catch {
    return null;
  }
}

/** Resolve what to serve: pinned IPFS first, then any direct file, then fallback. */
async function resolveSource(platform: string, version: string | null) {
  const row = await lookupRelease(platform, version);

  if (isCid(row?.ipfs_cid)) {
    return {
      url: `${IPFS_GATEWAY}/${row!.ipfs_cid}?download=true`,
      filename: safeFilename(filenameFromUrl(row!.download_url), row!.version),
      servedVersion: row!.version ?? "unknown",
    };
  }

  const direct = directFileUrl(row);
  if (direct) {
    return {
      url: direct,
      filename: safeFilename(filenameFromUrl(row!.download_url), row!.version),
      servedVersion: row!.version ?? "unknown",
    };
  }

  return {
    url: `${IPFS_GATEWAY}/${FALLBACK_CID}?download=true`,
    filename: safeFilename(null, FALLBACK_VERSION),
    servedVersion: `${FALLBACK_VERSION} (fallback)`,
  };
}

function readParams(request: Request) {
  const url = new URL(request.url);
  const platform = (url.searchParams.get("platform") || "android").toLowerCase();
  const rawVersion = url.searchParams.get("v") || url.searchParams.get("version");
  const version =
    rawVersion && /^[A-Za-z0-9._-]{1,60}$/.test(rawVersion) ? rawVersion : null;
  return { platform, version };
}

export const Route = createFileRoute("/api/public/apk")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      HEAD: async ({ request }) => {
        const { platform, version } = readParams(request);
        const source = await resolveSource(platform, version);
        let length: string | null = null;
        try {
          const res = await fetch(source.url, { method: "HEAD" });
          length = res.headers.get("content-length");
        } catch {
          /* headers still useful without a length */
        }
        const headers = downloadHeaders(source.filename, length);
        headers["X-Release-Version"] = source.servedVersion;
        return new Response(null, { status: 200, headers });
      },

      GET: async ({ request }) => {
        const { platform, version } = readParams(request);
        if (!PLATFORMS.has(platform)) {
          return new Response("invalid platform", {
            status: 400,
            headers: { ...corsHeaders },
          });
        }
        const source = await resolveSource(platform, version);
        const upstream = await fetch(source.url, {
          // Identity encoding keeps upstream's Content-Length byte-accurate.
          headers: { "Accept-Encoding": "identity" },
        });
        if (!upstream.ok || !upstream.body) {
          return new Response("Download unavailable", { status: 502, headers: corsHeaders });
        }
        const headers = downloadHeaders(source.filename, upstream.headers.get("content-length"));
        headers["X-Release-Version"] = source.servedVersion;
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
