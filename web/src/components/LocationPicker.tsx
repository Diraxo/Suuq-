'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, PlusCircle, Search } from '@/lib/icons';
import { Button } from './Button';
import { LocationsState, PickedLocation, submitLocationRequest, useLocations } from '@/services/locations';
import { useLocationText } from '@/lib/locationText';
import {
  LocNode,
  activeCountries,
  ancestors,
  childrenOf,
  displayName,
  effectiveFor,
  findByName,
  hasChildren,
  otherCountries,
  pathLabel,
  searchLocations,
  searchNodes,
  toLang,
} from '@/lib/locationTree';

type Row =
  | { type: 'header'; key: string; label: string }
  | { type: 'notice'; key: string; label: string }
  | { type: 'use'; key: string; node: LocNode }
  | { type: 'node'; key: string; node: LocNode; subtitle?: string };

const inputCls = 'w-full rounded-md border border-border bg-inputBackground p-3 text-sm text-textPrimary outline-none focus:border-primary';

// Country-first, searchable browser over the admin-managed directory
// (country → region → city) plus the "add a missing location" request flow.
// Used by Sell, Edit Listing and the Home location search.
export function LocationPicker({
  selected,
  onSelect,
  allowRequest = true,
  directory,
  collapseOnSelect = false,
}: {
  selected: string | null;
  onSelect: (loc: PickedLocation) => void;
  allowRequest?: boolean;
  /** Pass an already-loaded directory to avoid a second fetch. */
  directory?: LocationsState;
  /** After a place is chosen, fold the browser away into a one-line summary with a Change button. */
  collapseOnSelect?: boolean;
}) {
  const own = useLocations();
  const { index, status, reload } = directory ?? own;
  const { t, lang: locale } = useLocationText();
  const lang = toLang(locale);

  const [stack, setStack] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [countryId, setCountryId] = useState<string | undefined>();
  const [regionId, setRegionId] = useState<string | undefined>();
  const [countryQuery, setCountryQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const currentId = stack[stack.length - 1] as string | undefined;
  const current = currentId ? index.byId.get(currentId) : undefined;
  const searching = query.trim().length > 0;

  const pick = (node: LocNode) => {
    const eff = effectiveFor(index, node.id);
    setPendingName(null);
    setChanging(false);
    onSelect({ id: node.id, name: node.name, regionLabel: eff.regionLabel, currencies: eff.currencies, defaultCurrency: eff.defaultCurrency, pending: false });
  };

  const openNode = (node: LocNode) => {
    if (hasChildren(index, node.id)) {
      setStack(ancestors(index, node.id).map((a) => a.id).concat(node.id));
      setQuery('');
    } else {
      pick(node);
    }
  };

  const rows = useMemo<Row[]>(() => {
    if (searching) {
      const found = searchLocations(index, query, lang);
      const toRow = (node: LocNode): Row => ({ type: 'node', key: node.id, node, subtitle: pathLabel(index, node.id, lang) });
      if (found.matches.length) return found.matches.map(toRow);
      // Nothing contains the typed text: offer real directory places it might have meant, clearly labelled and never auto-selected.
      if (found.suggestions.length) return [{ type: 'notice', key: 'n-suggest', label: t('noExactMatch', { query: query.trim() }) } as Row, ...found.suggestions.map(toRow)];
      return [];
    }
    if (current) {
      return [
        { type: 'use', key: `use-${current.id}`, node: current } as Row,
        ...childrenOf(index, current.id, lang).map((node) => ({ type: 'node', key: node.id, node }) as Row),
      ];
    }
    const out: Row[] = [];
    const active = activeCountries(index, lang);
    if (active.length) {
      out.push({ type: 'header', key: 'h-active', label: t('activeHeader') });
      for (const node of active) out.push({ type: 'node', key: node.id, node });
    }
    const others = otherCountries(index, lang);
    if (others.length) out.push({ type: 'header', key: 'h-all', label: t('allCountriesHeader') });
    for (const node of others) out.push({ type: 'node', key: node.id, node });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, searching, query, lang, current, locale]);

  const startAdding = () => {
    setName(query.trim());
    setError(null);
    setCountryQuery('');
    const country = current ? (current.kind === 'country' ? current : ancestors(index, current.id).find((a) => a.kind === 'country')) : undefined;
    setCountryId(country?.id);
    setRegionId(current?.kind === 'region' ? current.id : current?.kind === 'city' ? current.parentId ?? undefined : undefined);
    setAdding(true);
  };

  const submit = async () => {
    if (name.trim().length < 2) return setError(t('nameRequired'));
    const parentId = regionId ?? countryId;
    if (!parentId) return setError(t('countryRequired'));
    setBusy(true);
    setError(null);
    try {
      const loc = await submitLocationRequest(name, parentId);
      setPendingName(loc.pending ? loc.name : null);
      onSelect(loc);
      setChanging(false);
      setAdding(false);
      setQuery('');
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? '';
      setError(msg.includes('Too many') ? t('tooMany') : t('submitFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') return <p className="mb-4 text-sm text-textSecondary">{t('loading')}</p>;
  if (status === 'error') {
    return (
      <div className="mb-4 text-sm text-textSecondary">
        {t('loadFailed')}{' '}
        <button onClick={reload} className="font-medium text-primary underline">
          {t('retry')}
        </button>
      </div>
    );
  }

  const chipCls = (active: boolean) =>
    `rounded-pill border-[1.5px] px-3 py-1.5 text-sm ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-textSecondary'}`;

  if (adding) {
    const country = countryId ? index.byId.get(countryId) : undefined;
    const regions = country ? childrenOf(index, country.id, lang).filter((c) => c.kind === 'region') : [];
    const countryMatches = !country ? (countryQuery.trim() ? searchNodes(index, countryQuery, lang, 12).filter((n) => n.kind === 'country') : activeCountries(index, lang)) : [];
    return (
      <div className="mb-4 rounded-md border border-border bg-surface p-4">
        <p className="font-semibold text-textPrimary">{t('addTitle')}</p>
        <p className="mt-1 text-xs text-textSecondary">{t('addHint')}</p>
        <label className="mb-1 mt-3 block text-sm font-medium text-textPrimary">{t('countryLabel')}</label>
        {country ? (
          <button
            onClick={() => {
              setCountryId(undefined);
              setRegionId(undefined);
            }}
            className={chipCls(true)}
          >
            {displayName(country, lang)} ✕
          </button>
        ) : (
          <>
            <input value={countryQuery} onChange={(e) => setCountryQuery(e.target.value)} placeholder={t('searchPlaceholder')} className={`${inputCls} mb-2`} />
            <div className="flex flex-wrap gap-2">
              {countryMatches.map((c) => (
                <button key={c.id} onClick={() => setCountryId(c.id)} className={chipCls(false)}>
                  {displayName(c, lang)}
                </button>
              ))}
            </div>
          </>
        )}
        {regions.length > 0 && (
          <>
            <label className="mb-1 mt-3 block text-sm font-medium text-textPrimary">{t('regionLabel')}</label>
            <div className="flex flex-wrap gap-2">
              {regions.map((r) => (
                <button key={r.id} onClick={() => setRegionId(regionId === r.id ? undefined : r.id)} className={chipCls(regionId === r.id)}>
                  {displayName(r, lang)}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="mb-1 mt-3 block text-sm font-medium text-textPrimary">{t('nameLabel')}</label>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={inputCls} />
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
        <div className="mt-4 flex gap-3">
          <Button variant="outline" fullWidth onClick={() => setAdding(false)} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button fullWidth loading={busy} onClick={submit}>
            {t('submit')}
          </Button>
        </div>
      </div>
    );
  }

  if (collapseOnSelect && selected && !changing) {
    const node = findByName(index, selected);
    const chain = node ? [...ancestors(index, node.id).reverse().map((a) => displayName(a, lang))] : [];
    const summary = [node ? displayName(node, lang) : selected, ...chain].join(', ');
    return (
      <div className="mb-4">
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary bg-primary/10 p-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-textPrimary">
            <MapPin size={16} className="shrink-0 text-primary" />
            <span className="truncate">{summary}</span>
          </span>
          <button type="button" onClick={() => { setChanging(true); setStack([]); setQuery(''); }} className="shrink-0 text-sm font-medium text-primary">
            Change
          </button>
        </div>
        {selected === pendingName && <p className="mt-2 text-xs text-textMuted">{t('pendingNote')}</p>}
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="relative mb-2">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className={`${inputCls} pl-9`}
        />
      </div>
      {!searching && current && (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
          <button onClick={() => setStack(stack.slice(0, -1))} aria-label="Back" className="rounded p-1 text-primary hover:bg-inputBackground">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setStack([])} className="text-primary">
            {t('allCountries')}
          </button>
          {stack.map((id, i) => {
            const n = index.byId.get(id);
            if (!n) return null;
            return (
              <span key={id} className="flex items-center gap-1">
                <ChevronRight size={12} className="text-textMuted" />
                <button onClick={() => setStack(stack.slice(0, i + 1))} className={i === stack.length - 1 ? 'text-textSecondary' : 'text-primary'}>
                  {displayName(n, lang)}
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="max-h-[min(20rem,45dvh)] overflow-y-auto overscroll-contain rounded-md border border-border bg-surface">
        {rows.length === 0 && <p className="p-3 text-sm text-textSecondary">{t('noMatches')}</p>}
        {rows.map((row) => {
          if (row.type === 'notice') {
            return (
              <p key={row.key} role="status" className="bg-inputBackground px-3 py-2 text-xs text-textSecondary">
                {row.label}
              </p>
            );
          }
          if (row.type === 'header') {
            return (
              <p key={row.key} className="bg-inputBackground px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-textMuted">
                {row.label}
              </p>
            );
          }
          const isUse = row.type === 'use';
          const node = row.node;
          const isSelected = selected === node.name;
          const branch = !isUse && hasChildren(index, node.id);
          return (
            <button
              key={row.key}
              onClick={() => (isUse ? pick(node) : openNode(node))}
              className={`flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 ${isSelected ? 'bg-primary/10 text-primary' : 'text-textPrimary hover:bg-inputBackground'}`}
            >
              <span className="min-w-0">
                <span className={`flex items-center gap-2 ${isUse ? 'font-medium text-primary' : ''}`}>
                  {!isUse && <MapPin size={14} className="shrink-0 text-textMuted" />}
                  {isUse ? t('useWhole', { name: displayName(node, lang) }) : displayName(node, lang)}
                </span>
                {!isUse && row.subtitle && <span className="ml-6 block truncate text-xs text-textMuted">{row.subtitle}</span>}
              </span>
              {isSelected ? <span>✓</span> : branch ? <ChevronRight size={16} className="shrink-0 text-textMuted" /> : null}
            </button>
          );
        })}
      </div>
      {selected && selected === pendingName && <p className="mt-2 text-xs text-textMuted">{t('pendingNote')}</p>}
      {allowRequest && (
        <button onClick={startAdding} className="mt-3 flex items-center gap-1 text-sm font-medium text-primary">
          <PlusCircle size={16} />
          {t('cantFind')}
        </button>
      )}
    </div>
  );
}
