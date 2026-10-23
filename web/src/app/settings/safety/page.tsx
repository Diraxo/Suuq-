'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, Users, Eye, ShieldCheck, Flag } from 'lucide-react';
import { Card } from '@/components/Card';
import { useT } from '@/lib/i18n';

// Copied verbatim from app/settings/safety.tsx on mobile — same 5 tips.
const TIPS = [
  { icon: Users, title: 'Meet in a public place', body: 'Choose a busy, well-lit spot — a market, mall, or police station forecourt works well.' },
  { icon: Eye, title: 'Inspect before you pay', body: "Check the item works as described before handing over any cash." },
  { icon: ShieldCheck, title: 'Never send money in advance', body: "Legitimate sellers won't ask you to pay before you've seen the item." },
  { icon: ShieldCheck, title: 'Look for verification badges', body: 'Verified and Trusted Seller badges mean extra checks have been completed.' },
  { icon: Flag, title: 'Report anything suspicious', body: 'Use the Report button on any listing or profile — our team reviews every report.' },
];

export default function SafetyPage() {
  const t = useT();
  const router = useRouter();
  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">{t('settings.safety.title')}</h1>
      </div>
      <div className="mx-auto max-w-2xl space-y-3">
        {TIPS.map((tip) => (
          <Card key={tip.title} className="flex items-start gap-3">
            <tip.icon size={20} className="mt-0.5 shrink-0 text-success" />
            <div>
              <p className="text-sm font-medium text-textPrimary">{t.text(tip.title)}</p>
              <p className="mt-0.5 text-sm text-textSecondary">{t.text(tip.body)}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
