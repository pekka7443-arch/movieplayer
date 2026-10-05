// Server-only helper for Finnish content discovery ("Suomalaiset elokuvat &
// sarjat" home row). Two resolution paths, both fully keyless-capable:
//
//  1. TMDB discover (when a key is available) — with_original_language=fi,
//     enriched with IMDB ids via /external_ids so every provider can be tried.
//  2. Curated catalog — a hand-picked list of well-known Finnish films and
//     series, resolved to IMDB/TMDB ids through Cinemeta search (works with
//     zero API keys, cached 24 h).
//
// Never import from client components.

import { cinemetaSearchRaw } from "@/lib/server/cinemeta";
import { tmdbFetch } from "@/lib/server/tmdb";
import type { MetaSearchItem } from "@/lib/meta";

// ---------------------------------------------------------------------------
// Tiny in-memory cache (survives dev hot reloads via globalThis).
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: MetaSearchItem[];
  expiresAt: number;
}

const globalForFinnish = globalThis as unknown as {
  __cinedeckFinnishCache?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> =
  globalForFinnish.__cinedeckFinnishCache ?? new Map<string, CacheEntry>();
globalForFinnish.__cinedeckFinnishCache = cache;

function cacheGet(key: string): MetaSearchItem[] | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  if (entry) cache.delete(key);
  return null;
}

function cacheSet(key: string, value: MetaSearchItem[], ttlMs: number): void {
  if (cache.size > 40) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Curated Finnish catalog — well-known originals, resolved via Cinemeta
// search at runtime (so no fragile hard-coded ids). Order = rough popularity.
// ---------------------------------------------------------------------------

export interface FinnishEntry {
  title: string;
  year: number;
  /** English/international titles IMDb often indexes these under — Cinemeta
   * search returns the PRIMARY (usually English) name, so matching by the
   * Finnish title alone picks the wrong row (a 2009 doc instead of the 2017
   * film, etc.). */
  aka?: string[];
}

export const FINNISH_MOVIES: FinnishEntry[] = [
  { title: "Sisu", year: 2022 },
  { title: "Tuntematon sotilas", year: 2017, aka: ["The Unknown Soldier"] },
  { title: "Mielensäpahoittaja", year: 2014, aka: ["The Grump"] },
  { title: "Napapiirin sankarit", year: 2010, aka: ["Lapland Odyssey"] },
  { title: "Pahat pojat", year: 2003, aka: ["Frozen Land"] },
  { title: "Rukajärven tie", year: 1999, aka: ["Ambush"] },
  { title: "Hytti nro 6", year: 2021, aka: ["Compartment Number 6"] },
  { title: "Joulutarina", year: 2007, aka: ["Christmas Story"] },
  { title: "Niko - Lentäjän poika", year: 2008, aka: ["Niko & The Way to the Stars", "The Flight Before Christmas"] },
  { title: "Risto Räppääjä", year: 2008, aka: ["Ricky Rapper"] },
  { title: "Röllin sydän", year: 2007, aka: ["Heart of a Hawk"] },
  { title: "Sauna", year: 2008, aka: ["Filth"] },
  { title: "Oma maa", year: 2018 },
  { title: "Tottumiskysymys", year: 2019, aka: ["An Unlikely Friendship", "Force of Habit"] },
  { title: "Veljeni vartija", year: 2018, aka: ["My Brother's Keeper"] },
  { title: "Gortex", year: 2024 },
  { title: "Hevi reissu", year: 2018, aka: ["Heavy Trip"] },
  { title: "Tom of Finland", year: 2017 },
  { title: "Äideistä parhain", year: 2005, aka: ["Mother of Mine"] },
  { title: "Rare Exports", year: 2010, aka: ["Rare Exports: A Christmas Tale"] },
  { title: "Big Game", year: 2014 },
  { title: "Iron Sky", year: 2012 },
  { title: "Bodom", year: 2016, aka: ["Lake Bodom"] },
  { title: "Dark Floors", year: 2008 },
  { title: "Häjyt", year: 1999, aka: ["The Tough Ones"] },
  { title: "Kätilö", year: 2015, aka: ["The Midwife"] },
  { title: "Onneli & Anneli", year: 2014 },
  { title: "Tuntematon sotilas", year: 1955, aka: ["The Unknown Soldier"] },
];

export const FINNISH_SERIES: FinnishEntry[] = [
  { title: "Sorjonen", year: 2016, aka: ["Bordertown"] },
  { title: "Karppi", year: 2018, aka: ["Deadwind"] },
  { title: "Salatut elämät", year: 1999, aka: ["Secret Lives"] },
  { title: "Syke", year: 2014 },
  { title: "Roba", year: 2012 },
  { title: "Kaikki synnit", year: 2019, aka: ["All the Sins"] },
  { title: "Ivalo", year: 2018, aka: ["Arctic Circle"] },
  { title: "Nymfit", year: 2013, aka: ["Nymphs"] },
  { title: "Pasila", year: 2007 },
  { title: "Aikuiset", year: 2021 },
  { title: "Kotikatu", year: 1995 },
  { title: "Pulkkinen", year: 2015 },
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Lowercase, collapse punctuation so "Niko – Lentäjän poika" == "niko lentäjän poika". */
function normTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9äöåéèü ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the catalog entry that best matches the curated title (+ aka) + year.
 *
 * IMDb (and therefore Cinemeta) indexes most Finnish films under their
 * ENGLISH primary titles, and several Finnish titles belong to other works
 * (e.g. a 2009 documentary named "Tuntematon sotilas"). So matching needs
 * three layers:
 *   1. name/aka scoring with a HEAVY wrong-year penalty (a same-name hit from
 *      the wrong decade must lose to an aka hit from the right year),
 *   2. aka titles for the well-known English releases,
 *   3. a rank fallback — when no name matches, trust Cinemeta's own relevance
 *      ranking: the top-3 candidates whose year matches the curated entry.
 * Returns null when nothing matches (a gap beats a wrong card).
 */
function pickMatch(
  candidates: MetaSearchItem[],
  title: string,
  year: number,
  aka: string[] | undefined,
): MetaSearchItem | null {
  const queries = [title, ...(aka ?? [])].map(normTitle).filter(Boolean);

  const nameScore = (name: string): number => {
    let best = 0;
    for (const query of queries) {
      let score = 0;
      if (name === query) score = 100;
      else if (name.includes(query) || query.includes(name)) score = 70;
      else {
        const tokens = query.split(" ");
        const overlap = tokens.filter((t) => t.length > 2 && name.includes(t)).length;
        score = overlap * 15;
      }
      if (score > best) best = score;
    }
    return best;
  };

  let best: { item: MetaSearchItem; score: number } | null = null;
  for (const item of candidates) {
    const name = normTitle(item.title);
    if (!name) continue;
    let score = nameScore(name);
    if (score === 0) continue;

    const itemYear = Number.parseInt(item.year ?? "", 10) || 0;
    if (itemYear === year) score += 25;
    else if (itemYear && Math.abs(itemYear - year) === 1) score += 8;
    else if (itemYear && Math.abs(itemYear - year) > 1) score -= 50;

    if (!best || score > best.score) best = { item, score };
  }
  if (best && best.score >= 60) return best.item;

  // Rank fallback — Cinemeta ranks the true match first even under its
  // English name. Accept the highest-ranked candidate from the top 3 whose
  // year matches exactly; rank 1 tolerates a small offset because Cinemeta's
  // releaseInfo for long-running series is the range START ("Aikuiset" =
  // "2019-2022" → year "2019", while the curated entry points at 2021).
  for (let rank = 0; rank < Math.min(3, candidates.length); rank++) {
    const item = candidates[rank];
    const itemYear = Number.parseInt(item.year ?? "", 10) || 0;
    const yearOk =
      itemYear === year ||
      (rank === 0 && itemYear && Math.abs(itemYear - year) <= 2);
    if (itemYear && yearOk) return item;
  }
  return null;
}

/** Run async mappers over a list with bounded concurrency (order preserved). */
async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function dedupeByImdb(items: MetaSearchItem[]): MetaSearchItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.imdbId)) return false;
    seen.add(item.imdbId);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Path 1 — TMDB discover (rich, dynamic; needs a key on the request)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function toStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function toNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

interface DiscoverCard {
  tmdbId: number;
  title: string;
  year: string;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
}

async function discoverFinnishCards(
  mediaType: "movie" | "tv",
  request: Request,
  limit: number,
): Promise<DiscoverCard[]> {
  const path = mediaType === "tv" ? "/discover/tv" : "/discover/movie";
  const data = await tmdbFetch<unknown>(
    path,
    {
      with_original_language: "fi",
      sort_by: "popularity.desc",
      "vote_count.gte": "2",
      include_adult: "false",
      language: "fi-FI",
      page: "1",
    },
    request,
  );

  return asArray(asRecord(data).results)
    .slice(0, limit)
    .map((raw) => {
      const item = asRecord(raw);
      const posterPath = toStr(item.poster_path) || null;
      const backdropPath = toStr(item.backdrop_path) || null;
      const date = toStr(item.release_date) || toStr(item.first_air_date);
      return {
        tmdbId: toNum(item.id),
        title: toStr(item.title) || toStr(item.name) || toStr(item.original_title) || toStr(item.original_name),
        year: date.match(/\d{4}/)?.[0] ?? "",
        posterPath: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null,
        backdropPath: backdropPath ? `https://image.tmdb.org/t/p/w780${backdropPath}` : null,
        voteAverage: toNum(item.vote_average),
      };
    })
    .filter((card) => card.tmdbId > 0 && card.title.length > 0);
}

/**
 * Finnish catalog from TMDB discover, enriched with IMDB ids (external_ids)
 * so the player can scan BOTH id forms for every title. Throws on TMDB
 * failure — callers fall back to the curated Cinemeta path.
 */
export async function finnishTmdb(
  mediaType: "movie" | "tv",
  request: Request,
  limit = 20,
): Promise<MetaSearchItem[]> {
  const cacheKey = `finnish:v2:tmdb:${mediaType}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.slice(0, limit);

  const cards = await discoverFinnishCards(mediaType, request, limit);

  const items = await mapPool<DiscoverCard, MetaSearchItem | null>(
    cards,
    6,
    async (card) => {
      try {
        const ext = await tmdbFetch<unknown>(
          `/${mediaType}/${card.tmdbId}/external_ids`,
          {},
          request,
        );
        const imdbId = toStr(asRecord(ext).imdb_id);
        if (!/^tt\d+$/.test(imdbId)) return null;
        return {
          imdbId,
          title: card.title,
          year: card.year,
          poster: card.posterPath,
          backdrop: card.backdropPath,
          mediaType,
          voteAverage: card.voteAverage,
          tmdbId: card.tmdbId,
        } satisfies MetaSearchItem;
      } catch {
        // external_ids failed — the title is still usable in IMDB-less TMDB
        // watch mode, but MetaSearchItem requires an imdb id, so skip it.
        return null;
      }
    },
  );

  const result = dedupeByImdb(items.filter((x): x is MetaSearchItem => x !== null));
  if (result.length > 0) cacheSet(cacheKey, result, 6 * 60 * 60 * 1000);
  return result.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Path 2 — curated catalog resolved via Cinemeta search (zero keys needed)
// ---------------------------------------------------------------------------

export async function finnishCurated(
  mediaType: "movie" | "tv",
  limit = 20,
): Promise<MetaSearchItem[]> {
  // v2 — busts the pre-aka cache, which had mismatched rows (wrong-year docs
  // picked over the real films).
  const cacheKey = `finnish:v3:curated:${mediaType}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.slice(0, limit);

  const entries = (mediaType === "tv" ? FINNISH_SERIES : FINNISH_MOVIES).slice(
    0,
    Math.max(limit + 4, 24),
  );

  const resolved = await mapPool<FinnishEntry, MetaSearchItem | null>(
    entries,
    6,
    async (entry) => {
      try {
        const candidates = await cinemetaSearchRaw(mediaType, entry.title, 25);
        return pickMatch(candidates, entry.title, entry.year, entry.aka);
      } catch {
        return null;
      }
    },
  );

  const result = dedupeByImdb(resolved.filter((x): x is MetaSearchItem => x !== null));
  // A partially-empty resolve (e.g. Cinemeta blip) must not be cached for a
  // full day — only cache when we got a decent haul.
  if (result.length >= Math.min(6, entries.length / 3)) {
    cacheSet(cacheKey, result, 24 * 60 * 60 * 1000);
  }
  return result.slice(0, limit);
}
