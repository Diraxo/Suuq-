'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchCatalog } from '@/lib/brandCatalog';
import { useSellT } from '@/lib/sellI18n';

const INPUT =
  'w-full rounded-md border bg-inputBackground px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary';

// Web counterpart of components/CatalogPicker.tsx: a searchable Brand / Model chooser (lib/brandCatalog.ts).
// Names are shown exactly as stored — never translated. Whatever the seller types can always be accepted
// ("Use ..."), so a brand or model missing from the catalog never blocks a listing.
export function CatalogPicker({
  id,
  label,
  required,
  common,
  all,
  value,
  onChange,
  disabledHint,
  describedBy,
}: {
  id: string;
  label: string;
  required?: boolean;
  common: string[];
  all: string[];
  value: string;
  onChange: (value: string) => void;
  /** When set the picker is locked and shows this instead of opening (e.g. "Choose the brand first"). */
  disabledHint?: string;
  describedBy?: string;
}) {
  const t = useSellT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? searchCatalog(all, query) : []), [all, query, searching]);
  const exact = results.some((r) => r.toLowerCase() === query.trim().toLowerCase());

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (name: string) => {
    onChange(name);
    close();
  };

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const option = (name: string) => (
    <li key={name}>
      <button
        type="button"
        role="option"
        aria-selected={name === value}
        onClick={() => pick(name)}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-textPrimary hover:bg-surface"
      >
        {name}
        {name === value && <span aria-hidden="true">✓</span>}
      </button>
    </li>
  );
  const heading = (text: string) => (
    <li role="presentation" className="px-3 pb-1 pt-3 text-xs font-semibold text-textMuted">
      {text}
    </li>
  );

  return (
    <div ref={box} className="relative">
      <p id={`${id}-label`} className="mb-1 block text-sm font-medium text-textPrimary">
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> {t('post.webSell.requiredSr')}</span>}
      </p>
      <button
        id={id}
        type="button"
        disabled={!!disabledHint}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}`}
        aria-describedby={describedBy}
        onClick={() => setOpen((o) => !o)}
        className={`${INPUT} flex items-center justify-between text-left disabled:opacity-60 ${value ? '' : 'text-textMuted'}`}
      >
        <span>{value || disabledHint || t('post.catalog.choose')}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-background p-2 shadow-lg" onKeyDown={(e) => e.key === 'Escape' && close()}>
          <input
            ref={search}
            type="text"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (searching && !exact) pick(query.trim());
                else if (results[0]) pick(results[0]);
              }
            }}
            placeholder={t('post.catalog.search')}
            aria-label={t('post.catalog.search')}
            aria-controls={listId}
            className={INPUT}
          />
          <ul id={listId} role="listbox" aria-labelledby={`${id}-label`} className="mt-2 max-h-64 overflow-y-auto">
            {searching ? (
              <>
                {results.map(option)}
                {results.length === 0 && <li className="px-3 py-2 text-sm text-textMuted">{t('post.catalog.noMatch')}</li>}
                {!exact && (
                  <li>
                    <button type="button" onClick={() => pick(query.trim())} className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-primary hover:bg-surface">
                      {t('post.catalog.useTyped', { value: query.trim() })}
                    </button>
                  </li>
                )}
              </>
            ) : (
              <>
                {common.length > 0 && heading(t('post.catalog.common'))}
                {common.map(option)}
                {heading(t('post.catalog.all'))}
                {all.map(option)}
                <li role="presentation" className="px-3 py-2 text-xs text-textMuted">
                  {t('post.catalog.typeHint')}
                </li>
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
