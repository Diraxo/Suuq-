'use client';

// Web port of app/verification.tsx. The only real state is profiles.verified_at, granted by the SUUQIYE team;
// the extra tiers are listed as coming later instead of offering a button that does nothing.
import { CheckCircle2, ShieldCheck } from '@/lib/icons';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useAuthStore } from '@/store/auth';

const TIERS = [
  { label: 'Phone number', description: 'Confirm your number with a one-time code' },
  { label: 'ID verification', description: 'Optional — unlocks a higher trust badge' },
  { label: 'Business verification', description: 'For dealers and shops selling regularly' },
];

export default function VerificationPage() {
  const authed = useRequireAuthPage('/verification');
  const verifiedAt = useAuthStore((s) => s.profile?.verified_at ?? null);

  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Verification" />
        <div className="flex flex-col gap-3">
          <Card className="flex items-center gap-3">
            <ShieldCheck size={22} className={verifiedAt ? 'text-success' : 'text-textMuted'} />
            <div className="flex-1">
              <p className="text-sm font-medium text-textPrimary">{verifiedAt ? 'Verified by SUUQIYE' : 'Not verified yet'}</p>
              <p className="text-xs text-textSecondary">
                {verifiedAt
                  ? 'Buyers see a Verified badge on your profile and listings.'
                  : 'The SUUQIYE team grants verification after reviewing an account. It is not automatic and cannot be requested from this screen.'}
              </p>
            </div>
          </Card>
          <Card className="flex items-center gap-3">
            <CheckCircle2 size={22} className="text-success" />
            <div className="flex-1">
              <p className="text-sm font-medium text-textPrimary">Google account</p>
              <p className="text-xs text-textSecondary">Verified automatically when you signed up</p>
            </div>
          </Card>
          {TIERS.map((tier) => (
            <Card key={tier.label} className="flex items-center gap-3">
              <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-textMuted" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-medium text-textPrimary">{tier.label}</p>
                <p className="text-xs text-textSecondary">{tier.description}</p>
              </div>
              <Badge label="Coming later" tone="neutral" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
