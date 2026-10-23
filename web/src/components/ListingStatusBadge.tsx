'use client';

import { Badge } from './Badge';
import { useT } from '@/lib/i18n';

// Moderation-aware status badge used across the admin console.
export function ListingStatusBadge({ status }: { status: string }) {
  const t = useT();
  if (status === 'removed') return <Badge label={t('support.listings.removed')} tone="warning" />;
  if (status === 'deactivated') return <Badge label={t('support.listings.deactivated')} tone="warning" />;
  if (status === 'sold') return <Badge label={t('myListings.stats.sold')} tone="neutral" />;
  if (status === 'reserved') return <Badge label={t('myListings.tabs.reserved')} tone="accent" />;
  if (status === 'expired') return <Badge label={t('myListings.tabs.expired')} tone="neutral" />;
  return <Badge label={t('web.m.live')} tone="success" />;
}
