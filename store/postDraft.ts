import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PhoneCountryCode } from '@/data/phoneCountries';
import { clearDraftPhotos } from '@/lib/postDraftPhotos';

export type PostStep = 'index' | 'category' | 'details' | 'location' | 'price' | 'preview';

type PostDraftData = {
  photos: string[];
  /** Parallel to `photos` — the picker's stable asset id per photo (falls back to the uri when unavailable), used to silently ignore duplicate picks. */
  photoIds: string[];
  category?: string;
  subcategory?: string;
  /** The category currently drilled into on the category step (its subcategory list is showing) — restored so backgrounding mid-pick doesn't reset the screen to the top-level list. */
  categoryDrillId?: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  negotiable: 'yes' | 'no' | 'unsure';
  /** No default — the seller must actively choose one. */
  condition?: 'new' | 'like-new' | 'used' | 'for-parts';
  city?: string;
  /** listings.region for the chosen city (from the locations directory, or the pending request's parent country). */
  region?: string;
  /** Currencies the seller may choose at the chosen place (from the location directory). */
  currencyOptions?: string[];
  /** Only collected when the seller has no phone saved on their profile yet — see app/post/details.tsx. Once saved, every future listing uses profiles.phone automatically. */
  phoneCountry: PhoneCountryCode;
  phoneLocal: string;
  /** Category-specific fields (e.g. vehicle Brand/Model, phone RAM/Storage) keyed by field id. */
  attributes: Record<string, string>;
  /** Category-specific checklist the seller toggled on (e.g. "Face ID", "Reverse camera"). */
  features: string[];
  /** Raw multiline input — one highlight per line (e.g. "Battery health 90%"); split into Listing.sellerNotes on publish. */
  sellerNotes: string;
  /** Client-generated id of the listing this draft will become — created on the first publish attempt and reused by every retry so a lost response can't publish the same draft twice (the insert is an upsert on this id). Cleared with the draft. */
  listingId?: string;
  /** How this listing presents its seller. Unset until the seller picks on the preview step; then it defaults to the profile they currently have active, and is stored with the listing (never re-derived from the mode). */
  sellerPresentation?: 'personal' | 'business';
  /** Which step screen the seller was last on — used to jump straight back there when they reopen Sell. */
  currentStep: PostStep;
};

/** One listing photo as the Sell screen sees it: a stable id (survives the picker-uri → permanent-uri swap) and its current uri. */
export type DraftPhoto = { id: string; uri: string };

/** Zips the two persisted arrays into one ordered list; a draft saved before ids existed falls back to the uri as id. */
export function draftPhotoItems(photos: string[], photoIds: string[]): DraftPhoto[] {
  return photos.map((uri, i) => ({ id: photoIds[i] || uri, uri }));
}

type PostDraft = PostDraftData & {
  /** True once the persisted draft has been read back from storage — gates the "resume to last step" redirect so it doesn't fire against stale initial state. */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setField: <K extends keyof PostDraftData>(key: K, value: PostDraftData[K]) => void;
  /** Replaces the ordered photo list in ONE write, so `photos` and `photoIds` can never be observed out of step. */
  setPhotoItems: (items: DraftPhoto[]) => void;
  setAttribute: (key: string, value: string) => void;
  toggleFeature: (feature: string) => void;
  /** Whether the draft has anything worth guarding on exit / resuming — mirrors the original leave-confirmation's content check. */
  hasDraftContent: () => boolean;
  reset: () => void;
};

const initial: PostDraftData = {
  photos: [],
  photoIds: [],
  category: undefined,
  subcategory: undefined,
  categoryDrillId: undefined,
  title: '',
  description: '',
  price: '',
  currency: 'ETB',
  negotiable: 'yes',
  condition: undefined,
  city: undefined,
  region: undefined,
  currencyOptions: undefined,
  phoneCountry: 'ET',
  phoneLocal: '',
  attributes: {},
  features: [],
  sellerNotes: '',
  listingId: undefined,
  currentStep: 'index',
};

export const usePostDraft = create<PostDraft>()(
  persist(
    (set, get) => ({
      ...initial,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setField: (key, value) => set({ [key]: value } as Partial<PostDraft>),
      setPhotoItems: (items) => set({ photos: items.map((p) => p.uri), photoIds: items.map((p) => p.id) }),
      setAttribute: (key, value) => set((state) => ({ attributes: { ...state.attributes, [key]: value } })),
      toggleFeature: (feature) =>
        set((state) => ({
          features: state.features.includes(feature) ? state.features.filter((f) => f !== feature) : [...state.features, feature],
        })),
      hasDraftContent: () => {
        const s = get();
        return s.photos.length > 0 || !!s.title || !!s.description || !!s.category || !!s.city || !!s.price;
      },
      reset: () => {
        // Fire-and-forget: only ever called after a successful publish or an
        // explicit Discard Draft, both of which mean the copied photo files
        // (lib/postDraftPhotos.ts) are no longer needed by anything.
        clearDraftPhotos();
        set({ ...initial, hasHydrated: true });
      },
    }),
    {
      name: 'suuqplus.postDraft.v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the data fields are worth persisting — actions are recreated on
      // every load, and hasHydrated must always start false on a fresh boot.
      partialize: (state) => {
        const { hasHydrated, setHasHydrated, setField, setPhotoItems, setAttribute, toggleFeature, hasDraftContent, reset, ...data } = state;
        return data;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
