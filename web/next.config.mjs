/** @type {import('next').NextConfig} */
const nextConfig = {
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
