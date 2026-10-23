'use client';

// Web port of app/verification.tsx. The only real state is profiles.verified_at, granted by the SUUQIYE team;
// the extra tiers are listed as coming later instead of offering a button that does nothing.
import { CheckCircle2, ShieldCheck } from '@/lib/icons';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/lib/i18n';

const TIERS = [
  { label: 'Phone number', description: 'Confirm your number with a one-time code' },
  { label: 'ID verification', description: 'Optional — unlocks a higher trust badge' },
  { label: 'Business verification', description: 'For dealers and shops selling regularly' },
];

export default function VerificationPage() {
  const t = useT();
  const authed = useRequireAuthPage('/verification');
  const verifiedAt = useAuthStore((s) => s.profile?.verified_at ?? null);

  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('profile.menu.verification')} />
        <div className="flex flex-col gap-3">
          <Card className="flex items-center gap-3">
            <ShieldCheck size={22} className={verifiedAt ? 'text-success' : 'text-textMuted'} />
            <div className="flex-1">
              <p className="text-sm font-medium text-textPrimary">{verifiedAt ? t('verification.status.verified') : t('verification.status.notVerified')}</p>
              <p className="text-xs text-textSecondary">
                {verifiedAt
                  ? t('verification.status.verifiedHint')
                  : t('verification.status.notVerifiedHint')}
              </p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <CheckCircle2 size={22} className="text-success" />
            <div className="flex-1">
              <p className="text-sm font-medium text-textPrimary">{t('web.t.googleAccount')}</p>
              <p className="text-xs text-textSecondary">{t('verification.verifiedAutomatically')}</p>
            </div>
          </Card>
          {TIERS.map((tier) => (
            <Card key={tier.label} className="flex items-center gap-3">
              <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-textMuted" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-medium text-textPrimary">{t.text(tier.label)}</p>
                <p className="text-xs text-textSecondary">{t.text(tier.description)}</p>
              </div>
              <Badge label={t('business.dashboard.comingLater')} tone="neutral" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
