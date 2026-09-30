export type ProviderId =
  | 'vidsrc'
  | 'twoembed'
  | 'vidsrcxyz'
  | 'superembed'
  | 'embedsu';

export interface Provider {
  id: ProviderId;
  name: string;
  movie: (id: number) => string;
  tv: (id: number, season: number, episode: number) => string;
  /** IMDB-id variants (e.g. "tt1375666") — used by the keyless IMDB watch mode. */
  movieImdb: (imdbId: string) => string;
  tvImdb: (imdbId: string, season: number, episode: number) => string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'vidsrc',
    name: 'VidSrc',
    movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
    movieImdb: (imdb) => `https://vidsrc.to/embed/movie/${imdb}`,
    tvImdb: (imdb, s, e) => `https://vidsrc.to/embed/tv/${imdb}/${s}/${e}`,
  },
  {
    id: 'twoembed',
    name: '2Embed',
    movie: (id) => `https://www.2embed.cc/embed/${id}`,
    tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
    movieImdb: (imdb) => `https://www.2embed.cc/embed/${imdb}`,
    tvImdb: (imdb, s, e) => `https://www.2embed.cc/embedtv/${imdb}&s=${s}&e=${e}`,
  },
  {
    id: 'vidsrcxyz',
    name: 'VidSrc XYZ',
    movie: (id) => `https://vidsrc.xyz/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
    movieImdb: (imdb) => `https://vidsrc.xyz/embed/movie?imdb=${imdb}`,
    tvImdb: (imdb, s, e) => `https://vidsrc.xyz/embed/tv?imdb=${imdb}&season=${s}&episode=${e}`,
  },
  {
    id: 'superembed',
    name: 'SuperEmbed',
    movie: (id) => `https://superembed.cc/${id}`,
    tv: (id, s, e) => `https://superembed.cc/${id}?s=${s}&e=${e}`,
    movieImdb: (imdb) => `https://superembed.cc/${imdb}`,
    tvImdb: (imdb, s, e) => `https://superembed.cc/${imdb}?s=${s}&e=${e}`,
  },
  {
    id: 'embedsu',
    name: 'EmbedSU',
    movie: (id) => `https://embed.su/embed/movie/${id}`,
    tv: (id, s, e) => `https://embed.su/embed/tv/${id}/${s}/${e}`,
    movieImdb: (imdb) => `https://embed.su/embed/movie/${imdb}`,
    tvImdb: (imdb, s, e) => `https://embed.su/embed/tv/${imdb}/${s}/${e}`,
  },
];

export const DEFAULT_PROVIDER: ProviderId = 'vidsrc';

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
 */
export function getEmbedUrl(
  providerId: string,
  mediaType: 'movie' | 'tv',
  tmdbOrImdbId: number | string,
  season?: number,
  episode?: number
): string {
  const provider = getProvider(providerId);
  const s = season && season >= 1 ? season : 1;
  const e = episode && episode >= 1 ? episode : 1;

  if (isImdbId(tmdbOrImdbId)) {
    return mediaType === 'tv'
      ? provider.tvImdb(tmdbOrImdbId, s, e)
      : provider.movieImdb(tmdbOrImdbId);
  }

  if (mediaType === 'tv') return provider.tv(tmdbOrImdbId, s, e);
  return provider.movie(tmdbOrImdbId);
}
