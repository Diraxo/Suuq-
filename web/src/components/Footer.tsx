'use client';

import Link from 'next/link';
import { Logo } from './Logo';
import { useT } from '@/lib/i18n';

// Desktop-only footer — the mobile app has no equivalent (its legal links
// live under Settings/About), so this exists purely to make the desktop
// layout read as a real website rather than a stretched phone screen.
export function Footer() {
  const t = useT();
  return (
    <footer className="mt-16 hidden border-t border-border bg-surface md:block">
      <div className="mx-auto max-w-content px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-textSecondary">
              {t('web.t.aMarketplaceBuiltAroundHow')}
            </p>
          </div>
          <div className="flex flex-wrap gap-12">
            <div>
              <p className="text-sm font-semibold text-textPrimary">{t('post.fieldLabels.Company')}</p>
              <ul className="mt-3 space-y-2 text-sm text-textSecondary">
                <li><Link href="/about" className="hover:text-textPrimary">{t('profile.menu.about')}</Link></li>
                <li><Link href="/settings/safety" className="hover:text-textPrimary">{t('settings.communityGuidelines.title')}</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-textPrimary">{t('web.m.legal')}</p>
              <ul className="mt-3 space-y-2 text-sm text-textSecondary">
                <li><Link href="/settings/privacy-policy" className="hover:text-textPrimary">{t('settings.privacyPolicy.title')}</Link></li>
                <li><Link href="/settings/terms" className="hover:text-textPrimary">{t('about.termsAndConditions')}</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-textPrimary">{t('settings.index.support')}</p>
              <ul className="mt-3 space-y-2 text-sm text-textSecondary">
                <li><a href="mailto:suuqiyesupport@gmail.com" className="hover:text-textPrimary">{t('about.contactSupport')}</a></li>
                <li><Link href="/settings/language" className="hover:text-textPrimary">{t('settings.language')}</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-10 text-xs text-textMuted">{t('web.m.allRights', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
