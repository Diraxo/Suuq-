// Google Cloud Vision adapter. Mapping from the REST response to ProviderSignals is pure and unit tested
// with canned responses (tests/imageScanPipeline.test.ts). The network call itself has never been run against
// the real service — see docs/IMAGE_SAFETY.md ("verified vs unverified").
//
// Cost control: every photo gets LABEL + SAFE_SEARCH + TEXT (SafeSearch is billed free alongside Label
// Detection). OBJECT_LOCALIZATION, the most expensive feature, is only requested when the labels did not
// already show the photo is on topic for the chosen category.

import { CATEGORY_POLICY, POLICY, relevanceFor, type Likelihood, type ProviderSignals } from '../../../lib/imageSafety';

const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const LIKELIHOODS: Likelihood[] = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
const lk = (v: unknown): Likelihood => (LIKELIHOODS.includes(v as Likelihood) ? (v as Likelihood) : 'UNKNOWN');

type VisionResponse = {
  error?: { code?: number; message?: string };
  labelAnnotations?: { description?: string; score?: number }[];
  textAnnotations?: { description?: string }[];
  safeSearchAnnotation?: { adult?: string; violence?: string; racy?: string; medical?: string; spoof?: string };
  localizedObjectAnnotations?: { name?: string; score?: number; boundingPoly?: { normalizedVertices?: { x?: number; y?: number }[] } }[];
};

function boxArea(v?: { x?: number; y?: number }[]): number | undefined {
  if (!v || v.length < 3) return undefined;
  const xs = v.map((p) => p.x ?? 0);
  const ys = v.map((p) => p.y ?? 0);
  return Math.max(0, Math.max(...xs) - Math.min(...xs)) * Math.max(0, Math.max(...ys) - Math.min(...ys));
}

/** Pure: one Vision response (possibly merged from two calls) → the evidence shape the policy consumes. */
export function mapVisionResponse(res: VisionResponse): ProviderSignals {
  if (res.error) throw new Error(`vision error ${res.error.code ?? ''}`);
  const ss = res.safeSearchAnnotation;
  return {
    safeSearch: ss ? { adult: lk(ss.adult), violence: lk(ss.violence), racy: lk(ss.racy), medical: lk(ss.medical), spoof: lk(ss.spoof) } : undefined,
    labels: (res.labelAnnotations ?? []).map((l) => ({ name: l.description ?? '', score: l.score ?? 0 })).filter((l) => l.name),
    objects: (res.localizedObjectAnnotations ?? []).map((o) => ({ name: o.name ?? '', score: o.score ?? 0, area: boxArea(o.boundingPoly?.normalizedVertices) })).filter((o) => o.name),
    text: res.textAnnotations?.[0]?.description ?? '',
  };
}

/** Whether a second (Object Localization) call is worth paying for. */
export function needsObjectPass(signals: ProviderSignals, categoryId: string): boolean {
  const policy = CATEGORY_POLICY[categoryId];
  if (!policy || policy.lenient) return false;
  return relevanceFor(signals, categoryId) < POLICY.relevanceOk;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createVision(apiKey: string, categoryId: string, fetchImpl: typeof fetch = fetch) {
  const call = async (bytes: Uint8Array, features: { type: string; maxResults?: number }[], signal: AbortSignal): Promise<VisionResponse> => {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ requests: [{ image: { content: toBase64(bytes) }, features }] }),
      signal,
    });
    if (!res.ok) throw new Error(`vision http ${res.status}`);
    const body = (await res.json()) as { responses?: VisionResponse[] };
    const first = body.responses?.[0];
    if (!first) throw new Error('vision empty response');
    return first;
  };
  return {
    async analyze(bytes: Uint8Array, signal: AbortSignal): Promise<ProviderSignals> {
      const first = mapVisionResponse(
        await call(bytes, [{ type: 'LABEL_DETECTION', maxResults: 20 }, { type: 'SAFE_SEARCH_DETECTION' }, { type: 'TEXT_DETECTION' }], signal),
      );
      if (!needsObjectPass(first, categoryId)) return first;
      const objects = mapVisionResponse(await call(bytes, [{ type: 'OBJECT_LOCALIZATION', maxResults: 10 }], signal));
      return { ...first, objects: objects.objects };
    },
  };
}
