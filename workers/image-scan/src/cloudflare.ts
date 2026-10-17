// Cloudflare + Supabase adapters for pipeline.ts `Deps`.
//
// UNVERIFIED: this file has never run against real Cloudflare or Supabase. It is typed against the minimal
// shapes declared below (the repo has no @cloudflare/workers-types dependency). The riskiest assumptions,
// to be checked first in staging:
//   1. IMAGES.input().draw() accepts an SVG overlay AND the Images renderer has a font for <text>.
//      If not, ship a pre-rendered PNG tile (generated from the approved brand font) as a Worker asset.
//   2. IMAGES output format 'rgba' (raw pixels) is available — used to compute the perceptual hash.
//   3. EXIF orientation is applied and metadata (GPS) is stripped by the transform.
// Free-plan CPU (10 ms) is too small for 8 photos; plan on Workers Paid.

import { grayFromRgba, watermarkLayout, WATERMARK_TEXT } from '../../../lib/imageSafety';
import type { BulkQueueDb, BulkRow } from './bulk';
import { ScanError, markIsPresent, type Deps, type Normalized, type PublicResult, type SaveResult } from './pipeline';
import { TILE_FONT_SIZE, TILE_PNG_BASE64, TILE_W } from './tile.generated';

type R2Bucket = {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};
type ImagesBinding = {
  input(stream: ReadableStream): ImageTransformer;
  info(stream: ReadableStream): Promise<{ width: number; height: number; format: string }>;
};
type ImageTransformer = {
  transform(opts: Record<string, unknown>): ImageTransformer;
  draw(overlay: ImageTransformer, opts?: Record<string, unknown>): ImageTransformer;
  output(opts: { format: string; quality?: number }): Promise<{ response(): Response }>;
};

export type Env = {
  ORIGINALS: R2Bucket; // PRIVATE bucket: originals, held derivatives (pending/…)
  PUBLIC: R2Bucket; // public bucket (served from PUBLIC_BASE_URL): wm/… only
  IMAGES: ImagesBinding;
  PUBLIC_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string; // secret
  SUPABASE_ANON_KEY: string;
  VISION_API_KEY: string; // secret
  ALLOWED_ORIGINS?: string;
  /** 'svg' (default: try the SVG text overlay, fall back to the pre-rendered tile), 'tile' (tile only), 'svg-only'. */
  WATERMARK_MODE?: string;
  /** 'true' once migration 0051 is applied and the bulk queue is switched on for this Worker (also gates the scheduled handler). */
  BULK_ENABLED?: string;
  /** Rows claimed per cron run (default 4). */
  BULK_CLAIM_LIMIT?: string;
  /** 'delete' removes the private original of a prohibited/weapon reject at once. Default 'retain' — see pipeline.ts. */
  REJECTED_ORIGINAL_POLICY?: string;
};

const stream = (bytes: Uint8Array) => new Response(bytes as unknown as BodyInit).body as ReadableStream;
const bytesOf = async (r: Response) => new Uint8Array(await r.arrayBuffer());

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function createImaging(env: Env): Pick<Deps, 'normalize' | 'thumbGray' | 'watermark' | 'info'> {
  const info = async (bytes: Uint8Array) => {
    const i = await env.IMAGES.info(stream(bytes));
    return { width: i.width, height: i.height };
  };
  const thumbGray = async (bytes: Uint8Array, w: number, h: number) => {
    const out = await (await env.IMAGES.input(stream(bytes)).transform({ width: w, height: h, fit: 'squeeze' }).output({ format: 'rgba' })).response();
    return grayFromRgba(await bytesOf(out), w * h);
  };

  /** Primary: SVG text drawn over the picture. Needs the Images renderer to have a font for <text> — unverified. */
  const svgMark = async (norm: Normalized) => {
    const l = watermarkLayout(norm.width, norm.height);
    const texts = l.items
      .map((p) => `<text x="${p.x}" y="${p.y}" font-size="${l.fontSize}" font-weight="700" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${WATERMARK_TEXT}</text>`)
      .join('');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${norm.width}" height="${norm.height}" viewBox="0 0 ${norm.width} ${norm.height}">` +
      `<g transform="translate(${norm.width / 2} ${norm.height / 2}) rotate(${l.angle})" fill="#fff" fill-opacity="${l.opacity}" stroke="#000" stroke-opacity="${(l.opacity * 0.6).toFixed(2)}" stroke-width="${(l.fontSize * 0.04).toFixed(1)}" paint-order="stroke">${texts}</g></svg>`;
    const overlay = env.IMAGES.input(stream(new TextEncoder().encode(svg)));
    const out = await (await env.IMAGES.input(stream(norm.bytes)).draw(overlay, { opacity: 1 }).output({ format: 'image/jpeg', quality: 85 })).response();
    return bytesOf(out);
  };

  /** Fallback: the pre-rendered seamless PNG tile (scripts/build-watermark-tile.mjs), scaled to the same text size and repeated. No fonts involved. */
  const tileMark = async (norm: Normalized) => {
    const scale = watermarkLayout(norm.width, norm.height).fontSize / TILE_FONT_SIZE;
    const tileWidth = Math.max(32, Math.round(TILE_W * scale));
    const tile = env.IMAGES.input(stream(fromBase64(TILE_PNG_BASE64))).transform({ width: tileWidth });
    const out = await (await env.IMAGES.input(stream(norm.bytes)).draw(tile, { repeat: true, opacity: 1 }).output({ format: 'image/jpeg', quality: 85 })).response();
    return bytesOf(out);
  };

  return {
    info,
    thumbGray,
    async normalize(bytes): Promise<Normalized> {
      const out = await (await env.IMAGES.input(stream(bytes)).transform({ width: 1600, height: 1600, fit: 'scale-down' }).output({ format: 'image/jpeg', quality: 85 })).response();
      const jpeg = await bytesOf(out);
      const i = await info(jpeg);
      return { bytes: jpeg, width: i.width, height: i.height };
    },
    async watermark(norm) {
      const mode = env.WATERMARK_MODE ?? 'svg';
      const order = mode === 'tile' ? [tileMark] : mode === 'svg-only' ? [svgMark] : [svgMark, tileMark];
      const before = await thumbGray(norm.bytes, 32, 32);
      let lastError: unknown;
      for (const attempt of order) {
        try {
          const bytes = await attempt(norm);
          const size = await info(bytes);
          // A renderer that silently draws nothing (missing font) or resizes the picture counts as failed → try the next.
          if (size.width === norm.width && size.height === norm.height && markIsPresent(before, await thumbGray(bytes, 32, 32))) return bytes;
        } catch (e) {
          lastError = e;
        }
      }
      throw new ScanError('internal', 'No watermark renderer produced a verified result', { lastError: String(lastError) });
    },
  };
}

export function createStorage(env: Env): Deps['storage'] & { getPrivate(key: string): Promise<Uint8Array | null> } {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return {
    putPrivate: async (key, bytes) => { await env.ORIGINALS.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } }); },
    putPublic: async (key, bytes) => {
      await env.PUBLIC.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } });
      return `${base}/${key}`;
    },
    publicUrl: (key) => `${base}/${key}`,
    deletePrivate: async (key) => { await env.ORIGINALS.delete(key); },
    getPrivate: async (key) => {
      const o = await env.ORIGINALS.get(key);
      return o ? new Uint8Array(await o.arrayBuffer()) : null;
    },
  };
}

/** Bulk queue RPCs (migration 0051), service role only. */
export function createBulkDb(env: Env): BulkQueueDb {
  const rpc = async (fn: string, body: Record<string, unknown>) => {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`supabase rpc ${fn} ${res.status}`);
    return res;
  };
  return {
    async claim(limit) {
      return (await (await rpc('claim_bulk_rows', { p_limit: limit })).json()) as BulkRow[];
    },
    async complete({ rowId, status, scanId, imageUrls }) {
      await rpc('complete_bulk_row', { p_row: rowId, p_status: status, p_scan: scanId, p_image_urls: imageUrls });
    },
    async fail(rowId, code, retryable) {
      await rpc('fail_bulk_row', { p_row: rowId, p_error: code, p_retryable: retryable });
    },
  };
}

export function createDb(env: Env): Deps['db'] {
  const rest = async (path: string, init: RequestInit & { count?: boolean } = {}) => {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
    });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    return res;
  };
  const iso = (ms: number) => encodeURIComponent(new Date(ms).toISOString());
  const countOf = (res: Response) => Number(res.headers.get('content-range')?.split('/')[1] ?? 0);

  return {
    async openScan({ userId, listingId, fingerprint, category, source }) {
      const ins = await rest('listing_scans?on_conflict=user_id,listing_id,fingerprint', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        // `source` is only sent for bulk: the column exists from migration 0051, and interactive scans must keep working before it.
        body: JSON.stringify({ user_id: userId, listing_id: listingId, fingerprint, category, ...(source === 'bulk' ? { source } : {}) }),
      });
      const created = (await ins.json()) as { id: string }[];
      if (created.length) return { scanId: created[0].id };
      const got = await rest(`listing_scans?user_id=eq.${userId}&listing_id=eq.${listingId}&fingerprint=eq.${fingerprint}&select=id,status,result,created_at`);
      const row = ((await got.json()) as { id: string; status: string; result: PublicResult | null; created_at: string }[])[0];
      if (!row) throw new Error('scan row vanished');
      if (row.result && row.status !== 'processing') return { scanId: row.id, existing: row.result };
      // Another request is working on the very same photos: don't spend twice. A stale one (crashed) is retried.
      if (Date.now() - Date.parse(row.created_at) < 120_000) throw new ScanError('in_progress', 'Scan already running');
      return { scanId: row.id };
    },
    async recentScanCount(userId, sinceMs) {
      // With the bulk queue on (0051 applied), bulk scans must not use up the interactive allowance.
      const only = env.BULK_ENABLED === 'true' ? '&source=eq.interactive' : '';
      return countOf(await rest(`listing_scans?user_id=eq.${userId}&created_at=gte.${iso(sinceMs)}${only}&select=id`, { method: 'HEAD', headers: { Prefer: 'count=exact' } }));
    },
    async recentDuplicateHits(userId, sinceMs) {
      return countOf(
        await rest(`listing_scan_images?select=id,listing_scans!inner(user_id,created_at)&issues=cs.{duplicate_listing}&listing_scans.user_id=eq.${userId}&listing_scans.created_at=gte.${iso(sinceMs)}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } }),
      );
    },
    async findSimilar(phash, userId, max, excludeListing) {
      const res = await rest('rpc/find_similar_images', { method: 'POST', body: JSON.stringify({ p_phash: phash, p_user: userId, p_max: max, p_exclude_listing: excludeListing }) });
      return ((await res.json()) as { distance: number; same_owner: boolean }[]).map((r) => ({ distance: r.distance, sameOwner: r.same_owner }));
    },
    async saveResult(a: SaveResult) {
      await rest('listing_scan_images?on_conflict=scan_id,slot', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(
          a.images.map((i) => ({
            scan_id: a.scanId, slot: i.slot, source_key: i.sourceKey, public_key: i.publicKey, public_url: i.publicUrl, sha256: i.sha256, phash: i.phash,
            verdict: i.verdict, issues: i.issues, internal: i.internal, review_status: i.verdict === 'review' ? 'pending' : 'not_needed',
          })),
        ),
      });
      const keep = a.images.filter((i) => i.verdict !== 'reject');
      if (keep.length) {
        await rest('image_hashes', { method: 'POST', body: JSON.stringify(keep.map((i) => ({ phash: i.phash, sha256: i.sha256, user_id: a.userId, listing_id: a.listingId }))) });
      }
      await rest(`listing_scans?id=eq.${a.scanId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: a.status, flagged_for_staff: a.flagged, result: a.result, completed_at: new Date().toISOString() }),
      });
    },
  };
}
