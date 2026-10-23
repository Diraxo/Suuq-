'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CameraIcon, X, CheckCircle2, ChevronLeft } from '@/lib/icons';
import { CategoryIcon } from '@/lib/icons';
import { categories } from '@/lib/categories';
import { getCategoryFields, visibleFields } from '@/lib/categoryFields';
import { getCategoryFeatures } from '@/lib/categoryFeatures';
import {
  DESCRIPTION_MAX_LENGTH,
  LISTING_CONDITIONS,
  MAX_LISTING_PHOTOS,
  SELLER_NOTES_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  conditionOptionsFor,
  isRentalListing,
  sanitizeAttributes,
  sanitizeFeatures,
  validateAttributes,
  validateCondition,
  validateCurrency,
  validateDescription,
  validateListingDraft,
  validatePrice,
  validateSellerNotes,
  validateTitle,
} from '@/lib/sellRules';
import { LocationPicker } from '@/components/LocationPicker';
import type { PickedLocation } from '@/services/locations';
import { formatMoney, currencyLabel } from '@/lib/currency';
import { useLocationText } from '@/lib/locationText';
import { StepHeader } from '@/components/StepHeader';
import { useT } from '@/lib/i18n';
import { categoryLabel, subcategoryLabel } from '@/lib/categoryNames';
import { localizeSellError, optionText, titlePlaceholderText } from '@/lib/sellText';
import { Button } from '@/components/Button';
import { SellField, focusSellField, sellFieldId } from '@/components/SellField';
import { useAuthStore } from '@/store/auth';
import { activeMode } from '@/lib/profileIdentity';
import { requireAuth } from '@/store/authPrompt';
import { uploadToR2, deleteFromR2, type UploadedImage } from '@/services/r2';
import { prepareSelection } from '@/services/imagePrep';
import { createListing } from '@/services/listings';
import { toAppError, isAppError, logError, type AppError } from '@/lib/errors';
import { isBackendReachable, isOnline } from '@/lib/network';
import { uuidv4 } from '@/lib/uuid';
import { ErrorNotice } from '@/components/ErrorNotice';
import { ImageScanDialog, type ImageScanDialogState } from '@/components/ImageScanDialog';
import { decidePublishPath, peekScanPolicy, resetScanCache, scanListingPhotos, ImageScanError } from '@/services/imageScan';
import { publishableUrls, keyFromUrl, type ScanResult } from '@/lib/imageScanState';
import { reviewPublishAllowed, scanBlockFromDbError } from '@/lib/imageScanPolicy';

type Condition = (typeof LISTING_CONDITIONS)[number];

const CONDITIONS: { value: Condition; labelKey: string }[] = [
  { value: 'new', labelKey: 'new' },
  { value: 'like-new', labelKey: 'likeNew' },
  { value: 'used', labelKey: 'used' },
  { value: 'for-parts', labelKey: 'needsRepair' },
];

const TOTAL_STEPS = 6;

const INPUT =
  'w-full rounded-md border bg-inputBackground px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary';
const pill = (selected: boolean) => `rounded-pill px-3 py-1.5 text-sm ${selected ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`;

type Photo = { id: string; file: File; preview: string };

// Mirrors the mobile Sell flow's steps (app/post/*.tsx): Photos → Category →
// Details → Location & Price → Preview → Success, with the SAME rules —
// lib/sellRules.ts and lib/categoryFields.ts are verbatim copies of the
// files the mobile app uses (data/sellRules.ts, data/categoryFields.ts), and
// the publish gate is the same validateListingDraft(). Photos are checked by
// their real bytes, decoded and re-encoded to JPEG in the browser before they
// can be added (services/imagePrep.ts), then uploaded to the same Cloudflare
// R2 bucket via the shared r2-presign Edge Function; the listing row is
// inserted into the same `listings` table the mobile app reads from.
export default function SellPage() {
  const router = useRouter();
  const t = useT();
  const L = (message?: string) => localizeSellError(t, message);
  const session = useAuthStore((s) => s.session);
  const ownProfile = useAuthStore((s) => s.profile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // No default — like mobile, the seller must actively choose a condition.
  const [condition, setCondition] = useState<Condition | undefined>(undefined);
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [features, setFeatures] = useState<string[]>([]);
  const [sellerNotes, setSellerNotes] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<string>('ETB');
  const { t: lt } = useLocationText();
  const [negotiable, setNegotiable] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<AppError | null>(null);
  // Server-side photo check (workers/image-scan). Whether it applies is decided by the SERVER's rollout mode.
  const [scanState, setScanState] = useState<ImageScanDialogState>({ kind: 'hidden' });
  // Which steps the seller has already tried to leave — errors for untouched
  // fields only appear after that (or on blur), never while first typing.
  const [attempted, setAttempted] = useState<{ details?: boolean; price?: boolean }>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [stepNotice, setStepNotice] = useState<string | null>(null);
  // Synchronous double-submit guard: `publishing` state only updates on the
  // next render, so two rapid clicks could both start an upload without this.
  const publishLock = useRef(false);
  // Kept stable across publish retries: a lost response on an attempt that
  // actually committed must not create a second listing or re-upload photos.
  const listingIdRef = useRef<string | null>(null);
  const uploadedUrlsRef = useRef<string[] | null>(null);
  // Parallel to uploadedUrlsRef — the R2 object keys for the same images, kept
  // so a failed / abandoned publish can drop the objects it uploaded instead
  // of orphaning them in the bucket.
  const uploadedKeysRef = useRef<string[] | null>(null);
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;

  useEffect(() => {
    if (!session) requireAuth(() => {}, { next: '/sell' });
  }, [session]);

  // No visible scrollbar on any Sell step. Only the bar is hidden: mouse wheel, touch, keyboard and focus scrolling all still work.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('no-scrollbar');
    return () => root.classList.remove('no-scrollbar');
  }, []);

  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
      // Seller navigated away from the Sell flow after photos uploaded but
      // before a listing committed (on a successful publish the refs are
      // cleared first, so this is a no-op then). Best-effort — never awaited.
      if (uploadedKeysRef.current?.length) {
        void deleteFromR2(uploadedKeysRef.current);
        uploadedKeysRef.current = null;
      }
    };
  }, []);

  if (!session) return <div className="min-h-[50vh]" />;

  const selectedCategory = categories.find((c) => c.id === category);
  const needsSubcategory = !!selectedCategory?.subcategories?.length && !subcategory;
  const allFields = getCategoryFields(category ?? undefined, subcategory ?? undefined);
  // A question that only applies to rentals (or only to sales) appears once the seller has said which.
  const fields = visibleFields(allFields, attributes);
  // Only the conditions that fit this category — none for a rental, a job, food or an animal.
  const allowedConditions = conditionOptionsFor(category, subcategory);
  const conditionChoices = CONDITIONS.filter((c) => allowedConditions.includes(c.value));
  const isRental = isRentalListing(category, subcategory, attributes);
  const featureOptions = getCategoryFeatures(category ?? undefined, subcategory ?? undefined);

  const close = () => router.push('/');
  const back = () => {
    setStepNotice(null);
    setStep((s) => Math.max(1, s - 1));
  };
  const goTo = (s: number) => {
    setStepNotice(null);
    setStep(s);
  };

  // ── Photos ──────────────────────────────────────────────────────────────
  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_LISTING_PHOTOS - photos.length;
    const chosen = Array.from(files);
    setAddingPhotos(true);
    try {
      // Each file is validated by its real bytes + decoded + re-encoded to
      // JPEG; invalid ones are reported by name, valid ones still get added.
      const { files: ok, errors } = await prepareSelection(chosen.slice(0, Math.max(room, 0)));
      if (chosen.length > room) errors.push(t('post.webSell.tooManyPhotos', { max: MAX_LISTING_PHOTOS, count: chosen.length - room }));
      setPhotoErrors(errors);
      if (ok.length) setPhotos((p) => [...p, ...ok.map((file) => ({ id: uuidv4(), file, preview: URL.createObjectURL(file) }))].slice(0, MAX_LISTING_PHOTOS));
      // Photos changed → any earlier upload no longer matches what will be published.
      discardUploads();
    } finally {
      setAddingPhotos(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(photos[i].preview);
    setPhotos((p) => p.filter((_, idx) => idx !== i));
    discardUploads();
  };

  // Reorder (the first photo is the cover) — keyboard-friendly alternative to
  // mobile's long-press drag.
  const movePhotoEarlier = (i: number) => {
    if (i <= 0) return;
    setPhotos((p) => {
      const next = [...p];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
    discardUploads();
  };

  // Drops already-uploaded objects when the photo set changed, so a retry
  // uploads exactly what is shown (and doesn't leave orphans behind).
  const discardUploads = () => {
    if (uploadedKeysRef.current?.length) void deleteFromR2(uploadedKeysRef.current);
    uploadedUrlsRef.current = null;
    uploadedKeysRef.current = null;
  };

  // ── Photo check ─────────────────────────────────────────────────────────
  // Sends every photo to the scan service together and returns its answer (or null after showing why it failed).
  const checkPhotos = async (): Promise<ScanResult | null> => {
    setScanState({ kind: 'checking' });
    try {
      const result = await scanListingPhotos({
        listingId: listingIdRef.current as string,
        categoryId: category ?? '',
        title: title.trim(),
        description: description.trim(),
        photos: photos.map((p) => ({ id: p.id, file: p.file })),
      });
      setScanState({ kind: 'hidden' });
      return result;
    } catch (e) {
      setScanState({ kind: 'error', failure: e instanceof ImageScanError ? e.kind : 'failed' });
      return null;
    }
  };
  // The watermarked derivatives the service already published become the listing's images; nothing is uploaded from the browser.
  const adoptScan = (result: ScanResult) => {
    const urls = publishableUrls(result);
    if (!urls) throw new Error('photo check incomplete');
    uploadedUrlsRef.current = urls;
    uploadedKeysRef.current = urls.map(keyFromUrl);
  };

  // ── Category ────────────────────────────────────────────────────────────
  // Specs/highlights belong to a category schema: switching category keeps the
  // values the new schema also has (e.g. Brand, Color) and drops the rest, so
  // nothing from the previous category can be published under the new one.
  const chooseCategory = (catId: string, sub: string | null) => {
    setCategory(catId);
    setSubcategory(sub);
    setAttributes((a) => sanitizeAttributes(getCategoryFields(catId, sub ?? undefined), a));
    // A condition chosen for the previous category may not exist for this one.
    setCondition((c) => (c && conditionOptionsFor(catId, sub).includes(c) ? c : undefined));
    setFeatures((f) => sanitizeFeatures(getCategoryFeatures(catId, sub ?? undefined), f));
  };

  // ── Details ─────────────────────────────────────────────────────────────
  const titleError = validateTitle(title);
  const descriptionError = validateDescription(description);
  const conditionError = validateCondition(condition, allowedConditions);
  const sellerNotesError = validateSellerNotes(sellerNotes);
  const attributeErrors = validateAttributes(allFields, attributes, new Date(), true);
  const detailsFirstInvalid = titleError
    ? 'title'
    : descriptionError
      ? 'description'
      : conditionError
        ? 'condition'
        : fields.find((f) => attributeErrors[f.key])?.key ?? (sellerNotesError ? 'sellerNotes' : undefined);

  const showDetailsError = (key: string) => !!attempted.details || !!touched[key];
  const touch = (key: string) => setTouched((prev) => ({ ...prev, [key]: true }));

  const continueFromDetails = () => {
    if (detailsFirstInvalid) {
      setAttempted((a) => ({ ...a, details: true }));
      setStepNotice(t('post.webSell.fixFieldsNotice'));
      focusSellField(detailsFirstInvalid);
      return;
    }
    goTo(4);
  };

  // ── Location & price ────────────────────────────────────────────────────
  const priceError = validatePrice(price);
  const currencyError = validateCurrency(currency, picked?.currencies);
  const showPriceError = !!attempted.price || !!touched.price;

  const continueFromPrice = () => {
    if (!city || priceError || currencyError) {
      setAttempted((a) => ({ ...a, price: true }));
      setStepNotice(!city ? t('post.webSell.cityRequiredNotice') : t('post.webSell.fixPriceNotice'));
      if (city) focusSellField('price');
      return;
    }
    goTo(5);
  };

  // ── Publish ─────────────────────────────────────────────────────────────
  const publish = async () => {
    if (publishLock.current) return;

    // Publish-time gate: the same rules, re-run against everything, so an
    // earlier step edited after its own validation (or tampered state) can't
    // reach the database unchecked.
    const check = validateListingDraft({
      photoCount: photos.length,
      category,
      subcategory,
      title,
      description,
      condition,
      sellerNotes,
      city,
      price,
      currency,
      allowedCurrencies: picked?.currencies,
      attributes,
      fields: allFields,
      categories,
    });
    if (!check.ok || !city || !category) {
      const stepFor = { photos: 1, category: 2, details: 3, location: 4, price: 4 } as const;
      setAttempted({ details: true, price: true });
      setStepNotice(t('post.webSell.needsAttentionNotice'));
      goTo(stepFor[check.firstInvalidStep ?? 'details']);
      return;
    }

    publishLock.current = true;
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
        // The SERVER decides (migration 0050): the old direct upload while checks are off, the scan service when on,
        // or a clear stop when the server needs the check and this page can't do it.
        const path = await decidePublishPath();
        if (path.kind === 'blocked') {
          setScanState({ kind: 'error', failure: path.reason });
          return;
        }
        if (path.kind === 'scan') {
          const result = await checkPhotos();
          if (!result) return; // the dialog is showing why
          if (result.outcome !== 'approved') {
            setScanState({ kind: 'result', result });
            return;
          }
          adoptScan(result);
        }
      }

      if (!uploadedUrlsRef.current) {
        // allSettled (not Promise.all) so a partial failure still tells us
        // exactly which objects made it to R2 — those get cleaned up before
        // the error surfaces, and the refs stay null so the retry re-uploads
        // a clean set rather than leaving orphans behind.
        const results = await Promise.allSettled(photos.map((p) => uploadToR2(p.file, `listings/${session.user.id}`)));
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

      const notes = sellerNotes
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean);
      const { error } = await createListing(session.user.id, {
        id: listingIdRef.current,
        title: title.trim(),
        description: description.trim(),
        category,
        subcategory,
        condition: allowedConditions.length > 0 ? condition : null,
        price: Number(price),
        currency,
        city,
        region: picked?.regionLabel ?? '',
        images: uploadedUrlsRef.current,
        imageKeys: uploadedKeysRef.current ?? [],
        negotiable,
        // Only the active category's own specs/highlights — never leftovers.
        attributes: sanitizeAttributes(allFields, attributes),
        features: sanitizeFeatures(featureOptions, features),
        sellerNotes: notes,
        // One identity: the listing shows the account's own name and photo; what is stored is the owner's current mode.
        sellerPresentation: activeMode(ownProfile),
      });
      if (error) {
        // The database refused a photo with no finished scan (or a rejected one): explain it instead of "something went wrong".
        const block = scanBlockFromDbError(error);
        if (block) {
          discardUploads();
          resetScanCache();
          setScanState({ kind: 'error', failure: block });
          return;
        }
        throw error;
      }

      // Published — reset the retry refs so "post another item" starts clean.
      // uploadedKeysRef is cleared here too so the unmount cleanup doesn't
      // delete the now-live listing's images when the seller leaves the page.
      listingIdRef.current = null;
      uploadedUrlsRef.current = null;
      uploadedKeysRef.current = null;
      goTo(6);
    } catch (err) {
      logError('sell/publish', err);
      setPublishError(isAppError(err) ? err : toAppError(err));
    } finally {
      publishLock.current = false;
      setPublishing(false);
    }
  };

  const errText = (id: string, message?: string) =>
    message ? (
      <p id={id} role="alert" className="mt-1 text-xs text-error">
        {message}
      </p>
    ) : null;

  const conditionKey = CONDITIONS.find((c) => c.value === condition)?.labelKey;
  const conditionLabel = conditionKey ? t(`post.details.condition.${conditionKey}`) : undefined;
  const stepNoticeEl = stepNotice ? (
    <p role="status" className="mt-4 rounded-md bg-error/10 px-3 py-2 text-sm text-error">
      {stepNotice}
    </p>
  ) : null;

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-2 md:px-0">
      {step === 1 && (
        <>
          <StepHeader step={1} totalSteps={TOTAL_STEPS} title={t('post.webSell.photosTitle')} subtitle={t('post.webSell.photosSubtitle')} onClose={close} />
          <p className="mb-2 text-xs text-textMuted">
            {t('post.webSell.photosHelp', { max: MAX_LISTING_PHOTOS })}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={p.id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-inputBackground">
                <Image src={p.preview} alt={t('post.webSell.photoAlt', { number: i + 1 })} fill className="object-cover" unoptimized />
                {i === 0 && <span className="absolute left-1 top-1 rounded-pill bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primaryText">{t('post.webSell.cover')}</span>}
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={t('post.webSell.removePhoto', { number: i + 1 })}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X size={11} />
                </button>
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => movePhotoEarlier(i)}
                    aria-label={t('post.webSell.movePhoto', { number: i + 1 })}
                    className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <ChevronLeft size={11} />
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_LISTING_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={addingPhotos}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary bg-inputBackground disabled:opacity-60"
              >
                <CameraIcon size={22} className="text-primary" />
                <span className="text-xs font-semibold text-primary">{addingPhotos ? t('post.webSell.checking') : t('post.webSell.addPhotos')}</span>
              </button>
            )}
          </div>
          {/* accept= is only a picker hint — every file is re-checked by its bytes in prepareImage(). */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            hidden
            aria-label={t('post.webSell.choosePhotos')}
            onChange={(e) => void addPhotos(e.target.files)}
          />
          {photoErrors.length > 0 && (
            <ul role="alert" className="mt-3 space-y-1 rounded-md bg-error/10 px-3 py-2 text-xs text-error">
              {photoErrors.map((e, i) => (
                <li key={i}>{t.text(e)}</li>
              ))}
            </ul>
          )}
          <Button fullWidth size="lg" className="mt-8" disabled={photos.length === 0 || addingPhotos} onClick={() => goTo(2)}>
            {t('common.continue')}
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <StepHeader step={2} totalSteps={TOTAL_STEPS} title={t('post.category.title')} onClose={back} />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                aria-pressed={category === cat.id}
                onClick={() => chooseCategory(cat.id, null)}
                className={`flex flex-col items-center gap-1.5 rounded-md border p-3 ${category === cat.id ? 'border-primary bg-primary/10' : 'border-border bg-surface'}`}
              >
                <CategoryIcon icon={cat.icon} size={20} className="text-primary" />
                <span className="text-center text-[11px] text-textPrimary">{categoryLabel(t, cat.id, cat.name)}</span>
              </button>
            ))}
          </div>
          {!!selectedCategory?.subcategories?.length && (
            <>
              <p className="mb-2 mt-6 text-sm font-semibold text-textPrimary">{t('post.webSell.subcategory')}</p>
              <div className="flex flex-wrap gap-2">
                {selectedCategory.subcategories.map((sub) => (
                  <button key={sub.name} type="button" aria-pressed={subcategory === sub.name} onClick={() => chooseCategory(selectedCategory.id, sub.name)} className={pill(subcategory === sub.name)}>
                    {subcategoryLabel(t, selectedCategory.id, sub.name)}
                  </button>
                ))}
              </div>
            </>
          )}
          {needsSubcategory && <p className="mt-3 text-xs text-textMuted">{t('post.webSell.chooseSubcategoryHint')}</p>}
          <Button fullWidth size="lg" className="mt-8" disabled={!category || needsSubcategory} onClick={() => goTo(3)}>
            {t('common.continue')}
          </Button>
        </>
      )}

      {step === 3 && (
        <>
          <StepHeader step={3} totalSteps={TOTAL_STEPS} title={t('post.details.title')} onClose={back} />

          <label htmlFor={sellFieldId('title')} className="mb-1 block text-sm font-medium text-textPrimary">
            {t('post.details.titleLabel')} <span aria-hidden="true">*</span>
          </label>
          <input
            id={sellFieldId('title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => touch('title')}
            placeholder={titlePlaceholderText(t, category ?? undefined, subcategory ?? undefined)}
            aria-invalid={showDetailsError('title') && !!titleError}
            aria-describedby="sell-title-help"
            aria-required="true"
            className={`${INPUT} ${showDetailsError('title') && titleError ? 'border-error' : 'border-border'}`}
          />
          <div id="sell-title-help" className="mb-4 mt-1 flex justify-between gap-2 text-xs">
            <span role={showDetailsError('title') && titleError ? 'alert' : undefined} className={showDetailsError('title') && titleError ? 'text-error' : 'text-textMuted'}>
              {showDetailsError('title') && titleError ? L(titleError) : t('post.details.titleHint')}
            </span>
            <span className={title.trim().length > TITLE_MAX_LENGTH ? 'text-error' : 'text-textMuted'}>
              {title.trim().length} / {TITLE_MAX_LENGTH}
            </span>
          </div>

          <label htmlFor={sellFieldId('description')} className="mb-1 block text-sm font-medium text-textPrimary">
            {t('post.details.descriptionLabel')} <span aria-hidden="true">*</span>
          </label>
          <textarea
            id={sellFieldId('description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => touch('description')}
            rows={5}
            placeholder={t('post.webSell.descriptionPlaceholder')}
            aria-invalid={showDetailsError('description') && !!descriptionError}
            aria-describedby="sell-description-help"
            aria-required="true"
            className={`${INPUT} ${showDetailsError('description') && descriptionError ? 'border-error' : 'border-border'}`}
          />
          <div id="sell-description-help" className="mb-4 mt-1 flex justify-between gap-2 text-xs">
            <span role={showDetailsError('description') && descriptionError ? 'alert' : undefined} className={showDetailsError('description') && descriptionError ? 'text-error' : 'text-textMuted'}>
              {showDetailsError('description') && descriptionError ? L(descriptionError) : t('post.details.descriptionHint')}
            </span>
            <span className={description.trim().length > DESCRIPTION_MAX_LENGTH ? 'text-error' : 'text-textMuted'}>
              {description.trim().length.toLocaleString('en-US')} / {DESCRIPTION_MAX_LENGTH.toLocaleString('en-US')}
            </span>
          </div>

          <p className="text-xs text-textMuted">{t('post.details.requiredNote')}</p>

          {conditionChoices.length > 0 && (
            <>
              <p id="sell-condition-label" className="mb-1 mt-4 block text-sm font-medium text-textPrimary">
                {t('post.details.conditionLabel')} <span aria-hidden="true">*</span>
              </p>
              <div id={sellFieldId('condition')} role="group" aria-labelledby="sell-condition-label" className="flex flex-wrap gap-2">
                {conditionChoices.map((c) => (
                  <button key={c.value} type="button" aria-pressed={condition === c.value} onClick={() => setCondition(c.value)} className={pill(condition === c.value)}>
                    {t(`post.details.condition.${c.labelKey}`)}
                  </button>
                ))}
              </div>
              {showDetailsError('condition') && errText('sell-condition-error', L(conditionError))}
            </>
          )}

          {fields.length > 0 && (
            <div className="mt-5 space-y-4">
              {fields.map((f) => (
                <SellField key={`${category}/${subcategory}/${f.key}`} field={f} value={attributes[f.key] ?? ''} onChange={(v) => setAttributes((a) => ({ ...a, [f.key]: v }))} submitted={!!attempted.details} isNew />
              ))}
            </div>
          )}

          {featureOptions.length > 0 && (
            <div className="mt-5">
              <p className="mb-1 text-sm font-medium text-textPrimary">{t('post.details.featuresOptional')}</p>
              <div className="flex flex-wrap gap-2">
                {featureOptions.map((f) => {
                  const on = features.includes(f);
                  return (
                    <button key={f} type="button" aria-pressed={on} onClick={() => setFeatures((cur) => (on ? cur.filter((x) => x !== f) : [...cur, f]))} className={pill(on)}>
                      {on ? '✓ ' : ''}
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5">
            <label htmlFor={sellFieldId('sellerNotes')} className="mb-1 block text-sm font-medium text-textPrimary">
              {t('post.webSell.highlightsLabel')}
            </label>
            <textarea
              id={sellFieldId('sellerNotes')}
              value={sellerNotes}
              onChange={(e) => setSellerNotes(e.target.value)}
              rows={3}
              placeholder={t('post.webSell.highlightsPlaceholder')}
              aria-invalid={!!sellerNotesError}
              aria-describedby="sell-notes-help"
              className={`${INPUT} ${sellerNotesError ? 'border-error' : 'border-border'}`}
            />
            <div id="sell-notes-help" className="mt-1 flex justify-between gap-2 text-xs">
              <span role={sellerNotesError ? 'alert' : undefined} className="text-error">
                {L(sellerNotesError)}
              </span>
              {sellerNotes.length > SELLER_NOTES_MAX_LENGTH * 0.8 && (
                <span className={sellerNotes.trim().length > SELLER_NOTES_MAX_LENGTH ? 'text-error' : 'text-textMuted'}>
                  {sellerNotes.trim().length} / {SELLER_NOTES_MAX_LENGTH}
                </span>
              )}
            </div>
          </div>

          {stepNoticeEl}
          <Button fullWidth size="lg" className="mt-6" onClick={continueFromDetails}>
            {t('common.continue')}
          </Button>
        </>
      )}

      {step === 4 && (
        <>
          <StepHeader step={4} totalSteps={TOTAL_STEPS} title={t('post.webSell.locationPriceTitle')} onClose={back} />
          <label className="mb-1 block text-sm font-medium text-textPrimary">{t('post.webSell.cityLabel')}</label>
          <LocationPicker
            collapseOnSelect
            selected={city}
            onSelect={(loc) => {
              setCity(loc.name);
              setPicked(loc);
              setCurrency(loc.defaultCurrency);
              setStepNotice(null);
            }}
          />
          {picked && picked.currencies.length > 1 && (
            <>
              <p className="mb-1 mt-3 block text-sm font-medium text-textPrimary">{lt('currency')}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {picked.currencies.map((c) => (
                  <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)} className={pill(currency === c)}>
                    {currencyLabel(c)}
                  </button>
                ))}
              </div>
            </>
          )}
          <label htmlFor={sellFieldId('price')} className="mb-1 mt-3 block text-sm font-medium text-textPrimary">
            {isRental ? t('post.price.rentLabel') : lt('price')} ({currencyLabel(currency)}) <span aria-hidden="true">*</span>
          </label>
          <input
            id={sellFieldId('price')}
            // The typed text is validated exactly as entered — nothing is
            // stripped or rewritten. inputMode only picks the keypad.
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => touch('price')}
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            aria-invalid={showPriceError && !!priceError}
            aria-describedby="sell-price-help"
            aria-required="true"
            className={`mb-1 ${INPUT} ${showPriceError && priceError ? 'border-error' : 'border-border'}`}
          />
          <p id="sell-price-help" role={showPriceError && (priceError || currencyError) ? 'alert' : undefined} className={`mb-3 text-xs ${showPriceError && (priceError || currencyError) ? 'text-error' : 'text-textMuted'}`}>
            {showPriceError && (priceError ?? currencyError) ? L(priceError ?? currencyError) : !priceError ? `${formatMoney(Number(price), currency)}${isRental && attributes.rentPeriod ? ` · ${optionText(t, attributes.rentPeriod)}` : ''}` : isRental ? t('post.price.rentHint') : t('post.price.priceHint')}
          </p>
          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input type="checkbox" checked={negotiable} onChange={(e) => setNegotiable(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t('post.webSell.negotiableCheckbox')}
          </label>
          {stepNoticeEl}
          <Button fullWidth size="lg" className="mt-8" onClick={continueFromPrice}>
            {t('common.continue')}
          </Button>
        </>
      )}

      {step === 5 && (
        <>
          <StepHeader step={5} totalSteps={TOTAL_STEPS} title={t('post.preview.title')} subtitle={t('post.webSell.previewSubtitle')} onClose={back} />
          <div className="overflow-hidden rounded-lg bg-surface shadow-sm">
            {photos[0] && (
              <div className="relative aspect-[4/5] w-full bg-skeleton">
                <Image src={photos[0].preview} alt={title} fill className="object-cover" unoptimized />
              </div>
            )}
            <div className="p-3">
              <p className="truncate text-[15px] font-medium text-textPrimary">{title.trim() || t('post.preview.untitledListing')}</p>
              <p className="mt-0.5 text-lg font-bold text-primary">{!priceError ? formatMoney(Number(price), currency) : '—'}</p>
              <p className="mt-1 text-xs text-textMuted">
                {city ?? t('post.webSell.noCitySelected')}
                {conditionLabel ? ` · ${conditionLabel}` : ''}
              </p>
              {description.trim() && <p className="mt-2 whitespace-pre-line text-sm text-textSecondary">{description.trim()}</p>}
              {fields.some((f) => attributes[f.key]?.trim()) && (
                <dl className="mt-3 space-y-1 text-xs">
                  {fields
                    .filter((f) => attributes[f.key]?.trim())
                    .map((f) => (
                      <div key={f.key} className="flex justify-between gap-3">
                        <dt className="text-textSecondary">{f.label}</dt>
                        <dd className="text-textPrimary">{attributes[f.key].trim()}</dd>
                      </div>
                    ))}
                </dl>
              )}
            </div>
          </div>
          {stepNoticeEl}
          {publishError && (
            <ErrorNotice
              className="mt-4"
              error={publishError}
              retrying={publishing}
              onRetry={publish}
              onSignIn={() => requireAuth(() => publish(), { next: '/sell' })}
            />
          )}
          <Button fullWidth size="lg" className="mt-8" loading={publishing} disabled={publishing} onClick={publish}>
            {t('post.preview.publishListing')}
          </Button>
        </>
      )}

      <ImageScanDialog
        state={scanState}
        previews={photos.map((p) => p.preview)}
        categoryLabel={selectedCategory ? categoryLabel(t, selectedCategory.id, selectedCategory.name) : ''}
        allowReviewPublish={scanState.kind !== 'result' || reviewPublishAllowed(scanState.result, peekScanPolicy())}
        onClose={() => setScanState({ kind: 'hidden' })}
        onRetry={() => {
          setScanState({ kind: 'hidden' });
          void publish();
        }}
        onReplace={() => {
          setScanState({ kind: 'hidden' });
          goTo(1);
        }}
        onPublishForReview={() => {
          const st = scanState;
          setScanState({ kind: 'hidden' });
          if (st.kind !== 'result') return;
          try {
            adoptScan(st.result);
          } catch {
            setScanState({ kind: 'error', failure: 'failed' });
            return;
          }
          void publish();
        }}
      />

      {step === 6 && (
        <div className="flex flex-col items-center py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 size={32} className="text-success" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-textPrimary">{t('post.webSell.publishedTitle')}</h1>
          <p className="mt-2 max-w-sm text-sm text-textSecondary">
            {t('post.webSell.publishedBody')}
          </p>
          <Button className="mt-6" onClick={() => router.push('/')}>
            {t('post.webSell.backHome')}
          </Button>
        </div>
      )}
    </div>
  );
}
