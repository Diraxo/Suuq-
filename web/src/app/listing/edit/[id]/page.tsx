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
import { categories, currencies, cities, cityRegion } from '@/lib/categories';
import { Listing, ListingStatus } from '@/lib/types';
import { getListing, updateListing, deleteListingRow, dropListingPrice } from '@/services/listings';
import { uploadToR2, deleteFromR2, r2KeyFromUrl } from '@/services/r2';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';

const STATUSES: ListingStatus[] = ['available', 'reserved', 'sold', 'expired'];
const STATUS_LABEL: Record<ListingStatus, string> = { available: 'Active', reserved: 'Reserved', sold: 'Sold', expired: 'Expired', removed: 'Removed' };
const CONDITIONS: { value: Listing['condition']; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'like-new', label: 'Like new' },
  { value: 'used', label: 'Used' },
  { value: 'for-parts', label: 'For parts' },
];
const MAX_PHOTOS = 8;

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
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ListingStatus>('available');
  const [condition, setCondition] = useState<Listing['condition']>('used');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState<string | undefined>();
  const [negotiable, setNegotiable] = useState(false);
  const [city, setCity] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        setDescription(listing.description);
        setStatus(listing.status === 'removed' ? 'available' : listing.status);
        setCondition(listing.condition);
        setCategory(listing.category);
        setSubcategory(listing.subcategory);
        setNegotiable(listing.negotiable);
        setCity(listing.city);
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

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const remaining = MAX_PHOTOS - photos.length;
    const picked = Array.from(files).slice(0, remaining);
    setPhotos((prev) => [...prev, ...picked.map((file) => ({ url: URL.createObjectURL(file), file }))].slice(0, MAX_PHOTOS));
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
  const priceInvalid = submitted && (!price.trim() || Number.isNaN(priceNum) || priceNum <= 0);
  const titleInvalid = submitted && !title.trim();
  const missing = titleInvalid || priceInvalid || !description.trim() || !city || photos.length === 0;

  const save = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (!title.trim() || Number.isNaN(priceNum) || priceNum <= 0 || !description.trim() || !city || photos.length === 0) {
      setSaveError('Please fill in every required field and keep at least one photo.');
      return;
    }

    setSaving(true);
    try {
      const finalImages = await Promise.all(
        photos.map(async (slot) => (slot.file ? (await uploadToR2(slot.file, `listings/${uid}`)).url : slot.url))
      );

      const patch = {
        title: title.trim(),
        description,
        category,
        subcategory: subcategory ?? null,
        condition,
        currency,
        negotiable,
        city,
        region: cityRegion[city] ?? '',
        status,
        images: finalImages,
      };

      // Price decreases route through dropListingPrice first (records the
      // drop in `price_drops` for Listing Insights), mirroring the edit
      // screen's save() on mobile — price is left out of the field patch
      // there to avoid a redundant write.
      if (priceNum < original.price) {
        const { error: dropError } = await dropListingPrice(original.id, original.price, priceNum);
        if (dropError) throw new Error(dropError);
        const { error } = await updateListing(original.id, patch);
        if (error) throw new Error(error);
      } else {
        const { error } = await updateListing(original.id, { ...patch, price: priceNum });
        if (error) throw new Error(error);
      }

      const removedUrls = original.images.filter((u) => !finalImages.includes(u));
      const removedKeys = removedUrls.map(r2KeyFromUrl).filter((k): k is string => !!k);
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
    const keys = original.images.map(r2KeyFromUrl).filter((k): k is string => !!k);
    const { error } = await deleteListingRow(original.id);
    setDeleting(false);
    if (error) {
      setSaveError(error);
      return;
    }
    if (keys.length > 0) deleteFromR2(keys);
    router.push('/my-listings');
  };

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
            className="w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {titleInvalid && <p className="mt-1 text-xs text-error">Title is required.</p>}
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
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            className="w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {priceInvalid && <p className="mt-1 text-xs text-error">Enter a valid price.</p>}
        </div>

        <div>
          <p className="mb-2 text-sm text-textSecondary">Currency</p>
          <div className="flex gap-2">
            {currencies.map((c) => (
              <button key={c} onClick={() => setCurrency(c)} className={pillClass(currency === c)}>
                {c}
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
            className="w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
          />
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
          <div className="flex flex-wrap gap-2">
            {cities.map((c) => (
              <button key={c} onClick={() => setCity(c)} className={pillClass(city === c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {saveError && <p className="text-sm text-error">{saveError}</p>}
        {missing && submitted && !saveError && <p className="text-sm text-error">Please fill in every required field.</p>}

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
