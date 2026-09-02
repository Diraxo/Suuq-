'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CameraIcon, X, CheckCircle2 } from '@/lib/icons';
import { CategoryIcon } from '@/lib/icons';
import { categories, cities, cityCurrency, cityRegion } from '@/lib/categories';
import { StepHeader } from '@/components/StepHeader';
import { Button } from '@/components/Button';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { uploadToR2, deleteFromR2, type UploadedImage } from '@/services/r2';
import { createListing } from '@/services/listings';
import { toAppError, isAppError, logError, type AppError } from '@/lib/errors';
import { isBackendReachable, isOnline } from '@/lib/network';
import { uuidv4 } from '@/lib/uuid';
import { ErrorNotice } from '@/components/ErrorNotice';

type Condition = 'new' | 'like-new' | 'used' | 'for-parts';

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'like-new', label: 'Like new' },
  { value: 'used', label: 'Used' },
  { value: 'for-parts', label: 'For parts' },
];

const TOTAL_STEPS = 6;

// Mirrors the mobile Sell flow's conceptual steps (app/post/*.tsx): Photos →
// Category → Details → Location & Price → Preview → Success. Phase 2:
// publishes for real — photos upload to the same Cloudflare R2 bucket via
// the shared r2-presign Edge Function, then the listing row is inserted
// into the same `listings` table the mobile app reads from.
export default function SellPage() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState<Condition>('used');
  const [city, setCity] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [negotiable, setNegotiable] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<AppError | null>(null);
  // Kept stable across publish retries: a lost response on an attempt that
  // actually committed must not create a second listing or re-upload photos.
  const listingIdRef = useRef<string | null>(null);
  const uploadedUrlsRef = useRef<string[] | null>(null);
  // Parallel to uploadedUrlsRef — the R2 object keys for the same images, kept
  // so a failed / abandoned publish can drop the objects it uploaded instead
  // of orphaning them in the bucket.
  const uploadedKeysRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (!session) requireAuth(() => {}, { next: '/sell' });
  }, [session]);

  useEffect(() => {
    return () => {
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
      // Seller navigated away from the Sell flow after photos uploaded but
      // before a listing committed (on a successful publish the refs are
      // cleared first, so this is a no-op then). Best-effort — never awaited.
      if (uploadedKeysRef.current?.length) {
        void deleteFromR2(uploadedKeysRef.current);
        uploadedKeysRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return <div className="min-h-[50vh]" />;

  const selectedCategory = categories.find((c) => c.id === category);
  const close = () => router.push('/');
  const back = () => setStep((s) => Math.max(1, s - 1));
  const next = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files).slice(0, 8 - photoFiles.length);
    setPhotoFiles((p) => [...p, ...picked].slice(0, 8));
    setPhotoPreviews((p) => [...p, ...picked.map((f) => URL.createObjectURL(f))].slice(0, 8));
  };

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(photoPreviews[i]);
    setPhotoFiles((p) => p.filter((_, idx) => idx !== i));
    setPhotoPreviews((p) => p.filter((_, idx) => idx !== i));
  };

  const publish = async () => {
    if (!city || !category) return;
    setPublishing(true);
    setPublishError(null);
    try {
      // Fast offline / unreachable pre-check — surfaces the right message
      // immediately instead of after a long fetch timeout. navigator.onLine
      // alone isn't trusted (see lib/network.ts), so this is a real probe.
      if (!(await isBackendReachable())) {
        throw toAppError(new Error('Pre-flight connectivity probe failed'), {
          kind: isOnline() ? 'backend-unavailable' : 'offline',
        });
      }

      if (!listingIdRef.current) listingIdRef.current = uuidv4();

      if (!uploadedUrlsRef.current) {
        // allSettled (not Promise.all) so a partial failure still tells us
        // exactly which objects made it to R2 — those get cleaned up before
        // the error surfaces, and the refs stay null so the retry re-uploads
        // a clean set rather than leaving orphans behind.
        const results = await Promise.allSettled(
          photoFiles.map((f) => uploadToR2(f, `listings/${session.user.id}`))
        );
        const done: UploadedImage[] = results
          .filter((r): r is PromiseFulfilledResult<UploadedImage> => r.status === 'fulfilled')
          .map((r) => r.value);
        const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failure) {
          if (done.length) void deleteFromR2(done.map((u) => u.key));
          throw toAppError(failure.reason, { fallbackKind: 'upload-failed' });
        }
        uploadedUrlsRef.current = done.map((u) => u.url);
        uploadedKeysRef.current = done.map((u) => u.key);
      }

      const { error } = await createListing(session.user.id, {
        id: listingIdRef.current,
        title: title.trim(),
        description: description.trim(),
        category,
        subcategory,
        condition,
        price: Number(price),
        currency: cityCurrency[city] ?? 'ETB',
        city,
        region: cityRegion[city] ?? '',
        images: uploadedUrlsRef.current,
        negotiable,
      });
      if (error) throw error;

      // Published — reset the retry refs so "post another item" starts clean.
      // uploadedKeysRef is cleared here too so the unmount cleanup doesn't
      // delete the now-live listing's images when the seller leaves the page.
      listingIdRef.current = null;
      uploadedUrlsRef.current = null;
      uploadedKeysRef.current = null;
      setStep(6);
    } catch (err) {
      logError('sell/publish', err);
      setPublishError(isAppError(err) ? err : toAppError(err));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-2 md:px-0">
      {step === 1 && (
        <>
          <StepHeader step={1} totalSteps={TOTAL_STEPS} title="Add photos" subtitle="Great photos help your item sell faster." onClose={close} />
          <p className="mb-2 text-xs text-textMuted">Up to 8 photos. First photo is your cover.</p>
          <div className="grid grid-cols-3 gap-2">
            {photoPreviews.map((uri, i) => (
              <div key={uri} className="relative aspect-square overflow-hidden rounded-md border border-border bg-inputBackground">
                <Image src={uri} alt={`Photo ${i + 1}`} fill className="object-cover" unoptimized />
                {i === 0 && <span className="absolute left-1 top-1 rounded-pill bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primaryText">COVER</span>}
                <button
                  onClick={() => removePhoto(i)}
                  aria-label="Remove photo"
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {photoPreviews.length < 8 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary bg-inputBackground"
              >
                <CameraIcon size={22} className="text-primary" />
                <span className="text-xs font-semibold text-primary">Add photos</span>
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
          <Button fullWidth size="lg" className="mt-8" disabled={photoPreviews.length === 0} onClick={next}>
            Continue
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <StepHeader step={2} totalSteps={TOTAL_STEPS} title="Choose a category" onClose={back} />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setCategory(cat.id);
                  setSubcategory(null);
                }}
                className={`flex flex-col items-center gap-1.5 rounded-md border p-3 ${category === cat.id ? 'border-primary bg-primary/10' : 'border-border bg-surface'}`}
              >
                <CategoryIcon icon={cat.icon} size={20} className="text-primary" />
                <span className="text-center text-[11px] text-textPrimary">{cat.name}</span>
              </button>
            ))}
          </div>
          {!!selectedCategory?.subcategories?.length && (
            <>
              <p className="mb-2 mt-6 text-sm font-semibold text-textPrimary">Subcategory</p>
              <div className="flex flex-wrap gap-2">
                {selectedCategory.subcategories.map((sub) => (
                  <button
                    key={sub.name}
                    onClick={() => setSubcategory(sub.name)}
                    className={`rounded-pill px-3 py-1.5 text-sm ${subcategory === sub.name ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
                  >
                    {sub.name}
                  </button>
                ))}
              </div>
            </>
          )}
          <Button fullWidth size="lg" className="mt-8" disabled={!category} onClick={next}>
            Continue
          </Button>
        </>
      )}

      {step === 3 && (
        <>
          <StepHeader step={3} totalSteps={TOTAL_STEPS} title="Describe your item" onClose={back} />
          <label className="mb-1 block text-sm font-medium text-textPrimary">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Samsung Galaxy A54 128GB"
            className="mb-4 w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <label className="mb-1 block text-sm font-medium text-textPrimary">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Describe the condition, any accessories included, and why someone should buy it."
            className="mb-4 w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <label className="mb-1 block text-sm font-medium text-textPrimary">Condition</label>
          <div className="flex flex-wrap gap-2">
            {CONDITIONS.map((c) => (
              <button
                key={c.value}
                onClick={() => setCondition(c.value)}
                className={`rounded-pill px-3 py-1.5 text-sm ${condition === c.value ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Button fullWidth size="lg" className="mt-8" disabled={!title.trim()} onClick={next}>
            Continue
          </Button>
        </>
      )}

      {step === 4 && (
        <>
          <StepHeader step={4} totalSteps={TOTAL_STEPS} title="Location & price" onClose={back} />
          <label className="mb-1 block text-sm font-medium text-textPrimary">City</label>
          <div className="mb-4 flex flex-wrap gap-2">
            {cities.map((c) => (
              <button
                key={c}
                onClick={() => setCity(c)}
                className={`rounded-pill px-3 py-1.5 text-sm ${city === c ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="mb-1 block text-sm font-medium text-textPrimary">Price (Birr)</label>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder="0"
            className="mb-3 w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input type="checkbox" checked={negotiable} onChange={(e) => setNegotiable(e.target.checked)} className="h-4 w-4 accent-primary" />
            Price is negotiable
          </label>
          <Button fullWidth size="lg" className="mt-8" disabled={!city || !price} onClick={next}>
            Continue
          </Button>
        </>
      )}

      {step === 5 && (
        <>
          <StepHeader step={5} totalSteps={TOTAL_STEPS} title="Preview" subtitle="This is how buyers will see your listing." onClose={back} />
          <div className="overflow-hidden rounded-lg bg-surface shadow-sm">
            {photoPreviews[0] && (
              <div className="relative aspect-[4/5] w-full bg-skeleton">
                <Image src={photoPreviews[0]} alt={title} fill className="object-cover" unoptimized />
              </div>
            )}
            <div className="p-3">
              <p className="truncate text-[15px] font-medium text-textPrimary">{title || 'Untitled listing'}</p>
              <p className="mt-0.5 text-lg font-bold text-primary">{price ? `${Number(price).toLocaleString('en-US')} Birr` : '—'}</p>
              <p className="mt-1 text-xs text-textMuted">{city ?? 'No city selected'}</p>
            </div>
          </div>
          {publishError && (
            <ErrorNotice
              className="mt-4"
              error={publishError}
              retrying={publishing}
              onRetry={publish}
              onSignIn={() => requireAuth(() => publish(), { next: '/sell' })}
            />
          )}
          <Button fullWidth size="lg" className="mt-8" loading={publishing} onClick={publish}>
            Publish listing
          </Button>
        </>
      )}

      {step === 6 && (
        <div className="flex flex-col items-center py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 size={32} className="text-success" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-textPrimary">Listing published</h1>
          <p className="mt-2 max-w-sm text-sm text-textSecondary">
            Your listing is live on SUUQIYE — visible in the app and on the web, right alongside everyone else&apos;s.
          </p>
          <Button className="mt-6" onClick={() => router.push('/')}>
            Back to home
          </Button>
        </div>
      )}
    </div>
  );
}
