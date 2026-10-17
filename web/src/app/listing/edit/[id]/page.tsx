'use client';

// Web port of app/listing/edit/[id].tsx on mobile: photos, status, title,
// category, price/currency/negotiable, description, condition, city, save
// and delete. Mobile also edits per-category dynamic attributes/features/
// seller-notes (data/categoryFields.ts, data/categoryFeatures.ts) and a
// contact-phone shortcut — none of that data layer exists anywhere in
// web/src yet (the Sell flow doesn't collect it either), so those fields
// are out of scope here; see the PHASE3 report.
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ChevronLeft, X, CameraIcon } from '@/lib/icons';
import { CategoryIcon } from '@/lib/icons';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Tag as TagIcon } from '@/lib/icons';
import { categories } from '@/lib/categories';
import { LocationPicker } from '@/components/LocationPicker';
import { useLocations } from '@/services/locations';
import { effectiveFor, findByName } from '@/lib/locationTree';
import { currencyLabel } from '@/lib/currency';
import { Listing, ListingStatus } from '@/lib/types';
import { getListing, updateListing, deleteListingRow } from '@/services/listings';
import { uploadToR2, deleteFromR2, imageKeyFor } from '@/services/r2';
import { prepareSelection } from '@/services/imagePrep';
import { ImageScanDialog, type ImageScanDialogState } from '@/components/ImageScanDialog';
import { decidePublishPath, peekScanPolicy, scanListingPhotos, ImageScanError } from '@/services/imageScan';
import { publishableUrls, keyFromUrl, type ScanResult } from '@/lib/imageScanState';
import { reviewPublishAllowed, scanBlockFromDbError } from '@/lib/imageScanPolicy';
import { getCategoryFields } from '@/lib/categoryFields';
import { getCategoryFeatures } from '@/lib/categoryFeatures';
import {
  validateTitle,
  validateDescription,
  validatePrice,
  sanitizeAttributes,
  sanitizeFeatures,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from '@/lib/sellRules';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';

const STATUSES: ListingStatus[] = ['available', 'reserved', 'sold', 'expired'];
const STATUS_LABEL: Record<ListingStatus, string> = { available: 'Active', reserved: 'Reserved', sold: 'Sold', expired: 'Expired', removed: 'Removed', deactivated: 'Deactivated' };
const CONDITIONS: { value: Listing['condition']; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'like-new', label: 'Like new' },
  { value: 'used', label: 'Used' },
  { value: 'for-parts', label: 'For parts' },
];
const MAX_PHOTOS = 5;

type PhotoSlot = { url: string; file?: File };

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const authed = useRequireAuthPage(`/listing/edit/${id}`);
  const uid = useAuthStore((s) => s.session?.user.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [original, setOriginal] = useState<Listing | null | undefined>(undefined);
  const [photos, setPhotos] = useState<PhotoSlot[]>([]);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('ETB');
  const [originalCurrency, setOriginalCurrency] = useState<string | null>(null);
  const [pickedCurrencies, setPickedCurrencies] = useState<string[] | null>(null);
  const directory = useLocations();
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ListingStatus>('available');
  const [condition, setCondition] = useState<Listing['condition']>('used');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState<string | undefined>();
  const [negotiable, setNegotiable] = useState(false);
  const [city, setCity] = useState('');
  // listings.region follows the chosen city; kept as loaded until the seller picks a different one.
  const [region, setRegion] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Photo check for NEW / replaced photos only; kept photos were already published and are not re-scanned.
  const [scanState, setScanState] = useState<ImageScanDialogState>({ kind: 'hidden' });
  const [deleting, setDeleting] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getListing(id).then((l) => {
      if (cancelled) return;
      const listing = l ?? null;
      setOriginal(listing);
      if (listing) {
        setPhotos(listing.images.map((url) => ({ url })));
        setTitle(listing.title);
        setPrice(String(listing.price));
        setCurrency(listing.currency);
        setOriginalCurrency(listing.currency);
        setDescription(listing.description);
        setStatus(listing.status === 'removed' ? 'available' : listing.status);
        setCondition(listing.condition);
        setCategory(listing.category);
        setSubcategory(listing.subcategory);
        setNegotiable(listing.negotiable);
        setCity(listing.city);
        setRegion(listing.region);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        if (p.file) URL.revokeObjectURL(p.url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed) return <div className="min-h-[50vh]" />;

  const backButton = (
    <div className="mb-4 flex items-center gap-2">
      <button onClick={() => router.back()} aria-label="Go back" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface">
        <ChevronLeft size={20} />
      </button>
      <h1 className="text-xl font-bold text-textPrimary">Edit listing</h1>
    </div>
  );

  if (original === undefined) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-4 md:px-0 md:pt-8">{backButton}</div>
    );
  }

  if (original === null || original.seller.id !== uid) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-4 md:px-0 md:pt-8">
        {backButton}
        <EmptyState icon={TagIcon} title="Listing not found" message="It may have been removed." actionLabel="Go back" onAction={() => router.back()} />
      </div>
    );
  }

  const selectedCategory = categories.find((c) => c.id === category);

  // Every picked file is checked by its real bytes, decoded and re-encoded to
  // JPEG (services/imagePrep.ts) before it can enter the grid; bad files are
  // reported, the valid ones of the same selection still go through.
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const remaining = MAX_PHOTOS - photos.length;
    const { files: ok, errors } = await prepareSelection(Array.from(files).slice(0, remaining));
    setPhotoError(errors.length ? errors.join(' ') : null);
    if (ok.length) setPhotos((prev) => [...prev, ...ok.map((file) => ({ url: URL.createObjectURL(file), file }))].slice(0, MAX_PHOTOS));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = (i: number) => {
    setPhotos((prev) => {
      const target = prev[i];
      if (target?.file) URL.revokeObjectURL(target.url);
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const movePhoto = (i: number, direction: -1 | 1) => {
    const to = i + direction;
    if (to < 0 || to >= photos.length) return;
    setPhotos((prev) => {
      const next = [...prev];
      [next[i], next[to]] = [next[to], next[i]];
      return next;
    });
  };

  const selectCategory = (catId: string) => {
    const chosen = categories.find((c) => c.id === catId);
    setCategory(catId);
    if (!chosen?.subcategories?.length) {
      setSubcategory(undefined);
      setCategoryPickerOpen(false);
    } else {
      setSubcategory(undefined);
    }
  };

  const priceNum = Number(price);
  const titleError = validateTitle(title);
  const descriptionError = validateDescription(description);
  const priceError = validatePrice(price);

  const save = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (titleError || descriptionError || priceError || !city || photos.length === 0) {
      setSaveError('Please fill in every required field and keep at least one photo.');
      return;
    }

    // New or replaced photos go through the same server-side check and watermarking as a new listing. The SERVER decides
    // whether that is required (migration 0050); a page that can't do it says so instead of failing vaguely.
    if (photos.some((s) => s.file)) {
      const path = await decidePublishPath();
      if (path.kind === 'blocked') {
        setScanState({ kind: 'error', failure: path.reason });
        return;
      }
      if (path.kind === 'scan') {
        await runPhotoCheck();
        return;
      }
    }
    await performSave(null);
  };

  const runPhotoCheck = async () => {
    if (!original) return;
    setScanState({ kind: 'checking' });
    try {
      const result = await scanListingPhotos({
        listingId: original.id,
        categoryId: category,
        title: title.trim(),
        description: description.trim(),
        photos: photos.filter((s) => s.file).map((s) => ({ id: s.url, file: s.file as Blob })),
      });
      if (result.outcome === 'approved') {
        setScanState({ kind: 'hidden' });
        await performSave(result);
      } else {
        setScanState({ kind: 'result', result });
      }
    } catch (e) {
      setScanState({ kind: 'error', failure: e instanceof ImageScanError ? e.kind : 'failed' });
    }
  };

  const performSave = async (scan: ScanResult | null) => {
    if (!original) return;
    setSaving(true);
    try {
      // With a finished photo check the images are the watermarked derivatives the service already published;
      // nothing is uploaded from the browser a second time.
      const derived = new Map<string, string>();
      if (scan) {
        const newSlots = photos.filter((s) => s.file);
        const urls = publishableUrls(scan);
        if (!urls || urls.length !== newSlots.length) throw new Error('photo check incomplete');
        newSlots.forEach((s, i) => derived.set(s.url, urls[i]));
      }
      const finalPhotos = await Promise.all(
        photos.map(async (slot) => {
          if (slot.file) {
            const d = derived.get(slot.url);
            if (d) return { url: d, key: keyFromUrl(d) };
            return uploadToR2(slot.file, `listings/${uid}`);
          }
          return { url: slot.url, key: imageKeyFor(original, slot.url) ?? '' };
        })
      );
      const finalImages = finalPhotos.map((p) => p.url);
      // Keys persisted index-aligned with the URLs (image_public_ids); '' = legacy URL we cannot derive a key for.
      const finalKeys = finalPhotos.map((p) => p.key);

      const patch = {
        title: title.trim(),
        description: description.trim(),
        category,
        subcategory: subcategory ?? null,
        condition,
        currency,
        negotiable,
        city,
        region,
        status,
        images: finalImages,
        imagePublicIds: finalKeys,
        // Specs/highlights belong to a category schema. This page does not edit
        // them, but when the seller moves the listing to another category the
        // old category's extras are pruned so they are not shown under the wrong one.
        ...(category !== original.category || subcategory !== original.subcategory
          ? {
              attributes: sanitizeAttributes(getCategoryFields(category, subcategory), original.attributes ?? {}),
              features: sanitizeFeatures(getCategoryFeatures(category, subcategory), original.features ?? []),
            }
          : {}),
      };

      // One atomic write for price and every other field: the database records a price drop (Listing Insights,
      // the Price Drops tab and the "Price reduced" filter) whenever this update lowers the price in the same currency.
      const { error } = await updateListing(original.id, { ...patch, price: priceNum });
      if (error) {
        // The database refused a photo with no finished scan (or a rejected one): say so instead of "could not save".
        const block = scanBlockFromDbError(error);
        if (block) {
          setScanState({ kind: 'error', failure: block });
          return;
        }
        throw new Error(error);
      }

      const removedUrls = original.images.filter((u) => !finalImages.includes(u));
      const removedKeys = removedUrls.map((u) => imageKeyFor(original, u)).filter((k): k is string => !!k);
      if (removedKeys.length > 0) deleteFromR2(removedKeys);

      router.push('/my-listings');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!confirm('Delete this listing? This cannot be undone.')) return;
    setDeleting(true);
    const keys = original.images.map((u) => imageKeyFor(original, u)).filter((k): k is string => !!k);
    const { error } = await deleteListingRow(original.id);
    setDeleting(false);
    if (error) {
      setSaveError(error);
      return;
    }
    if (keys.length > 0) deleteFromR2(keys);
    router.push('/my-listings');
  };

  // Currencies on offer = those allowed at the chosen place, plus whatever the
  // listing already uses so an existing price never becomes un-editable.
  const placeNode = findByName(directory.index, city);
  const currencyChoices = Array.from(
    new Set([...(pickedCurrencies ?? (placeNode ? effectiveFor(directory.index, placeNode.id).currencies : [])), originalCurrency ?? currency])
  );
  const pillClass = (active: boolean) => `rounded-pill border-[1.5px] px-3 py-1.5 text-sm ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-textSecondary'}`;

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-4 md:px-0 md:pt-8">
      {backButton}

      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm text-textSecondary">Photos</p>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((slot, i) => (
              <div key={slot.url + i} className="relative aspect-square overflow-hidden rounded-md border border-border bg-inputBackground">
                <Image src={slot.url} alt={`Photo ${i + 1}`} fill sizes="120px" className="object-cover" unoptimized={!!slot.file} />
                {i === 0 && <span className="absolute left-1 top-1 rounded-pill bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primaryText">COVER</span>}
                <button onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                  <X size={11} />
                </button>
                <div className="absolute bottom-1 right-1 flex gap-1">
                  {i > 0 && (
                    <button onClick={() => movePhoto(i, -1)} aria-label={`Move photo ${i + 1} earlier`} className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                      <ChevronLeft size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
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
          {photoError && <p role="alert" className="mt-1 text-xs text-error">{photoError}</p>}
          {submitted && photos.length === 0 && <p className="mt-1 text-xs text-error">Add at least one photo.</p>}
        </div>

        <div>
          <p className="mb-2 text-sm text-textSecondary">Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={pillClass(status === s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-textPrimary">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={submitted && !!titleError}
            aria-describedby="edit-title-help"
            className="w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div id="edit-title-help" className="mt-1 flex justify-between gap-2 text-xs">
            <span role={submitted && titleError ? 'alert' : undefined} className="text-error">{submitted ? titleError : ''}</span>
            <span className={title.trim().length > TITLE_MAX_LENGTH ? 'text-error' : 'text-textMuted'}>{title.trim().length} / {TITLE_MAX_LENGTH}</span>
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm text-textSecondary">Category</p>
          <button
            onClick={() => setCategoryPickerOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary"
          >
            <span className="flex items-center gap-2">
              {selectedCategory && <CategoryIcon icon={selectedCategory.icon} size={18} className="text-primary" />}
              {subcategory ? `${selectedCategory?.name} · ${subcategory}` : selectedCategory?.name ?? 'Select a category'}
            </span>
          </button>
          {categoryPickerOpen && (
            <div className="mt-2 rounded-md border border-border bg-surface p-3">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => selectCategory(cat.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-md border p-3 ${category === cat.id ? 'border-primary bg-primary/10' : 'border-border bg-background'}`}
                  >
                    <CategoryIcon icon={cat.icon} size={20} className="text-primary" />
                    <span className="text-center text-[11px] text-textPrimary">{cat.name}</span>
                  </button>
                ))}
              </div>
              {!!selectedCategory?.subcategories?.length && (
                <>
                  <p className="mb-2 mt-4 text-sm font-semibold text-textPrimary">Subcategory</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedCategory.subcategories.map((sub) => (
                      <button
                        key={sub.name}
                        onClick={() => {
                          setSubcategory(sub.name);
                          setCategoryPickerOpen(false);
                        }}
                        className={pillClass(subcategory === sub.name)}
                      >
                        {sub.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-textPrimary">Price</label>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="numeric"
            aria-invalid={submitted && !!priceError}
            className="w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {submitted && priceError && <p role="alert" className="mt-1 text-xs text-error">{priceError}</p>}
        </div>

        <div>
          <p className="mb-2 text-sm text-textSecondary">Currency</p>
          <div className="flex gap-2">
            {currencyChoices.map((c) => (
              <button key={c} onClick={() => setCurrency(c)} className={pillClass(currency === c)}>
                {currencyLabel(c)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm text-textSecondary">Price negotiable</p>
          <div className="flex gap-2">
            <button onClick={() => setNegotiable(true)} className={pillClass(negotiable)}>
              Negotiable
            </button>
            <button onClick={() => setNegotiable(false)} className={pillClass(!negotiable)}>
              Fixed price
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-textPrimary">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            aria-invalid={submitted && !!descriptionError}
            className="w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="mt-1 flex justify-between gap-2 text-xs">
            <span role={submitted && descriptionError ? 'alert' : undefined} className="text-error">{submitted ? descriptionError : ''}</span>
            <span className={description.trim().length > DESCRIPTION_MAX_LENGTH ? 'text-error' : 'text-textMuted'}>{description.trim().length.toLocaleString('en-US')} / {DESCRIPTION_MAX_LENGTH.toLocaleString('en-US')}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm text-textSecondary">Condition</p>
          <div className="flex flex-wrap gap-2">
            {CONDITIONS.map((c) => (
              <button key={c.value} onClick={() => setCondition(c.value)} className={pillClass(condition === c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm text-textSecondary">City</p>
          <LocationPicker
            directory={directory}
            selected={city}
            onSelect={(loc) => {
              setCity(loc.name);
              setRegion(loc.regionLabel);
              setPickedCurrencies(loc.currencies);
              if (!loc.currencies.includes(currency)) setCurrency(loc.defaultCurrency);
            }}
          />
        </div>

        <ImageScanDialog
          state={scanState}
          previews={photos.filter((s) => s.file).map((s) => s.url)}
          categoryLabel={categories.find((c) => c.id === category)?.name ?? ''}
          allowReviewPublish={scanState.kind !== 'result' || reviewPublishAllowed(scanState.result, peekScanPolicy())}
          onClose={() => setScanState({ kind: 'hidden' })}
          onRetry={() => void runPhotoCheck()}
          onReplace={() => setScanState({ kind: 'hidden' })}
          onPublishForReview={() => {
            const st = scanState;
            setScanState({ kind: 'hidden' });
            if (st.kind === 'result') void performSave(st.result);
          }}
        />

        {saveError && <p className="text-sm text-error">{saveError}</p>}
        {(titleError || descriptionError || priceError || !city || photos.length === 0) && submitted && !saveError && <p className="text-sm text-error">Please fill in every required field.</p>}

        <Button fullWidth size="lg" loading={saving} disabled={saving || deleting} onClick={save}>
          Save changes
        </Button>
        <Button variant="danger" fullWidth size="lg" loading={deleting} disabled={saving || deleting} onClick={confirmDelete}>
          Delete listing
        </Button>
      </div>
    </div>
  );
}
