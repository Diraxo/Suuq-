'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, CategoryIcon } from '@/lib/icons';
import { Card } from '@/components/Card';
import type { ListingDetail } from '@/lib/listingDetail';
import { useT } from '@/lib/i18n';

const SECTIONS_OPEN = 3; // the first sections are open; the rest wait behind "Show more"

/** The few facts a buyer decides on, as tiles. The grid fits as many ~130px tiles as the column allows, so it suits a phone and a wide page alike. */
function FactTiles({ facts }: { facts: ListingDetail['facts'] }) {
  return (
    <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
      {facts.map((f) => (
        <div key={f.key} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-primary/5 p-2.5" title={`${f.label}: ${f.value}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
            <CategoryIcon icon={f.icon} size={18} />
          </span>
          <span className="min-w-0">
            <span className="block break-words text-sm font-medium leading-tight text-textPrimary">{f.value}</span>
            <span className="block truncate text-[11px] text-textMuted">{f.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Label left, value right, a hairline between rows. The value wraps, so nothing is ever clipped. */
function SpecRows({ rows }: { rows: { key: string; label: string; value: string }[] }) {
  return (
    <dl>
      {rows.map((r) => (
        <div key={r.key} className="flex min-w-0 justify-between gap-3 border-t border-border py-2 text-sm first:border-t-0">
          <dt className="min-w-0 max-w-[42%] break-words text-textSecondary">{r.label}</dt>
          <dd className="min-w-0 flex-1 break-words text-right text-textPrimary">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Key facts, then the grouped sections of an ordinary (non-service) listing. */
export function ListingDetails({ detail }: { detail: ListingDetail }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? detail.sections : detail.sections.slice(0, SECTIONS_OPEN);
  const hidden = detail.sections.length - shown.length;

  return (
    <>
      {detail.facts.length > 0 && <FactTiles facts={detail.facts} />}
      {shown.map((s) => (
        <Card key={s.id} elevated={false} className="mt-4">
          <p className="mb-1 text-sm font-semibold text-textPrimary">{s.title}</p>
          <SpecRows rows={s.rows} />
        </Card>
      ))}
      {detail.sections.length > SECTIONS_OPEN && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          aria-label={showAll ? t('listing.showFewerDetails') : t('listing.showMoreDetails')}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-primary"
        >
          {showAll ? t('listing.showLess') : t('listing.showMore', { count: hidden })}
          {showAll ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </>
  );
}
