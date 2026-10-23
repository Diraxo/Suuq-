import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { createLatestGuard } from '@/lib/refreshController';
import { COORD_COLUMNS, EMPTY_INDEX, LOCATION_COLUMNS, LocCoord, LocIndex, LocRow, buildIndex, coordsFromRows, effectiveFor, findByName, rowToNode } from '@/lib/locationTree';

// The shared, admin-managed location directory (public.locations): every
// country, plus regions and cities where we have them. This is the single
// source for every location choice in the app — Home filter, Sell, Edit
// Listing, Edit Profile, bulk upload. Only approved rows are readable by the
// client (RLS), so pending/inactive entries never show up here. The last good
// copy is cached so the pickers still work offline.
const CACHE_KEY = '@suuq/locationsDirectory:v2';
// Admin-verified city coordinates (public.location_coordinates, migration 0061), keyed by directory id.
// Separate query and cache so the directory itself never depends on them: before 0061 exists the read
// fails, `coords` stays empty and "near me" uses the built-in fallback list.
const COORDS_CACHE_KEY = '@suuq/locationCoords:v1';

type LocationsState = {
  index: LocIndex;
  /** 'idle' → never loaded, 'ready' → have data (fresh or cached), 'error' → nothing to show. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** True when the last network refresh failed but cached data is being shown. */
  stale: boolean;
  /** Verified city coordinates by directory id; empty when none exist or the table is unavailable. Rows are re-validated on every read. */
  coords: Map<string, LocCoord>;
  /** Resolves once the coordinate read has settled (or after `timeoutMs`), so a "near me" tap on a cold start does not use only the fallback. Never rejects. */
  ensureCoords: (timeoutMs?: number) => Promise<Map<string, LocCoord>>;
  /** Loads the directory. Overlapping calls share the running request; { force: true } (Home refresh/Retry) starts a new one, and the older response is then discarded. */
  load: (opts?: { force?: boolean }) => Promise<void>;
};

// Newest-wins: a slow or abandoned directory response never overwrites a newer one.
const loadGuard = createLatestGuard();
const coordsGuard = createLatestGuard();
let coordsInFlight: Promise<void> | null = null;

export const useLocationsStore = create<LocationsState>((set, get) => ({
  index: EMPTY_INDEX,
  status: 'idle',
  stale: false,
  coords: new Map(),
  ensureCoords: async (timeoutMs = 3000) => {
    if (coordsInFlight) {
      await Promise.race([coordsInFlight, new Promise((r) => setTimeout(r, timeoutMs))]);
    }
    return get().coords;
  },
  load: async (opts) => {
    if (get().status === 'loading' && !opts?.force) return;
    const ticket = loadGuard.next();
    if (get().index.nodes.length === 0) {
      // Paint from cache immediately while the refresh runs.
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) set({ index: buildIndex((JSON.parse(cached) as LocRow[]).map(rowToNode)), status: 'ready' });
      } catch {
        /* cache is best-effort */
      }
    }
    if (!loadGuard.isLatest(ticket)) return;
    if (get().status !== 'ready') set({ status: 'loading' });
    const { data, error } = await supabase.from('locations').select(LOCATION_COLUMNS).eq('status', 'approved').limit(5000);
    if (!loadGuard.isLatest(ticket)) return;
    if (error || !data) {
      const have = get().index.nodes.length > 0;
      set({ status: have ? 'ready' : 'error', stale: have });
      return;
    }
    set({ index: buildIndex((data as LocRow[]).map(rowToNode)), status: 'ready', stale: false });
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
    // Not awaited: coordinates must never delay or fail the directory.
    const run = loadCoords(set, get);
    coordsInFlight = run;
    run.finally(() => {
      if (coordsInFlight === run) coordsInFlight = null;
    });
  },
}));

async function loadCoords(set: (p: Partial<LocationsState>) => void, get: () => LocationsState): Promise<void> {
  const ticket = coordsGuard.next();
  if (get().coords.size === 0) {
    try {
      const cached = await AsyncStorage.getItem(COORDS_CACHE_KEY);
      if (cached && coordsGuard.isLatest(ticket)) set({ coords: coordsFromRows(JSON.parse(cached)) });
    } catch {
      /* cache is best-effort */
    }
  }
  try {
    const { data, error } = await supabase.from('location_coordinates').select(COORD_COLUMNS).limit(5000);
    if (!coordsGuard.isLatest(ticket)) return;
    if (error || !Array.isArray(data)) return; // e.g. table not created yet — keep the cached/empty map and the fallback list
    const coords = coordsFromRows(data);
    set({ coords });
    AsyncStorage.setItem(COORDS_CACHE_KEY, JSON.stringify(data)).catch(() => {});
  } catch {
    /* network failure: keep what we have */
  }
}

/** Currency options for a place name (a listing's stored location). Falls back to the caller's default when it isn't in the approved directory yet (e.g. a pending location). */
export function currenciesForPlace(name: string | undefined | null, fallback?: string) {
  const { index } = useLocationsStore.getState();
  const node = findByName(index, name);
  if (!node) return { currencies: fallback ? [fallback] : ['USD'], defaultCurrency: fallback ?? 'USD', regionLabel: '' };
  return effectiveFor(index, node.id);
}

/** listings.region value for a place name ('' when unknown). */
export function regionForCity(name: string | undefined | null): string {
  const { index } = useLocationsStore.getState();
  const node = findByName(index, name);
  return node ? effectiveFor(index, node.id).regionLabel : '';
}

export type SubmittedLocation = {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'inactive' | 'rejected';
  currencies: string[];
  defaultCurrency: string;
  regionLabel: string;
};

/**
 * Ask admins to add a missing city under a region (or country). Reuses an
 * existing record when one already matches (so users never create duplicates)
 * and returns it — the caller keeps going with the returned name/currencies
 * while the request is pending.
 */
export async function submitLocationRequest(name: string, parentId: string): Promise<SubmittedLocation> {
  const { data, error } = await supabase.rpc('submit_location_request', { p_name: name, p_parent_id: parentId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; name: string; status: SubmittedLocation['status']; currency_codes: string[] | null; default_currency: string | null; region_label: string | null }
    | undefined;
  if (!row) throw new Error('Location request returned no data');
  const currencies = row.currency_codes?.length ? row.currency_codes : ['USD'];
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    currencies,
    defaultCurrency: row.default_currency ?? currencies[0],
    regionLabel: row.region_label ?? '',
  };
}
