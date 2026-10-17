import { Badge } from './Badge';

// Moderation-aware status badge used across the admin console.
export function ListingStatusBadge({ status }: { status: string }) {
  if (status === 'removed') return <Badge label="Removed" tone="warning" />;
  if (status === 'deactivated') return <Badge label="Deactivated" tone="warning" />;
  if (status === 'sold') return <Badge label="Sold" tone="neutral" />;
  if (status === 'reserved') return <Badge label="Reserved" tone="accent" />;
  if (status === 'expired') return <Badge label="Expired" tone="neutral" />;
  return <Badge label="Live" tone="success" />;
}
