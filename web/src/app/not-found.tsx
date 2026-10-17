import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass } from 'lucide-react';

// The one generic 404, shared by unknown URLs and by restricted areas for unauthorized visitors.
export const metadata: Metadata = { title: 'Page not found — SUUQIYE', robots: { index: false, follow: false } };

const linkBase = 'inline-flex h-[50px] items-center justify-center rounded-pill px-6 text-[15px] font-semibold transition-opacity active:opacity-80';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-inputBackground">
        <Compass size={36} className="text-textMuted" aria-hidden />
      </div>
      <p className="text-sm font-semibold uppercase tracking-widest text-textMuted">Error 404</p>
      <h1 className="mt-2 text-3xl font-bold text-textPrimary md:text-4xl">Page not found</h1>
      <p className="mt-3 max-w-md text-sm text-textSecondary md:text-base">
        The page you’re looking for doesn’t exist or may have been moved. Check the address, or head back to the marketplace.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/" className={`${linkBase} bg-primary text-primaryText`}>
          Back to home
        </Link>
        <Link href="/search" className={`${linkBase} border-[1.5px] border-primary bg-transparent text-primary`}>
          Browse listings
        </Link>
      </div>
    </div>
  );
}
