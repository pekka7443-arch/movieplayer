/**
 * Tiny base64 LQIP placeholders for next/image `placeholder="blur"`.
 * A 1px stretched data-URL is the cheapest possible shimmer seed — it keeps
 * poster/backdrop loads from snapping in as blank boxes and eliminates
 * layout shift (dimensions are already fixed by the wrapper).
 */
export const POSTER_BLUR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const BACKDROP_BLUR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPCwMTwgQAHggJ/RU9iGgAAAABJRU5ErkJggg==';
