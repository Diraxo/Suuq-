'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Clock, Globe, MapPin, MessageCircle, Phone, Share2, ShieldCheck, Sparkles, Store } from 'lucide-react';
import { BUSINESS_GOLD } from '@/lib/profileIdentity';
import { SOCIAL_KEYS, normalizeSocial } from '@/lib/profileRules';
import { safeWebsiteHref, hoursLines, isOpenNow, hoursDayOf, formatTime12 } from '@/lib/storefront';
import { categories } from '@/lib/categories';
import type { Profile } from '@/lib/types';
import { useT } from '@/lib/i18n';

const SOCIAL_NAMES: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', whatsapp: 'WhatsApp', telegram: 'Telegram' };
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as const;

/** The gold badge. Rendered only for a business staff have verified; uploading a banner never earns it. */
export function VerifiedBusinessBadge() {
  const t = useT();
  return (
    <span
      aria-label={t('business.verifiedBusiness')}
      className="inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-xs font-bold text-[#7A5800] dark:text-[#F2CB5C]"
      style={{ backgroundColor: `${BUSINESS_GOLD}26`, borderColor: `${BUSINESS_GOLD}80` }}
    >
      <ShieldCheck size={14} style={{ color: BUSINESS_GOLD }} /> {t('business.verifiedBusiness')}
    </span>
  );
}

type Props = {
  profile: Profile;
  /** The number the viewer may call under the business (from get_contact_phone, 0072). The card never reads a number off the profile row. */
  phone?: string | null;
  /** Staff-verified storefront. Never derived from the profile's own fields. */
  verified: boolean;
  isSelf: boolean;
  /** Present only when there is something to message about. */
  onContact?: () => void;
  contactBusy?: boolean;
  storefrontHref?: string;
};

// The business-specific part of a profile: category, description, address, hours, links, storefront. It sits under the shared header
// (the one avatar, name and bio of the account) and never renders a name or avatar of its own. It reads only business details, so
// nothing here can become a second identity. The legacy business_name / business_logo_url columns are not read at all.
export function BusinessProfileCard({ profile, phone: callPhone, verified, isSelf, onContact, contactBusy, storefrontHref }: Props) {
  const t = useT();
  const [hoursOpen, setHoursOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const name = profile.full_name?.trim() ?? '';
  // Only a number the database released for this business (the owner opted in); the account phone stays private otherwise.
  const phone = callPhone ?? null;
  const allDays = hoursLines(profile.business_hours).days;
  // A week of only "Closed" says nothing, so it is treated as no hours.
  const days = allDays.some((h) => !h.closed) ? allDays : [];
  const open = days.length > 0 ? isOpenNow(days) : null;
  const today = hoursDayOf(new Date());
  const todayHours = days.find((h) => h.day === today);
  const website = safeWebsiteHref(profile.business_website);
  const socials = SOCIAL_KEYS.map((key) => ({ key, href: normalizeSocial(key, profile.social_links?.[key] ?? '') })).filter((s) => !!s.href);
  const hasInfo = !!profile.business_address || days.length > 0 || !!website || socials.length > 0;
  const shownCategories = (profile.business_categories ?? []).map((id) => categories.find((c) => c.id === id)).filter((c): c is (typeof categories)[number] => !!c);
  const todos = isSelf
    ? [
        !profile.business_banner_url && t('business.todoBanner'),
        !profile.business_categories?.length && t('business.todoCategory'),
        !profile.business_description && t('business.todoDescription'),
        !profile.business_address && t('business.todoAddress'),
        days.length === 0 && t('business.todoHours'),
        !website && socials.length === 0 && t('business.todoLinks'),
      ].filter(Boolean) as string[]
    : [];
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: name, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* cancelled */
    }
  };
  const chip = 'inline-flex items-center gap-1.5 rounded-pill bg-inputBackground px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10';
  const hasBadges = verified || shownCategories.length > 0 || open !== null;
  const hasMain = hasBadges || !!profile.business_description || !!onContact || !!phone || isSelf || !!storefrontHref;
  if (!hasMain && !hasInfo && todos.length === 0) return null;

  return (
    <div className="mt-4 w-full">
      {hasMain && (
        <section className="rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-5">
          {hasBadges && (
            <div className="flex flex-wrap items-center gap-2">
              {verified && <VerifiedBusinessBadge />}
              {shownCategories.map((category) => <span key={category.id} className="inline-flex items-center gap-1 rounded-pill bg-inputBackground px-2.5 py-1 text-xs text-textSecondary">{category.name}</span>)}
              {open !== null && (
                <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${open ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-success' : 'bg-error'}`} />
                  {open ? t('seller.hours.openNow') : t('seller.hours.closedNow')}
                </span>
              )}
            </div>
          )}

          {profile.business_description && (
            <div className={hasBadges ? 'mt-3' : ''}>
              <p className={`whitespace-pre-line text-sm leading-relaxed text-textSecondary ${descOpen ? '' : 'line-clamp-3'}`}>{profile.business_description}</p>
              {profile.business_description.length > 140 && (
                <button type="button" onClick={() => setDescOpen((v) => !v)} className="mt-1 text-xs font-semibold text-primary">{descOpen ? t('business.showLess') : t('business.readMore')}</button>
              )}
            </div>
          )}

          <div className={`flex items-center gap-2 ${hasBadges || profile.business_description ? 'mt-4' : ''}`}>
            {!isSelf && onContact && (
              <button onClick={onContact} disabled={contactBusy} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-primary text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-60">
                <MessageCircle size={18} /> {t('business.message')}
              </button>
            )}
            {!isSelf && phone && (
              <a href={`tel:${phone}`} aria-label={t('seller.call')} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border text-primary hover:bg-inputBackground">
                <Phone size={18} />
              </a>
            )}
            <button onClick={() => void share()} aria-label={t('common.share')} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border text-primary hover:bg-inputBackground">
              <Share2 size={18} />
            </button>
            {isSelf && (
              <Link href="/settings/business-profile" className="ml-auto rounded-pill border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5">
                {t('business.editBusiness')}
              </Link>
            )}
          </div>
          {storefrontHref && (
            <div className="mt-3 text-center">
              <Link href={storefrontHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                <Store size={16} /> {t('storefront.public.visitStorefront')}
              </Link>
            </div>
          )}
        </section>
      )}

      {todos.length > 0 && (
        <Link href="/settings/business-profile" className="mt-3 block rounded-3xl border border-primary/30 bg-surface p-4 shadow-sm hover:bg-primary/5 sm:p-5">
          <span className="flex items-center gap-2 text-sm font-semibold text-textPrimary">
            <Sparkles size={18} className="text-primary" /> {t('business.completeTitle')}
          </span>
          <span className="mt-1 block text-xs text-textSecondary">{t('business.completeSub')}</span>
          <ul className="mt-2 space-y-1 text-xs text-textSecondary">
            {todos.map((x) => (
              <li key={x}>○ {x}</li>
            ))}
          </ul>
        </Link>
      )}

      {hasInfo && (
        <section className="mt-3 space-y-3 rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-semibold text-textPrimary">{t('business.details')}</h2>
          {profile.business_address && (
            <p className="flex items-start gap-2 text-sm text-textSecondary">
              <MapPin size={18} className="mt-0.5 shrink-0" /> {profile.business_address}
            </p>
          )}
          {days.length > 0 && (
            <div>
              <button onClick={() => setHoursOpen((v) => !v)} aria-expanded={hoursOpen} className="flex w-full items-center gap-2 text-left text-sm text-textSecondary">
                <Clock size={18} className="shrink-0" />
                <span className="flex-1">
                  {todayHours ? `${t.text(DAY_NAMES[today])} · ${todayHours.closed ? t('components.businessHoursEditor.closed') : `${formatTime12(todayHours.open!)} – ${formatTime12(todayHours.close!)}`}` : t('seller.hours.title')}
                </span>
                <ChevronDown size={18} className={`transition-transform ${hoursOpen ? 'rotate-180' : ''}`} />
              </button>
              {hoursOpen && (
                <ul className="ml-7 mt-2 divide-y divide-border text-sm">
                  {days.map((h) => (
                    <li key={h.day} className={`flex justify-between py-1.5 ${h.day === today ? 'font-semibold text-textPrimary' : 'text-textSecondary'}`}>
                      <span>{t.text(DAY_NAMES[h.day])}</span>
                      <span className={h.closed ? 'text-textMuted' : ''}>{h.closed ? t('components.businessHoursEditor.closed') : `${formatTime12(h.open!)} – ${formatTime12(h.close!)}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {(website || socials.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer nofollow" className={chip}>
                  <Globe size={16} /> {t('settings.businessProfile.websiteLabel')}
                </a>
              )}
              {socials.map(({ key, href }) => (
                <a key={key} href={href!} target="_blank" rel="noopener noreferrer nofollow" className={chip}>
                  {SOCIAL_NAMES[key]}
                </a>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
