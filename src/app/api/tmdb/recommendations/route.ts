import { db } from '@/lib/db';
import { resolveOwner } from '@/lib/server/auth';
import { withApi } from '@/lib/server/api';
import { extractResults, languageParam, normalizeMediaCardList, tmdbFetch } from '@/lib/server/tmdb';

export const dynamic = 'force-dynamic';

// GET /api/tmdb/recommendations?language=
// "Top picks for you" — built from the caller's watch history: the last few
// distinct titles feed TMDB /recommendations, merged and deduped. Requires a
// TMDB key (users add their own in Settings); keyless callers get an empty
// list so the row simply hides.
export const GET = withApi('tmdb/recommendations', async (request) => {
  const language = languageParam(new URL(request.url).searchParams);
  const owner = await resolveOwner(request);
  if (!owner.userId) return Response.json({ results: [], becauseOf: null });

  const rows = await db.watchHistory.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { updatedAt: 'desc' },
    take: 12,
  });
  if (rows.length === 0) return Response.json({ results: [], becauseOf: null });

  // Distinct by [tmdbId, mediaType], most recent first, top 3 seeds.
  const seen = new Set<string>();
  const seeds = rows
    .filter((r) => {
      const key = `${r.tmdbId}:${r.mediaType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);

  const buckets = await Promise.all(
    seeds.map(async (seed) => {
      try {
        const path =
          seed.mediaType === 'tv'
            ? `/tv/${seed.tmdbId}/recommendations`
            : `/movie/${seed.tmdbId}/recommendations`;
        const data = await tmdbFetch(path, { language }, request);
        return normalizeMediaCardList(extractResults(data), 12);
      } catch {
        return [];
      }
    }),
  );

  // Round-robin merge so every seed contributes, deduped, seeded titles excluded.
  const seedIds = new Set(seeds.map((s) => `${s.tmdbId}:${s.mediaType}`));
  const out: ReturnType<typeof normalizeMediaCardList> = [];
  const used = new Set<number>();
  for (let i = 0; out.length < 14; i = (i + 1) % Math.max(buckets.length, 1)) {
    if (buckets.every((b) => b.length === 0)) break;
    const bucket = buckets[i] ?? [];
    const next = bucket.shift();
    if (!next) continue;
    if (used.has(next.id) || seedIds.has(`${next.id}:${next.mediaType}`)) continue;
    used.add(next.id);
    out.push(next);
  }

  return Response.json({
    results: out,
    becauseOf: seeds[0]?.title ?? null,
  });
});
