export type ProviderId =
  // Confirmed-working cluster (user-tested in browser + server-reachable):
  // .cc / .skin / .sh domains are the ones that actually play video.
  | 'twoembed_cc'
  | 'twoembed_skin'
  | 'vidsrc_sh'
  | 'vidsrc_cc'
  // VidSrc.su — same embed family as .sh, live player shell (2026-10 probe).
  | 'vidsrc_su'
  // Modern player — server-reachable, built-in subtitle/audio language
  // selector, accepts a `language` param to preselect audio/subtitle locale.
  // Probes OK but the user hit a black screen on it — manual/last-resort only.
  | 'videasy';

/**
 * How much we trust a source to actually PLAY (a 200 health probe is not
 * proof — some players load as a black screen):
 *
 *  - 'proven'     — user-confirmed playback (.cc / .skin / .sh cluster).
 *                   Auto-pick ONLY lands here while any of these is online.
 *  - 'maybe'      — alive, same trusted family or browser-only playable
 *                   (Cloudflare-gated .cc). Tried after the proven pool.
 *  - 'lastresort' — loads but reported broken/black by the user (Videasy).
 *                   Manual pick or literally-last candidate.
 */
export type Reliability = 'proven' | 'maybe' | 'lastresort';

const RELIABILITY_ORDER: Record<Reliability, number> = {
  proven: 0,
  maybe: 1,
  lastresort: 2,
};

export function reliabilityOf(providerId: string): Reliability {
  return getProvider(providerId).reliability;
}

/** Numeric rank for sorting candidates (lower = more trustworthy). */
export function reliabilityRank(providerId: string): number {
  return RELIABILITY_ORDER[reliabilityOf(providerId)];
}

/** True when this provider is user-proven to play — auto-pick eligible. */
export function isProven(providerId: string): boolean {
  return reliabilityOf(providerId) === 'proven';
}

/**
 * Provider grouping for the player UI — keeps the server list scannable.
 * Order matches the cluster order in PROVIDERS below.
 */
export const PROVIDER_GROUPS: { id: string; label: string }[] = [
  { id: 'twoembed', label: '2Embed' },
  { id: 'vidsrc', label: 'VidSrc' },
  { id: 'other', label: 'Extra' },
];

export interface Provider {
  id: ProviderId;
  name: string;
  /** Short label used in the cluster chip (e.g. ".cc", ".skin"). */
  short: string;
  /** Cluster this provider belongs to ('twoembed' | 'vidsrc' | 'other'). */
  group: 'twoembed' | 'vidsrc' | 'other';
  /** Playback trust tier — drives auto-pick + failover order (see above). */
  reliability: Reliability;
  /**
   * Query parameter name this provider uses to request a DUBBED audio track
   * (e.g. "language" → &language=fi). Null/undefined = no dub support — the
   * player's own audio menu is the only way to switch languages there.
   */
  dubParam?: string | null;
  movie: (id: number) => string;
  tv: (id: number, season: number, episode: number) => string;
  /** IMDB-id variants (e.g. "tt1375666") — used by the keyless IMDB watch mode. */
  movieImdb: (imdbId: string) => string;
  tvImdb: (imdbId: string, season: number, episode: number) => string;
}

// ---------------------------------------------------------------------------
// All providers below share the SAME URL shape as their canonical originals:
//   2Embed  : /embed/{tmdb}                /embedtv/{tmdb}&s={s}&e={e}
//   VidSrc.sh: /embed/movie/{id}           /embed/tv/{id}/{s}/{e}
//   VidSrc.cc: /embed/movie/{id}           /embed/tv/{id}/{s}/{e}  (Cloudflare-protected mirror —
//              the server probe sees a 403 challenge but real browsers load it fine,
//              so the scan reports it as "unknown" and the player still tries it)
//   VidSrc.su:/embed/movie/{id}            /embed/tv/{id}/{s}/{e}  (same family as .sh)
//   Videasy : /movie/{id}                  /tv/{id}/{s}/{e}   (player.videasy.to)
//
// Dead domains measured and removed (2026-10): 2embed.to/.org/.live/.pro/.net,
// vidsrc.to/.xyz/.vip/.in/.nl, vidlink.org, embed.su, vidjoy.pro (parked),
// superembed/multiembed.mov (hard CF wall), spencerdevs.xyz (site, not embed API).
// ---------------------------------------------------------------------------

const twoEmbedMovie = (base: string) => (id: number | string) => `${base}/embed/${id}`;
const twoEmbedMovieImdb = (base: string) => (imdbId: string) => `${base}/embed/${imdbId}`;
const twoEmbedTv = (base: string) => (id: number, s: number, e: number) => `${base}/embedtv/${id}&s=${s}&e=${e}`;
const twoEmbedTvImdb = (base: string) => (imdbId: string, s: number, e: number) => `${base}/embedtv/${imdbId}&s=${s}&e=${e}`;

const vidsrcMovie = (base: string) => (id: number | string) => `${base}/embed/movie/${id}`;
// VidSrc embeds accept both TMDB and IMDB ids in the same path shape.
const vidsrcTv = (base: string) => (id: number | string, s: number, e: number) => `${base}/embed/tv/${id}/${s}/${e}`;

export const PROVIDERS: Provider[] = [
  // ----- 2Embed cluster — the user's most reliable source -----
  {
    id: 'twoembed_cc',
    name: '2Embed.cc',
    short: '.cc',
    group: 'twoembed',
    reliability: 'proven',
    movie: twoEmbedMovie('https://www.2embed.cc'),
    tv: twoEmbedTv('https://www.2embed.cc'),
    movieImdb: twoEmbedMovieImdb('https://www.2embed.cc'),
    tvImdb: twoEmbedTvImdb('https://www.2embed.cc'),
  },
  {
    id: 'twoembed_skin',
    name: '2Embed.skin',
    short: '.skin',
    group: 'twoembed',
    reliability: 'proven',
    movie: twoEmbedMovie('https://2embed.skin'),
    tv: twoEmbedTv('https://2embed.skin'),
    movieImdb: twoEmbedMovieImdb('https://2embed.skin'),
    tvImdb: twoEmbedTvImdb('https://2embed.skin'),
  },

  // ----- VidSrc cluster -----
  {
    id: 'vidsrc_sh',
    name: 'VidSrc.sh',
    short: '.sh',
    group: 'vidsrc',
    reliability: 'proven',
    movie: vidsrcMovie('https://vidsrc.sh'),
    tv: vidsrcTv('https://vidsrc.sh'),
    movieImdb: vidsrcMovie('https://vidsrc.sh'),
    tvImdb: vidsrcTv('https://vidsrc.sh'),
  },
  {
    id: 'vidsrc_cc',
    name: 'VidSrc.cc',
    short: '.cc',
    group: 'vidsrc',
    // Cloudflare-protected mirror — the server probe sees a 403 challenge but
    // real browsers load it fine, so the scan reports "unknown" and the player
    // still tries it after the proven pool.
    reliability: 'maybe',
    movie: vidsrcMovie('https://vidsrc.cc'),
    tv: vidsrcTv('https://vidsrc.cc'),
    movieImdb: vidsrcMovie('https://vidsrc.cc'),
    tvImdb: vidsrcTv('https://vidsrc.cc'),
  },
  {
    id: 'vidsrc_su',
    name: 'VidSrc.su',
    short: '.su',
    group: 'vidsrc',
    // Same embed family as VidSrc.sh — live player shell confirmed by probe,
    // actual playback unverified → tried after the proven trio.
    reliability: 'maybe',
    movie: vidsrcMovie('https://vidsrc.su'),
    tv: vidsrcTv('https://vidsrc.su'),
    movieImdb: vidsrcMovie('https://vidsrc.su'),
    tvImdb: vidsrcTv('https://vidsrc.su'),
  },

  // ----- Extra (modern alternative player) -----
  {
    id: 'videasy',
    name: 'Videasy',
    short: 'VDS',
    group: 'other',
    // Probes healthy but the user got a black screen on it — never auto-picked
    // while a proven/maybe source is online; reachable via the dub hint chip.
    reliability: 'lastresort',
    // Videasy's player accepts a language locale and has a built-in
    // subtitle/audio language selector — best-effort dub support.
    dubParam: 'language',
    movie: (id) => `https://player.videasy.to/movie/${id}`,
    tv: (id, s, e) => `https://player.videasy.to/tv/${id}/${s}/${e}`,
    movieImdb: (imdb) => `https://player.videasy.to/movie/imdb/${imdb}`,
    tvImdb: (imdb, s, e) => `https://player.videasy.to/tv/imdb/${imdb}/${s}/${e}`,
  },
];

/**
 * Default provider — 2Embed.cc. The user confirmed 2embed is the most reliable
 * source across their tested titles, so we lead with it. The auto-scan +
 * auto-failover watchdog will silently move on if this specific mirror stalls.
 */
export const DEFAULT_PROVIDER: ProviderId = 'twoembed_cc';

/**
 * The providers auto-pick is allowed to land on while they are online —
 * the user-verified .cc / .skin / .sh cluster. Unproven sources stay one
 * manual tap away but never steal the first autoplay.
 */
export const AUTO_PICK_PROVIDERS: ProviderId[] = PROVIDERS.filter(
  (p) => p.reliability === 'proven',
).map((p) => p.id);

export function getProvider(providerId: string): Provider {
  return PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0];
}

/** IMDB ids look like "tt1375666". */
export function isImdbId(value: number | string): value is string {
  return typeof value === 'string' && /^tt\d+$/.test(value);
}

/**
 * Build the embed URL for either a TMDB id (number) or an IMDB id (string).
 * Falls back to the TMDB variant when no IMDB function exists.
 *
 * `dubLang` — optional 2-letter language code (e.g. "fi"). When set and the
 * provider supports dubbing (dubParam), the code is appended so the provider
 * player starts with that dubbed audio/subtitle track preselected.
 */
export function getEmbedUrl(
  providerId: string,
  mediaType: 'movie' | 'tv',
  tmdbOrImdbId: number | string,
  season?: number,
  episode?: number,
  dubLang?: string | null
): string {
  const provider = getProvider(providerId);
  const s = season && season >= 1 ? season : 1;
  const e = episode && episode >= 1 ? episode : 1;

  const build = (url: string): string =>
    dubLang && provider.dubParam
      ? `${url}${url.includes('?') ? '&' : '?'}${provider.dubParam}=${encodeURIComponent(dubLang)}`
      : url;

  if (isImdbId(tmdbOrImdbId)) {
    return build(
      mediaType === 'tv'
        ? provider.tvImdb(tmdbOrImdbId, s, e)
        : provider.movieImdb(tmdbOrImdbId),
    );
  }

  return build(
    mediaType === 'tv' ? provider.tv(tmdbOrImdbId, s, e) : provider.movie(tmdbOrImdbId),
  );
}

/** True when this provider can request a dubbed audio track via URL. */
export function supportsDub(providerId: string): boolean {
  return Boolean(getProvider(providerId).dubParam);
}

/**
 * Normalize a dub preference to the 2-letter code embed providers expect
 * ("fi-FI" → "fi", "fi" → "fi"). Returns null for 'original'/empty input.
 */
export function dubCodeOf(pref: string | null | undefined): string | null {
  if (!pref || pref === 'original') return null;
  const code = pref.split('-')[0].toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}
