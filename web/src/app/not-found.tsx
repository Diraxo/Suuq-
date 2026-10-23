import type { Metadata } from 'next';
import { NotFoundContent } from '@/components/NotFoundContent';

// The one generic 404, shared by unknown URLs and by restricted areas for unauthorized visitors.
export const metadata: Metadata = { title: 'Page not found — SUUQIYE', robots: { index: false, follow: false } };

export default function NotFound() {
  return <NotFoundContent />;
}
