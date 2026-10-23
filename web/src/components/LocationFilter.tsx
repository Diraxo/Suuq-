'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Search, X } from '@/lib/icons';
import { LocationPicker } from './LocationPicker';
import { LocationsState } from '@/services/locations';
import { useLocationText } from '@/lib/locationText';
import { ancestors, displayName, toLang } from '@/lib/locationTree';
import { scopeBack, scopeScrollTarget, scopeSelector } from '@/lib/homeFeed';
import { useT } from '@/lib/i18n';

// Home's location filter: drills country → region → city with chips and a
// breadcrumb, plus a search button for jumping straight to any place. Reads the
// same admin-managed directory as the app.
export function LocationFilter({
  directory,
  scopeId,
  onChange,
  openToken,
  scrollResetToken,
}: {
  directory: LocationsState;
  scopeId: string | null;
  onChange: (id: string | null) => void;
  /** Bump to open the search picker from outside (e.g. an empty state's "Choose a location"). */
  openToken?: number;
  /** Bump to scroll the strip back to its first ("All of …") option, e.g. when Home is reset. */
  scrollResetToken?: number;
}) {
  const t = useT();
  const { index } = directory;
  const { t: lt, lang: locale } = useLocationText();
  const lang = toLang(locale);
  const [open, setOpen] = useState(false);
  // Opens when the parent bumps the token (adjusting state during render, not in an effect).
  const [seenToken, setSeenToken] = useState(openToken);
  if (openToken !== seenToken) {
    setSeenToken(openToken);
    if (openToken) setOpen(true);
  }

  const node = scopeId ? index.byId.get(scopeId) : undefined;
  const crumbs = node ? [...ancestors(index, node.id), node] : [];
  const back = scopeBack(index, scopeId);
  // "All …" first, then the places below it (see scopeSelector). A leaf place
  // (city) keeps showing its siblings so switching is one click.
  const selector = useMemo(() => scopeSelector(index, scopeId, lang), [index, scopeId, lang]);
  const options = selector.options.map((o) => ({
    id: o.id,
    label: o.isAll ? (o.node ? lt('allIn', { name: displayName(o.node, lang) }) : lt('allLocations')) : displayName(o.node!, lang),
  }));

  // When the level the strip lists changes (picking a country/region, or a
  // place from search) start it at the beginning — "All of X" first — instead
  // of keeping the old scroll offset; if a specific child is selected, bring
  // that one into view. Scrolls the strip itself (never the page) and restores
  // keyboard focus to the active option, since the clicked button was replaced.
  const stripRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const levelKey = selector.parent?.id ?? 'root';
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const target = scopeScrollTarget(selector);
    const child = el.children[target.index] as HTMLElement | undefined;
    el.scrollLeft = target.index === 0 || !child ? 0 : Math.max(0, child.offsetLeft - 16);
    if (restoreFocus.current) {
      restoreFocus.current = false;
      (el.children[selector.activeIndex] as HTMLElement | undefined)?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelKey, selector.options.length]);

  useLayoutEffect(() => {
    if (scrollResetToken && stripRef.current) stripRef.current.scrollLeft = 0;
  }, [scrollResetToken]);

  return (
    <div>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-textPrimary">{lt('exploreByLocation')}</h2>
        <button onClick={() => setOpen(true)} aria-label={lt('changeLocation')} className="rounded-full p-2 text-primary hover:bg-inputBackground">
          <Search size={18} />
        </button>
      </div>
      {back && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {/* Always-visible way back: one level up (or All Locations from a country). */}
          <button
            onClick={() => onChange(back.id)}
            aria-label={back.node ? lt('backTo', { name: displayName(back.node, lang) }) : lt('allLocations')}
            className="flex items-center rounded-pill border border-primary py-1 pl-1 pr-2.5 text-primary hover:bg-inputBackground"
          >
            <ChevronLeft size={14} />
            {back.node ? displayName(back.node, lang) : lt('allLocations')}
          </button>
          {back.node && (
            <button onClick={() => onChange(null)} className="text-primary">
              {lt('allLocations')}
            </button>
          )}
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-textMuted" />
              <button onClick={() => onChange(c.id)} className={i === crumbs.length - 1 ? 'text-textSecondary' : 'text-primary'}>
                {displayName(c, lang)}
              </button>
            </span>
          ))}
        </div>
      )}
      <div ref={stripRef} className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
        {options.map((opt) => {
          const active = scopeId === opt.id;
          return (
            <button
              key={opt.id ?? 'all'}
              onClick={() => {
                restoreFocus.current = true;
                // Only a change made by this click may move focus (cleared next frame).
                requestAnimationFrame(() => (restoreFocus.current = false));
                onChange(opt.id);
              }}
              aria-pressed={active}
              className={`flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${
                active ? 'border-primary bg-primary text-primaryText' : 'border-border bg-surface text-textPrimary'
              }`}
            >
              <MapPin size={14} className={active ? 'text-primaryText' : 'text-primary'} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {open && (
        // Anchored to the top on phones (a bottom sheet would sit under the on-screen keyboard); centred on desktop. Height follows the dynamic viewport, never a fixed pixel size.
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 md:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={lt('changeLocation')}>
          <div className="max-h-[100dvh] w-full max-w-md overflow-y-auto rounded-b-xl bg-surface p-5 pb-6 shadow-md md:max-h-[90dvh] md:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex justify-end">
              <button onClick={() => setOpen(false)} aria-label={t('common.close')} className="rounded-full p-1 hover:bg-inputBackground">
                <X size={18} className="text-textMuted" />
              </button>
            </div>
            <LocationPicker
              directory={directory}
              selected={node?.name ?? null}
              allowRequest={false}
              onSelect={(loc) => {
                onChange(loc.id);
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
