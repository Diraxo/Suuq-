// Avatar, business logo and business banner on the website — the browser twin of useAvatarActions (hooks/) and the
// logo/banner part of app/settings/business-profile.tsx on mobile. Same R2 folders, same profiles columns, same order of
// operations: upload -> save the new URL + key -> only then delete the replaced file (never before the save succeeds).
//
// Every image goes through prepareImage(): the real format is read from the bytes (a renamed .txt/.pdf/.svg is refused),
// the browser must decode it, it is centre-cropped to the slot's shape, shrunk and re-encoded as a small JPEG (which also
// drops EXIF/GPS). Server-side, r2-presign only issues keys in the caller's own folder and migration 0056 rejects a
// profile row that points at anything else.
import { getT } from '@/lib/i18n';
import type { Translate } from '@/lib/sellText';
import { supabase } from '@/lib/supabase';
import { prepareImage, PrepareOptions } from '@/services/imagePrep';
import { uploadToR2, deleteFromR2 } from '@/services/r2';
import { useAuthStore } from '@/store/auth';
import { interpretWrite } from '@/lib/saveOutcome';

export type ProfileImageKind = 'avatar' | 'logo' | 'banner';

// Output sizes: small on purpose. Avatar/logo 512px square ≈ 25–60 KB, banner 1600x900 ≈ 80–200 KB.
export const IMAGE_SLOTS: Record<ProfileImageKind, {
  folder: (uid: string) => string;
  urlColumn: string;
  keyColumn: string;
  prepare: PrepareOptions;
  label: string;
}> = {
  avatar: { folder: (uid) => `avatars/${uid}`, urlColumn: 'avatar_url', keyColumn: 'avatar_public_id', prepare: { skipMinDimension: true, aspect: 1, maxSide: 512, quality: 0.8 }, label: 'profile photo' },
  logo: { folder: (uid) => `business/${uid}/logo`, urlColumn: 'business_logo_url', keyColumn: 'business_logo_public_id', prepare: { skipMinDimension: true, aspect: 1, maxSide: 512, quality: 0.8 }, label: 'logo' },
  banner: { folder: (uid) => `business/${uid}/banner`, urlColumn: 'business_banner_url', keyColumn: 'business_banner_public_id', prepare: { skipMinDimension: true, aspect: 16 / 9, maxSide: 1600, quality: 0.75 }, label: 'banner' },
};

/** What a "Choose file" input should offer. A hint only — the bytes are what is actually checked. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

export type MediaResult = { ok: true } | { ok: false; message: string };

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** The slot's name ("logo", "banner", "profile photo") in the active language. */
export function mediaLabel(t: Translate, label: string): string {
  return t(label === 'logo' ? 'web.m.mediaLogo' : label === 'banner' ? 'web.m.mediaBanner' : 'web.m.mediaPhoto');
}

export async function setProfileImage(kind: ProfileImageKind, file: File, userId: string, previousKey: string | null): Promise<MediaResult> {
  const slot = IMAGE_SLOTS[kind];
  try {
    const prepared = await prepareImage(file, slot.prepare);
    const uploaded = await uploadToR2(prepared, slot.folder(userId));
    // `.select('id')`: an RLS refusal is error:null with zero rows — that is a failure, and the old image is untouched.
    const written = interpretWrite(await supabase.from('profiles').update({ [slot.urlColumn]: uploaded.url, [slot.keyColumn]: uploaded.key }).eq('id', userId).select('id'));
    if (!written.ok) {
      void deleteFromR2([uploaded.key]); // the upload is orphaned: clean it up, best effort
      return { ok: false, message: getT()('web.m.couldNotSaveMedia', { label: mediaLabel(getT(), slot.label) }) };
    }
    await useAuthStore.getState().refreshProfile();
    if (previousKey && previousKey !== uploaded.key) void deleteFromR2([previousKey]);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: messageOf(err, getT()('web.m.couldNotUploadMedia', { label: mediaLabel(getT(), slot.label) })) };
  }
}

export async function removeProfileImage(kind: ProfileImageKind, userId: string, previousKey: string | null): Promise<MediaResult> {
  const slot = IMAGE_SLOTS[kind];
  const removed = interpretWrite(await supabase.from('profiles').update({ [slot.urlColumn]: null, [slot.keyColumn]: null }).eq('id', userId).select('id'));
  if (!removed.ok) return { ok: false, message: getT()('web.m.couldNotRemoveMedia', { label: mediaLabel(getT(), slot.label) }) };
  await useAuthStore.getState().refreshProfile();
  if (previousKey) void deleteFromR2([previousKey]);
  return { ok: true };
}
