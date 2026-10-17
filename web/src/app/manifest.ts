import type { MetadataRoute } from 'next';

// Makes the site installable ("Add to Home Screen"), which is also what lets iOS deliver web push to it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SUUQIYE',
    short_name: 'SUUQIYE',
    description: 'SUUQIYE marketplace',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
