import type { MetadataRoute } from 'next';

// PWA manifest — installable app with offline shell (see public/sw.js).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CineDeck — Movies, TV & Live Sports',
    short_name: 'CineDeck',
    description:
      'Search any title and press play — CineDeck scans every stream source and plays the healthiest one. Live sports, replays, watchlist and 12-language metadata.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#fbbf24',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
