'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Lock, FileText, Mail, ChevronRight } from '@/lib/icons';

// Mirrors app/about.tsx on mobile: real logo asset (never a text "F"),
// same description copy, geographically neutral — no country/region claims
// per §18 of the Phase 1 brief.
const ROWS = [
  { icon: Lock, label: 'Privacy Policy', href: '/settings/privacy-policy' },
  { icon: FileText, label: 'Terms & Conditions', href: '/settings/terms' },
];

export default function AboutPage() {
  const router = useRouter();
  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-6 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label="Back" className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">About Fursad</h1>
      </div>

      <div className="mx-auto max-w-md">
        <div className="flex flex-col items-center">
          <Image src="/fursad-logo.png" alt="Fursad" width={72} height={72} className="rounded-xl" />
          <p className="mt-2 text-xs text-textMuted">Version 1.0.0</p>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-textSecondary">
          Fursad is a marketplace built around how people already do business. Browse listings by category, search
          for exactly what you need, and message sellers directly to ask questions, negotiate, and arrange a meetup.
          List an item in minutes with photos, a price, and a description, then track offers and messages from
          interested buyers. Follow sellers you trust, save your favorite listings, and leave reviews to help others
          shop with confidence.
        </p>

        <div className="mt-6 divide-y divide-border">
          {ROWS.map((row) => (
            <Link key={row.label} href={row.href} className="flex items-center gap-3 py-3">
              <row.icon size={20} className="text-textSecondary" />
              <span className="flex-1 text-sm text-textPrimary">{row.label}</span>
              <ChevronRight size={18} className="text-textMuted" />
            </Link>
          ))}
          <a href="mailto:fursadsupport@gmail.com" className="flex items-center gap-3 py-3">
            <Mail size={20} className="text-textSecondary" />
            <span className="flex-1 text-sm text-textPrimary">Contact support</span>
            <ChevronRight size={18} className="text-textMuted" />
          </a>
        </div>
      </div>
    </div>
  );
}
