'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { COORD_COLUMNS, EMPTY_INDEX, LOCATION_COLUMNS, LocCoord, LocIndex, LocRow, buildIndex, coordsFromRows, rowToNode, validCoord } from '@/lib/locationTree';

// The shared, admin-managed location directory (public.locations): every
// country, plus regions and cities where we have them — the one source for
// every location choice on the web (Home filter, Sell, Edit Listing) and the
// same table the mobile app reads. RLS only exposes approved rows to the
// client; pending/inactive/rejected entries are admin-only (see
// supabase/migrations/0032_locations_directory.sql).

export type PickedLocation = {
  /** Directory id of the chosen place (for a pending request: the new request's id). */
  id: string;
  /** Canonical English name — what gets stored on the listing. */
  name: string;
  regionLabel: string;
  /** Currencies a seller may price in at this place. */
  currencies: string[];
  defaultCurrency: string;
  /** Awaiting admin approval — still usable for the listing. */
  pending: boolean;
};

export type LocationsState = {
  index: LocIndex;
  status: 'loading' | 'ready' | 'error';
  /** Admin-verified city coordinates by directory id (migration 0061). Empty until they load, or when the table does not exist yet — "near me" then uses its built-in fallback list. */
  coords: Map<string, LocCoord>;
  reload: () => void;
};

// Bumped by Home's refresh/reset so every mounted directory refetches in place.
const useDirectoryReload = create<{ nonce: number }>(() => ({ nonce: 0 }));
export function reloadLocationDirectory() {
  useDirectoryReload.setState((s) => ({ nonce: s.nonce + 1 }));
}

/** Fetches the approved directory on mount (always fresh — a newly approved place appears on the next page load, no deploy needed). */
export function useLocations(): LocationsState {
  // The last settled fetch and the nonce it answered. "loading" is derived (no
  // result yet for the current nonce) instead of being set from inside the
  // effect, so a reload keeps showing the previous index while it refetches.
  const [result, setResult] = useState<{ nonce: number; status: 'ready' | 'error'; index: LocIndex } | null>(null);
  const [localNonce, setNonce] = useState(0);
  const sharedNonce = useDirectoryReload((s) => s.nonce);
  const nonce = localNonce + sharedNonce;

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('locations')
      .select(LOCATION_COLUMNS)
      .eq('status', 'approved')
      .limit(5000)
      .then(({ data, error }) => {
        if (cancelled) return;
        setResult((prev) =>
          error || !data
            ? { nonce, status: 'error', index: prev?.index ?? EMPTY_INDEX }
            : { nonce, status: 'ready', index: buildIndex((data as LocRow[]).map(rowToNode)) }
        );
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Coordinates load on their own so a missing table (before 0061) or a failed read never touches the directory.
  const [coords, setCoords] = useState<Map<string, LocCoord>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('location_coordinates')
      .select(COORD_COLUMNS)
      .limit(5000)
      .then(({ data, error }) => {
        if (!cancelled && !error && Array.isArray(data)) setCoords(coordsFromRows(data));
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const index = result?.index ?? EMPTY_INDEX;
  const status: LocationsState['status'] = result && result.nonce === nonce ? result.status : 'loading';
  return { index, status, coords, reload: () => setNonce((n) => n + 1) };
}

export async function submitLocationRequest(name: string, parentId: string): Promise<PickedLocation> {
  const { data, error } = await supabase.rpc('submit_location_request', { p_name: name, p_parent_id: parentId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; name: string; status: string; currency_codes: string[] | null; default_currency: string | null; region_label: string | null }
    | undefined;
  if (!row) throw new Error('Location request returned no data');
  const currencies = row.currency_codes?.length ? row.currency_codes : ['USD'];
  return {
    id: row.id,
    name: row.name,
    regionLabel: row.region_label ?? '',
    currencies,
    defaultCurrency: row.default_currency ?? currencies[0],
    pending: row.status !== 'approved',
  };
}

// ---------------------------------------------------------------------------
// Admin (every call is gated by is_admin() inside the SECURITY DEFINER RPCs)
// ---------------------------------------------------------------------------
export type AdminLocation = {
  id: string;
  kind: 'country' | 'region' | 'city';
  name: string;
  parentId: string | null;
  parentName: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'inactive';
  isAppRegion: boolean;
  isFeatured: boolean;
  iso2: string | null;
  currencyCodes: string[] | null;
  defaultCurrency: string | null;
  nameSo: string | null;
  nameAm: string | null;
  aliases: string[] | null;
  requesterName: string | null;
  rejectionReason: string | null;
  mergedIntoId: string | null;
  createdAt: string;
  listingCount: number;
};

export async function adminListLocations(): Promise<{ rows: AdminLocation[]; error?: string }> {
  const { data, error } = await supabase.rpc('admin_list_locations', { p_status: null });
  if (error) return { rows: [], error: error.message };
  type R = {
    id: string;
    kind: AdminLocation['kind'];
    name: string;
    parent_id: string | null;
    parent_name: string | null;
    status: AdminLocation['status'];
    is_app_region: boolean;
    is_featured: boolean;
    iso2: string | null;
    currency_codes: string[] | null;
    default_currency: string | null;
    name_so: string | null;
    name_am: string | null;
    aliases: string[] | null;
    requester_name: string | null;
    rejection_reason: string | null;
    merged_into_id: string | null;
    created_at: string;
    listing_count: number | string;
  };
  return {
    rows: ((data ?? []) as R[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      parentId: r.parent_id,
      parentName: r.parent_name,
      status: r.status,
      isAppRegion: r.is_app_region,
      isFeatured: r.is_featured,
      iso2: r.iso2,
      currencyCodes: r.currency_codes,
      defaultCurrency: r.default_currency,
      nameSo: r.name_so,
      nameAm: r.name_am,
      aliases: r.aliases,
      requesterName: r.requester_name,
      rejectionReason: r.rejection_reason,
      mergedIntoId: r.merged_into_id,
      createdAt: r.created_at,
      listingCount: Number(r.listing_count),
    })),
  };
}

export type SaveLocationInput = {
  id: string | null;
  kind: 'country' | 'region' | 'city';
  name: string;
  parentId: string | null;
  currencyCodes: string[] | null;
  defaultCurrency: string | null;
  nameSo: string;
  nameAm: string;
  aliases: string[] | null;
  isAppRegion: boolean;
  isFeatured: boolean;
};

export async function adminSaveLocation(input: SaveLocationInput): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_save_location', {
    p_id: input.id,
    p_kind: input.kind,
    p_name: input.name,
    p_parent_id: input.parentId,
    p_currency_codes: input.currencyCodes,
    p_default_currency: input.defaultCurrency,
    p_name_so: input.nameSo,
    p_name_am: input.nameAm,
    p_aliases: input.aliases,
    p_is_app_region: input.isAppRegion,
    p_is_featured: input.isFeatured,
  });
  return error ? { error: error.message } : {};
}

export async function adminReviewLocation(
  id: string,
  action: 'approve' | 'reject' | 'deactivate' | 'reactivate' | 'delete',
  reason?: string,
  newName?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_review_location', {
    p_id: id,
    p_action: action,
    p_reason: reason ?? null,
    p_new_name: newName ?? null,
  });
  return error ? { error: error.message } : {};
}

/** Deletes a place and everything below it. Listings are kept (they just stop matching location filters). */
export async function adminDeleteLocation(id: string, reason?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_delete_location', { p_id: id, p_reason: reason ?? null });
  return error ? { error: error.message } : {};
}

export async function adminMergeLocation(id: string, targetId: string, reason?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_merge_location', { p_id: id, p_target_id: targetId, p_reason: reason ?? null });
  return error ? { error: error.message } : {};
}

/** Admin: every coordinate row, including cities that are not approved yet. `unavailable` = migration 0061 not applied. */
export async function adminListLocationCoordinates(): Promise<{ coords: Map<string, LocCoord>; unavailable?: boolean }> {
  const { data, error } = await supabase.rpc('admin_list_location_coordinates');
  if (error || !Array.isArray(data)) return { coords: new Map(), unavailable: true };
  return {
    coords: coordsFromRows((data as { location_id: string; latitude: number; longitude: number }[]).map((r) => ({ location_id: r.location_id, latitude: r.latitude, longitude: r.longitude }))),
  };
}

/** Parses admin input. Both empty = clear. Returns the same limits the database enforces. */
export function parseCoordinateInput(latText: string, lngText: string): { clear: true } | { lat: number; lng: number } | { error: string } {
  const a = latText.trim();
  const b = lngText.trim();
  if (!a && !b) return { clear: true };
  if (!a || !b) return { error: 'Enter both latitude and longitude, or leave both empty.' };
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'Latitude and longitude must be numbers.' };
  if (!validCoord(lat, lng)) return { error: 'These coordinates are outside the supported area (Ethiopia, Somaliland, Somalia) or are 0, 0.' };
  return { lat, lng };
}

export async function adminSetLocationCoordinates(id: string, lat: number | null, lng: number | null, reason?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_set_location_coordinates', {
    p_id: id,
    p_latitude: lat,
    p_longitude: lng,
    p_reason: reason ?? null,
  });
  return error ? { error: error.message } : {};
}
