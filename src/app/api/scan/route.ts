import { createHash } from "node:crypto";
import { PROVIDERS, getEmbedUrl, supportsDub } from "@/lib/providers";
import type { ScanResult } from "@/lib/meta";
import { getFinnishDubProviders } from "@/lib/server/finnish-providers";
import { withApi, apiError } from "@/lib/server/api";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { requireAuthedUser } from "@/lib/server/auth";
import { db } from "@/lib/db";

// GET /api/scan?type=movie|tv&imdb=tt1375666  (or &tmdb=123, or BOTH)
//              &s=1&e=1  [&dub=fi]
//
// Probes every provider's embed URL server-side and reports which sources
// respond with a playable page. The player uses this to auto-pick a healthy
// source ("scan all sites and play"). Results are cached briefly per URL so
// episode switches don't re-hit every provider.
//
// When BOTH an IMDB and a TMDB id are supplied, every provider is probed
// under BOTH id forms (primary = IMDB first). Rare titles — Finnish films,
// Nordic series, older gems — are frequently indexed under only one of the
// two, which is exactly why "some players can't find them". When the
// alternate form is the one that answers, the row carries `url` and the
// player loads that exact URL.
//
// When &dub=XX is set, dub-capable providers (Videasy) are probed
// with the dub parameter appended — so the health ranking reflects exactly
// the URL the player will load — and those rows carry lang=XX.
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 7_000;
const CACHE_TTL_MS = 60_000;

// Finnish-audio confirmation probe — short on purpose: it runs inside the
// scan for every source that CLAIMS Finnish audio, and a slow/absent answer
// just means "not confirmed", never a scan failure.
const FI_PROBE_TIMEOUT_MS = 500;
const FI_CACHE_TTL_MS = 60 * 60 * 1000;

interface ProbeOutcome {
  ok: boolean;
  status: number | null;
  ms: number;
}

interface CacheEntry {
  value: ScanResult[];
  expiresAt: number;
}
const globalForScan = globalThis as unknown as {
  __cinedeckScanCache?: Map<string, CacheEntry>;
};
const scanCache: Map<string, CacheEntry> =
  globalForScan.__cinedeckScanCache ?? new Map<string, CacheEntry>();
globalForScan.__cinedeckScanCache = scanCache;

// fi-confirmed:<sha1(sourceUrl)> → did this stream REALLY carry Finnish audio.
// Separate from scanCache (different value type + 1h TTL) but the same
// globalThis pattern so dev hot-reloads and route instances share it.
interface FiCacheEntry {
  value: boolean;
  expiresAt: number;
}
const globalForFi = globalThis as unknown as {
  __cinedeckFiConfirmCache?: Map<string, FiCacheEntry>;
};
const fiCache: Map<string, FiCacheEntry> =
  globalForFi.__cinedeckFiConfirmCache ?? new Map<string, FiCacheEntry>();
globalForFi.__cinedeckFiConfirmCache = fiCache;

function fiCacheKey(sourceUrl: string): string {
  return `fi-confirmed:${createHash("sha1").update(sourceUrl).digest("hex")}`;
}

/**
 * HLS audio-rendition tag with a Finnish language attribute — attribute order
 * varies between packagers, so both attributes are lookahead-matched.
 */
const FI_HLS_AUDIO_RE =
  /#EXT-X-MEDIA:(?=[^\n\r]*TYPE=AUDIO)(?=[^\n\r]*LANG(?:UAGE)?="(?:fi|fin)(?:[-_"]|$))/i;

/**
 * REAL Finnish-audio validation for one source URL (spec 3a–3e):
 *  - fetch the first 2 KB of the manifest/page with a 500 ms abort deadline;
 *  - HLS: #EXT-X-MEDIA TYPE=AUDIO with LANGUAGE="fi|fin" in the manifest text;
 *  - direct streams: content-language response header includes "fi";
 *  - timeout / failure / no match → NOT confirmed (honest absence).
 * Result cached under "fi-confirmed:<sha1(url)>" for 1 hour.
 */
async function validateFinnishAudio(sourceUrl: string): Promise<boolean> {
  const key = fiCacheKey(sourceUrl);
  const cached = fiCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let confirmed = false;
  try {
    const res = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "*/*",
      },
      signal: AbortSignal.timeout(FI_PROBE_TIMEOUT_MS),
      cache: "no-store",
    });

    // (c) direct streams advertise the audio language on the response itself.
    const contentLanguage = (res.headers.get("content-language") ?? "").toLowerCase();
    const headerHit = contentLanguage
      .split(",")
      .some((tag) => tag.trim() === "fi" || tag.trim().startsWith("fi-"));

    // (a/b) read at most the first 2 KB and look for a Finnish AUDIO rendition.
    let manifestHit = false;
    if (res.ok && res.body) {
      try {
        const reader = res.body.getReader();
        const { value } = await reader.read();
        reader.cancel().catch(() => undefined);
        const head = new TextDecoder()
          .decode(value ?? new Uint8Array())
          .slice(0, 2048);
        manifestHit = FI_HLS_AUDIO_RE.test(head);
      } catch {
        // body peek failed — the header check above still stands
      }
    }

    confirmed = headerHit || manifestHit;
  } catch {
    confirmed = false; // timeout / network error → not confirmed
  }

  if (fiCache.size > 500) fiCache.clear();
  fiCache.set(key, { value: confirmed, expiresAt: Date.now() + FI_CACHE_TTL_MS });
  return confirmed;
}

// Heuristics for "this is an error page, not a player".
const ERROR_BODY_PATTERNS = [
  /cannot get/i,
  /page not found/i,
  /404 not found/,
  /movie not found/i,
  /video not found/i,
  /title not found/i,
  /nothing found/i,
  /<title>error/i,
];

async function probeEmbed(url: string): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    const ms = Date.now() - started;

    // Read only the first slice — enough to detect obvious error pages.
    let ok = res.ok;
    if (ok) {
      try {
        const reader = res.body?.getReader();
        if (reader) {
          const { value } = await reader.read();
          reader.cancel().catch(() => undefined);
          const head = new TextDecoder()
            .decode(value ?? new Uint8Array())
            .slice(0, 3000);
          if (ERROR_BODY_PATTERNS.some((p) => p.test(head))) ok = false;
        }
      } catch {
        // Body peek failed — trust the status code.
      }
    }
    return { ok, status: res.status, ms };
  } catch {
    return { ok: false, status: null, ms: Date.now() - started };
  }
}

/**
 * A probe can in theory outlive its AbortSignal (hang on body read etc.).
 * Race it against a hard deadline so the whole scan always answers in
 * bounded time — a stuck scan was reported to hang the player for minutes.
 */
function withDeadline(p: Promise<ProbeOutcome>, ms: number): Promise<ProbeOutcome> {
  return Promise.race([
    p,
    new Promise<ProbeOutcome>((resolve) =>
      setTimeout(() => resolve({ ok: false, status: null, ms }), ms),
    ),
  ]);
}

export const GET = withApi('scan', async (request) => {
  // PHASE 2: stream-source scans expose playback URLs → accounts only.
  const authed = await requireAuthedUser(request);
  if (!authed) return apiError(401, 'unauthorized');

  const limited = enforceRateLimit(request, 'scan');
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "tv" ? "tv" : "movie";
  const imdbRaw = (searchParams.get("imdb") ?? "").trim();
  const tmdbRaw = (searchParams.get("tmdb") ?? "").trim();
  const season = Number.parseInt(searchParams.get("s") ?? "1", 10) || 1;
  const episode = Number.parseInt(searchParams.get("e") ?? "1", 10) || 1;
  const dubRaw = (searchParams.get("dub") ?? "").trim().toLowerCase();
  const dub = /^[a-z]{2}$/.test(dubRaw) ? dubRaw : null;

  const imdbId = /^tt\d+$/.test(imdbRaw) ? imdbRaw : null;
  const tmdbId = /^\d+$/.test(tmdbRaw) ? Number(tmdbRaw) : null;

  if (!imdbId && !tmdbId) {
    return apiError(400, 'bad_id');
  }

  const cacheKey = `${type}:${imdbId ?? "-"}:${tmdbId ?? "-"}:${season}:${episode}:${dub ?? "orig"}`;
  const cached = scanCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ results: cached.value, cached: true });
  }

  const tvParams = type === "tv" ? [season, episode] as const : null;
  const deadlineMs = PROBE_TIMEOUT_MS + 1_500;

  const probes = await Promise.all(
    PROVIDERS.map(async (provider): Promise<ScanResult> => {
      const build = (id: number | string) =>
        getEmbedUrl(
          provider.id,
          type,
          id,
          tvParams ? tvParams[0] : undefined,
          tvParams ? tvParams[1] : undefined,
          dub,
        );

      // Primary = IMDB form when known (every provider is IMDB-native);
      // alternate = TMDB form, probed only when both ids exist.
      const primaryId: number | string = imdbId ?? (tmdbId as number);
      const primaryUrl = build(primaryId);
      const altUrl = imdbId && tmdbId ? build(tmdbId) : null;

      const primaryP = withDeadline(probeEmbed(primaryUrl), deadlineMs);
      const altP = altUrl ? withDeadline(probeEmbed(altUrl), deadlineMs) : null;

      const primary = await primaryP;
      if (primary.ok) {
        // The alternate probe keeps running in the background — discard it.
        if (altP) void altP.catch(() => undefined);
        return {
          providerId: provider.id,
          name: provider.name,
          ...primary,
          url: primaryUrl,
          lang: dub && supportsDub(provider.id) ? dub : null,
          finnishAudioConfirmed: false,
        };
      }

      // Primary form is dead for this title — the alternate may still exist.
      const alt = altP ? await altP : null;
      if (altUrl && alt?.ok) {
        return {
          providerId: provider.id,
          name: provider.name,
          ...alt,
          url: altUrl,
          lang: dub && supportsDub(provider.id) ? dub : null,
          finnishAudioConfirmed: false,
        };
      }

      // Neither form confirmed a player — report the primary probe result.
      return {
        providerId: provider.id,
        name: provider.name,
        ...primary,
        url: primaryUrl,
        lang: dub && supportsDub(provider.id) ? dub : null,
        finnishAudioConfirmed: false,
      };
    }),
  );

  // Finnish-audio confirmation (spec 3d/3e): a source is confirmed when the
  // admin allowlist vouches for its provider, OR it claims Finnish audio
  // (lang tag fi/fin) and the manifest/content-language probe really finds
  // one. Everything else stays honestly unconfirmed.
  const fiAllowlist = await getFinnishDubProviders();
  const results: ScanResult[] = await Promise.all(
    probes.map(async (row) => {
      const allowlisted = fiAllowlist.includes(row.providerId);
      const claimsFinnish = row.lang === "fi" || row.lang === "fin";
      if (!allowlisted && !(claimsFinnish && row.url)) {
        return row; // already finnishAudioConfirmed: false
      }
      const confirmed = allowlisted
        ? true
        : row.ok
          ? await validateFinnishAudio(row.url as string)
          : false;
      return confirmed ? { ...row, finnishAudioConfirmed: true } : row;
    }),
  );

  if (scanCache.size > 200) scanCache.clear();
  scanCache.set(cacheKey, { value: results, expiresAt: Date.now() + CACHE_TTL_MS });

  // Rolling provider health for the admin dashboard — best-effort writes.
  void Promise.all(
    results.map((row) =>
      db.providerStat
        .upsert({
          where: { id: row.providerId },
          create: {
            id: row.providerId,
            okCount: row.ok ? 1 : 0,
            failCount: row.ok ? 0 : 1,
            lastOkAt: row.ok ? new Date() : null,
            lastFailAt: row.ok ? null : new Date(),
          },
          update: {
            okCount: { increment: row.ok ? 1 : 0 },
            failCount: { increment: row.ok ? 0 : 1 },
            lastOkAt: row.ok ? new Date() : undefined,
            lastFailAt: row.ok ? undefined : new Date(),
          },
        })
        .catch(() => undefined),
    ),
  );

  return Response.json({ results });
});
