'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from '@/lib/icons';
import { CategoryIcon } from '@/lib/icons';
import { Card } from '@/components/Card';
import { categories } from '@/lib/categories';
import { categoryLabel, subcategoryLabel } from '@/lib/categoryNames';
import { summarizeDays, subcategoryIcon, type DetailRow, type ServiceDetail } from '@/lib/serviceDetail';
import { useT } from '@/lib/i18n';

/** The service's own icon, its trade and the kind of provider — sits above the title. */
export function ServiceIdentity({ subcategory, providerKindLabel }: { subcategory?: string | null; providerKindLabel?: string }) {
  const t = useT();
  const label = subcategory ? subcategoryLabel(t, 'services', subcategory) : categoryLabel(t, 'services', 'Services');
  return (
    <div className="mt-3 flex min-w-0 items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
        <CategoryIcon icon={subcategoryIcon(categories, 'services', subcategory)} size={16} />
      </span>
      <span className="min-w-0 truncate text-sm text-textSecondary" title={label}>
        {label}
      </span>
      {providerKindLabel && <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-medium text-textSecondary">{providerKindLabel}</span>}
    </div>
  );
}

// Label above value: a long value wraps under its label instead of pushing the page wider than the screen.
function Rows({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.key} className="min-w-0">
          <dt className="text-[11px] font-medium text-textMuted">{r.label}</dt>
          <dd className="break-words text-sm text-textPrimary">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card elevated={false} className="mt-4">
      <p className="mb-2 text-sm font-semibold text-textPrimary">{title}</p>
      {children}
    </Card>
  );
}

function Chip({ label }: { label: string }) {
  return <span className="inline-flex max-w-full break-words rounded-pill border border-border bg-primary/10 px-3 py-1 text-xs text-textPrimary">{label}</span>;
}

/** Overview, highlights, availability, provider and the remaining details of a service. `extra` rows (location, posted...) join the collapsible "more". */
export function ServiceDetails({ detail, extra }: { detail: ServiceDetail; extra: DetailRow[] }) {
  const t = useT();
  const [allDays, setAllDays] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const days = allDays ? { shown: detail.days, hidden: 0 } : summarizeDays(detail.days);
  const more = [...detail.more, ...extra];
  const hoursRow = detail.hours ? [{ key: 'hours', label: t('post.serviceDisplay.hours', { defaultValue: 'Working hours' }), value: detail.hours }] : [];
  const hasAvailability = detail.days.length > 0 || !!detail.hours || detail.availability.length > 0;
  const moreText = (n: number) => t('listing.service.moreDays', { count: n, defaultValue: `+${n} more` });

  return (
    <>
      {detail.specialties.length > 0 && (
        <Section title={t('listing.service.overview', { defaultValue: 'What this provider offers' })}>
          <div className="flex flex-wrap gap-2">
            {detail.specialties.map((s) => (
              <Chip key={s} label={s} />
            ))}
          </div>
        </Section>
      )}

      {detail.highlights.length > 0 && (
        <Section title={t('listing.service.highlights', { defaultValue: 'Service highlights' })}>
          <Rows rows={detail.highlights} />
        </Section>
      )}

      {hasAvailability && (
        <Section title={t('listing.service.availability', { defaultValue: 'Availability' })}>
          {detail.days.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-label={detail.days.join(', ')}>
              {days.shown.map((d) => (
                <Chip key={d} label={d} />
              ))}
              {days.hidden > 0 && (
                <button type="button" onClick={() => setAllDays(true)} aria-label={moreText(days.hidden)} className="rounded-pill border border-primary/40 px-3 py-1 text-xs font-medium text-primary">
                  {moreText(days.hidden)}
                </button>
              )}
              {allDays && detail.days.length > 4 && (
                <button type="button" onClick={() => setAllDays(false)} className="py-1 text-xs font-medium text-primary">
                  {t('listing.showLess')}
                </button>
              )}
            </div>
          )}
          {(hoursRow.length > 0 || detail.availability.length > 0) && (
            <div className={detail.days.length > 0 ? 'mt-3' : ''}>
              <Rows rows={[...hoursRow, ...detail.availability]} />
            </div>
          )}
        </Section>
      )}

      {detail.provider.length > 0 && (
        <Section title={t('listing.service.provider', { defaultValue: 'Provider' })}>
          <Rows rows={detail.provider} />
        </Section>
      )}

      {more.length > 0 && (
        <Section title={t('listing.service.more', { defaultValue: 'Additional details' })}>
          <Rows rows={showMore ? more : more.slice(0, 2)} />
          {more.length > 2 && (
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              aria-label={showMore ? t('listing.showFewerDetails') : t('listing.showMoreDetails')}
              className="mt-3 flex items-center gap-1 text-xs font-medium text-primary"
            >
              {showMore ? t('listing.showLess') : t('listing.showMore', { count: more.length - 2 })}
              {showMore ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </Section>
      )}
    </>
  );
}
