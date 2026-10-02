export type ProviderId =
  // 2Embed cluster (user-confirmed working — listed first as fallback chain)
  | 'twoembed_cc'
  | 'twoembed_skin'
  | 'twoembed_to'
  | 'twoembed_org'
  | 'twoembed_live'
  | 'twoembed_pro'
  | 'twoembed_net'
  // VidSrc cluster
  | 'vidsrc'
  | 'vidsrc_sh'
  | 'vidsrc_cc'
  | 'vidsrcxyz'
  | 'vidsrcvip'
  // Other public providers (kept as last-resort alternates)
  | 'superembed'
  | 'embedsu';

/**
 * Provider grouping for the player UI — keeps the long server list scannable.
 * Order matches the cluster order in PROVIDERS below.
 */
export const PROVIDER_GROUPS: { id: string; label: string }[] = [
  { id: 'twoembed', label: '2Embed' },
  { id: 'vidsrc', label: 'VidSrc' },
  { id: 'other', label: 'Other' },
];

export interface Provider {
  id: ProviderId;
  name: string;
  /** Short label used in the cluster chip (e.g. ".cc", ".skin"). */
  short: string;
  /** Cluster this provider belongs to ('twoembed' | 'vidsrc' | 'other'). */
  group: 'twoembed' | 'vidsrc' | 'other';
  /**
   * Query parameter name this provider uses to request a DUBBED audio track
   * (e.g. "ds_lang" → &ds_lang=fi). Null/undefined = no dub support — the
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
//   2Embed IMDB : /embed/{imdbId}          /embedtv/{imdbId}&s={s}&e={e}
//   VidSrc.to: /embed/movie/{id}           /embed/tv/{id}/{s}/{e}
//   VidSrc.sh: /embed/movie/{id}           /embed/tv/{id}/{s}/{e}  (mirror of VidSrc)
//   VidSrc.cc: /embed/movie/{id}           /embed/tv/{id}/{s}/{e}  (Cloudflare-protected mirror)
//   VidSrc.xyz: /embed/movie?tmdb={id}    /embed/tv?tmdb={id}&season={s}&episode={e}
//   SuperEmbed: /{id}                       /{id}?s={s}&e={e}
//   EmbedSU: /embed/movie/{id}             /embed/tv/{id}/{s}/{e}
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
    movie: twoEmbedMovie('https://2embed.skin'),
    tv: twoEmbedTv('https://2embed.skin'),
    movieImdb: twoEmbedMovieImdb('https://2embed.skin'),
    tvImdb: twoEmbedTvImdb('https://2embed.skin'),
  },
  {
    id: 'twoembed_to',
    name: '2Embed.to',
    short: '.to',
    group: 'twoembed',
    movie: twoEmbedMovie('https://www.2embed.to'),
    tv: twoEmbedTv('https://www.2embed.to'),
    movieImdb: twoEmbedMovieImdb('https://www.2embed.to'),
    tvImdb: twoEmbedTvImdb('https://www.2embed.to'),
  },
  {
    id: 'twoembed_org',
    name: '2Embed.org',
    short: '.org',
    group: 'twoembed',
    movie: twoEmbedMovie('https://www.2embed.org'),
    tv: twoEmbedTv('https://www.2embed.org'),
    movieImdb: twoEmbedMovieImdb('https://www.2embed.org'),
    tvImdb: twoEmbedTvImdb('https://www.2embed.org'),
  },
  {
    id: 'twoembed_live',
    name: '2Embed.live',
    short: '.live',
    group: 'twoembed',
    movie: twoEmbedMovie('https://www.2embed.live'),
    tv: twoEmbedTv('https://www.2embed.live'),
    movieImdb: twoEmbedMovieImdb('https://www.2embed.live'),
    tvImdb: twoEmbedTvImdb('https://www.2embed.live'),
  },
  {
    id: 'twoembed_pro',
    name: '2Embed.pro',
    short: '.pro',
    group: 'twoembed',
    movie: twoEmbedMovie('https://www.2embed.pro'),
    tv: twoEmbedTv('https://www.2embed.pro'),
    movieImdb: twoEmbedMovieImdb('https://www.2embed.pro'),
    tvImdb: twoEmbedTvImdb('https://www.2embed.pro'),
  },
  {
    id: 'twoembed_net',
    name: '2Embed.net',
    short: '.net',
    group: 'twoembed',
    movie: twoEmbedMovie('https://www.2embed.net'),
    tv: twoEmbedTv('https://www.2embed.net'),
    movieImdb: twoEmbedMovieImdb('https://www.2embed.net'),
    tvImdb: twoEmbedTvImdb('https://www.2embed.net'),
  },

  // ----- VidSrc cluster -----
  {
    id: 'vidsrc',
    name: 'VidSrc.to',
    short: '.to',
    group: 'vidsrc',
    movie: vidsrcMovie('https://vidsrc.to'),
    tv: vidsrcTv('https://vidsrc.to'),
    movieImdb: vidsrcMovie('https://vidsrc.to'),
    tvImdb: vidsrcTv('https://vidsrc.to'),
  },
  {
    id: 'vidsrc_sh',
    name: 'VidSrc.sh',
    short: '.sh',
    group: 'vidsrc',
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
    movie: vidsrcMovie('https://vidsrc.cc'),
    tv: vidsrcTv('https://vidsrc.cc'),
    movieImdb: vidsrcMovie('https://vidsrc.cc'),
    tvImdb: vidsrcTv('https://vidsrc.cc'),
  },
  {
    id: 'vidsrcxyz',
    name: 'VidSrc XYZ',
    short: 'xyz',
    group: 'vidsrc',
    // ds_lang = default (dub) audio language, documented by vidsrc.xyz.
    dubParam: 'ds_lang',
    movie: (id) => `https://vidsrc.xyz/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
    movieImdb: (imdb) => `https://vidsrc.xyz/embed/movie?imdb=${imdb}`,
    tvImdb: (imdb, s, e) => `https://vidsrc.xyz/embed/tv?imdb=${imdb}&season=${s}&episode=${e}`,
  },
  {
    id: 'vidsrcvip',
    name: 'VidSrc VIP',
    short: 'vip',
    group: 'vidsrc',
    // Same embed API family as VidSrc XYZ (same query shape + ds_lang dub).
    dubParam: 'ds_lang',
    movie: (id) => `https://vidsrc.vip/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidsrc.vip/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
    movieImdb: (imdb) => `https://vidsrc.vip/embed/movie?imdb=${imdb}`,
    tvImdb: (imdb, s, e) => `https://vidsrc.vip/embed/tv?imdb=${imdb}&season=${s}&episode=${e}`,
  },

  // ----- Other public providers (kept as last-resort alternates) -----
  {
    id: 'superembed',
    name: 'SuperEmbed',
    short: 'SE',
    group: 'other',
    movie: (id) => `https://superembed.cc/${id}`,
    tv: (id, s, e) => `https://superembed.cc/${id}?s=${s}&e=${e}`,
    movieImdb: (imdb) => `https://superembed.cc/${imdb}`,
    tvImdb: (imdb, s, e) => `https://superembed.cc/${imdb}?s=${s}&e=${e}`,
  },
  {
    id: 'embedsu',
    name: 'EmbedSU',
    short: 'SU',
    group: 'other',
    movie: (id) => `https://embed.su/embed/movie/${id}`,
    tv: (id, s, e) => `https://embed.su/embed/tv/${id}/${s}/${e}`,
    movieImdb: (imdb) => `https://embed.su/embed/movie/${imdb}`,
    tvImdb: (imdb, s, e) => `https://embed.su/embed/tv/${imdb}/${s}/${e}`,
  },
];

/**
 * Default provider — 2Embed.cc. The user confirmed 2embed is the most reliable
 * source across their tested titles, so we lead with it. The auto-scan +
 * auto-failover watchdog will silently move on if this specific mirror stalls.
 */
export const DEFAULT_PROVIDER: ProviderId = 'twoembed_cc';

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
 * player starts with that dubbed audio track preselected.
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
      ? `${url}&${provider.dubParam}=${encodeURIComponent(dubLang)}`
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
