'use client';

// Web port of app/help.tsx: common questions plus a way to reach the support team.
import Link from 'next/link';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useT } from '@/lib/i18n';

const FAQ = [
  { question: 'How do I post a listing?', answer: 'Tap the Sell button in the middle of the tab bar and follow the steps.' },
  { question: 'Is SUUQIYE free to use?', answer: 'Yes — posting, browsing, and messaging are completely free.' },
  { question: 'How do I stay safe when meeting a buyer or seller?', answer: 'Always meet in a public place, inspect the item first, and never send money in advance.' },
  { question: 'How do I report a scam?', answer: 'Open the listing or profile and tap Report — our team reviews every report.' },
];

export default function HelpPage() {
  const t = useT();
  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('settings.index.helpCenter')} fallbackHref="/settings" />
        <div className="flex flex-col gap-3">
          {FAQ.map((item) => (
            <Card key={item.question}>
              <p className="text-sm font-medium text-textPrimary">{t.text(item.question)}</p>
              <p className="mt-1 text-xs text-textSecondary">{t.text(item.answer)}</p>
            </Card>
          ))}
        </div>
        <Link href="/support/new" className="mt-6 flex items-center justify-center rounded-md bg-surface p-4 text-sm font-medium text-primary shadow-sm">
          {t('about.contactSupport')}
        </Link>
      </div>
    </div>
  );
}
