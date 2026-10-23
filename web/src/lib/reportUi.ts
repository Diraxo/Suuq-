import type { ReportStatus, ReportTargetType } from '@/lib/types';

// Shared labels for the admin report queue and workspace. Note "reviewed" is shown to staff as "Resolved".
export const REPORT_STATUS_TONE: Record<ReportStatus, 'warning' | 'accent' | 'success' | 'neutral'> = {
  pending: 'warning',
  reviewing: 'accent',
  reviewed: 'success',
  dismissed: 'neutral',
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pending',
  reviewing: 'Under review',
  reviewed: 'Resolved',
  dismissed: 'Dismissed',
};

export const REPORT_TYPE_LABEL: Record<ReportTargetType, string> = { listing: 'Listing', user: 'User', review: 'Review' };

/** Short human reference for a report uuid, e.g. #3F9A12C0. Searchable in the queue (matches the id prefix). */
export const reportRef = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
