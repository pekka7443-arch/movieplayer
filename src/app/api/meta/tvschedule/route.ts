import { withApi } from '@/lib/server/api';
import { jsonError } from '@/lib/server/http';
import { withCache } from '@/lib/server/cache';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/meta/tvschedule?date=YYYY-MM-DD
// "Tänään TV:ssä" — Finnish linear TV schedule for tonight, sourced from
// TVmaze's country schedule (Yle TV1/Yle TV2/MTV3/Nelonen and friends).
// Cached 30 min with a 3h stale window (fail-soft if TVmaze blips).
// ---------------------------------------------------------------------------

interface TvmazeEpisode {
  airtime: string | null;
  airstamp: string | null;
  season: number | null;
  number: number | null;
  name: string | null;
  show: {
    id: number;
    name: string;
    network: { name: string } | null;
    webChannel: { name: string } | null;
    image: { medium: string | null; original: string | null } | null;
    imdb: string | null;
    genres: string[];
  };
}

export interface TvScheduleEntry {
  /** "20:00" — TVmaze airtime is local to the broadcast country. */
  time: string;
  showName: string;
  episodeName: string | null;
  network: string;
  season: number | null;
  episode: number | null;
  image: string | null;
  imdbId: string | null;
  genre: string | null;
}

/** Today's date (YYYY-MM-DD) in Europe/Helsinki — the TV guide's timezone. */
function helsinkiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function fetchSchedule(date: string): Promise<TvScheduleEntry[]> {
  const res = await fetch(
    `https://api.tvmaze.com/schedule?country=FI&date=${encodeURIComponent(date)}`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`tvmaze_schedule_${res.status}`);
  const data = (await res.json()) as TvmazeEpisode[];
  return data
    .map((entry): TvScheduleEntry => {
      const network = entry.show.network?.name ?? entry.show.webChannel?.name ?? 'Other';
      return {
        time: entry.airtime ?? (entry.airstamp ? entry.airstamp.slice(11, 16) : '--:--'),
        showName: entry.show.name,
        episodeName: entry.name || null,
        network,
        season: entry.season,
        episode: entry.number,
        image: entry.show.image?.medium ?? entry.show.image?.original ?? null,
        imdbId: entry.show.imdb,
        genre: entry.show.genres?.[0] ?? null,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

export const GET = withApi('tvschedule', async (request) => {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('date');
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return jsonError('bad_request', 400, 'date must be YYYY-MM-DD');
  }
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : helsinkiToday();

  const entries = await withCache(`tvschedule:fi:${date}`, () => fetchSchedule(date), {
    ttlMs: 30 * 60_000,
    staleMs: 3 * 60 * 60_000,
  });

  return new Response(JSON.stringify({ date, entries }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, s-maxage=1800, stale-while-revalidate=10800',
    },
  });
});
