'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from '@/lib/icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

// The pieces every staff-console list shares, so Listings, Users, Support, Reports and History look and behave the same.

/** Page title, an optional one-line explanation, and the page's own actions on the right. */
export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-textPrimary">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-textSecondary">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** A row of filter pills that wraps onto a second line instead of scrolling sideways. */
export function FilterChips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.value ? 'border-primary bg-primary text-primaryText' : 'border-border bg-surface text-textSecondary hover:bg-inputBackground'
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className={`text-xs ${value === o.value ? 'opacity-80' : 'text-textMuted'}`}>{o.count.toLocaleString('en-US')}</span>}
        </button>
      ))}
    </div>
  );
}

/** Placeholder rows while a list loads: the page keeps its shape instead of jumping from "Loading…" to content. */
export function ListSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-md bg-inputBackground" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-inputBackground" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-inputBackground" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One row of a staff list: a picture or avatar, a title with status badges, a meta line, an optional snippet, and a chevron. */
export function AdminListRow({ href, lead, title, badges, meta, snippet }: { href: string; lead?: ReactNode; title: string; badges?: ReactNode; meta?: ReactNode; snippet?: string | null }) {
  return (
    <Link href={href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-inputBackground focus:outline-none focus-visible:bg-inputBackground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
      {lead}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full truncate text-sm font-semibold text-textPrimary">{title}</span>
          {badges}
        </div>
        {meta && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-textMuted">{meta}</div>}
        {snippet && <p className="mt-1 line-clamp-2 break-words text-sm text-textSecondary">{snippet}</p>}
      </div>
      <ChevronRight size={16} className="shrink-0 text-textMuted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** The list container: one bordered surface with hairlines between rows. */
export function AdminList({ children }: { children: ReactNode }) {
  return (
    <Card elevated={false} className="divide-y divide-border overflow-hidden p-0">
      {children}
    </Card>
  );
}

/** "123 listings · page 2 of 5" with Previous / Next beside it. */
export function AdminPager({ summary, page, pages, onPage }: { summary: string; page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-textSecondary">{summary}</span>
      {pages > 1 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/** A label-and-number tile for a record's header (a user's listings, reports, warnings...). */
export function AdminStat({ label, value, tone }: { label: string; value: number | string; tone?: 'warning' }) {
  return (
    <div className="min-w-[96px] flex-1 rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-textMuted">{label}</p>
      <p className={`text-xl font-bold ${tone === 'warning' && Number(value) > 0 ? 'text-warning' : 'text-textPrimary'}`}>{value}</p>
    </div>
  );
}

/** A titled card of rows inside a record page. */
export function AdminSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <Card elevated={false}>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-textPrimary">
        {title}
        {count !== undefined && <span className="rounded-pill bg-inputBackground px-2 py-0.5 text-xs font-medium text-textSecondary">{count}</span>}
      </p>
      <div className="divide-y divide-border">{children}</div>
    </Card>
  );
}
