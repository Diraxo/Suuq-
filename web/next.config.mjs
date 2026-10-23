/** @type {import('next').NextConfig} */
// Baseline response headers for every page. A full Content-Security-Policy is deliberately NOT set here: it has to list the
// exact Supabase, R2 and Google sign-in hosts and needs testing against the live site, so adding it blind could break sign-in
// or uploads. Everything below is safe for the current app.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' }, // fallback avatar seed images
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' }, // Google OAuth avatar photos
      { protocol: 'https', hostname: 'res.cloudinary.com' }, // legacy pre-R2-migration image rows (see lib/r2.ts on mobile)
      // Cloudflare R2 public delivery domain for listing/avatar/chat images.
      // R2_PUBLIC_URL is a server-side Edge Function secret not readable from
      // this repo — '*.r2.dev' covers R2's own default Public Development URL.
      // If the production bucket instead uses a custom domain (set in the
      // Cloudflare dashboard), add that exact hostname here too.
      { protocol: 'https', hostname: '*.r2.dev' },
    ],
  },
};

export default nextConfig;
