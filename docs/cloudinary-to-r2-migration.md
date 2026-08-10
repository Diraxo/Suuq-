# Cloudinary → Cloudflare R2 migration

Image storage moved from Cloudinary to Cloudflare R2. This is a short reference for the shape of that change — not a runbook, since the migration is already applied in code.

## What changed

- **Upload**: `lib/r2.ts`'s `uploadToR2(uri, folder)` replaces the old `uploadToCloudinary`. The client never holds an R2 credential — it asks the `r2-presign` Edge Function for a short-lived presigned PUT URL scoped to its own `listings/{userId}/...`, `avatars/{userId}`, or `business/{userId}/logo|banner` folder, then PUTs the file straight to R2 with it.
- **Delete**: `lib/r2.ts`'s `deleteR2Assets(keys)` replaces `deleteCloudinaryAssets`, calling the `r2-delete` Edge Function (same ownership-scoped JWT pattern the old `cloudinary-delete` function used).
- **Display**: `lib/r2.ts`'s `imageUrl(url, opts)` replaces `cldUrl`. It only ever rewrites `res.cloudinary.com` URLs (legacy rows); R2 URLs pass through unchanged since R2 has no on-the-fly transform — sizing/quality comes entirely from the upload-time resize/compress step in `lib/imagePipeline.ts`.
- **Database**: no schema change. The existing `avatar_public_id`, `business_logo_public_id`, `business_banner_public_id`, and `image_public_ids` columns (added in `0018_cloudinary_public_ids.sql`) are reused to hold R2 object keys instead of Cloudinary public ids — they were already just opaque cleanup identifiers.

## Legacy Cloudinary rows

Rows written before this migration may still have an absolute `res.cloudinary.com` URL in `avatar_url` / `business_logo_url` / `business_banner_url` / `images`, with no matching object key (or a leftover Cloudinary public id) in the `*_public_id` columns. These:

- **Keep displaying correctly** — they're already-absolute URLs, so rendering them needs no Cloudinary account, credential, or SDK.
- **Are never auto-migrated to R2** — copying existing Cloudinary assets into the bucket was out of scope for this pass.
- **Are never auto-deleted** — remove/replace/delete flows only ever call `deleteR2Assets` with a stored R2 key; a legacy row with no key (or a stale Cloudinary id) is simply left alone, since the app no longer holds a Cloudinary credential to delete it with.

Practically: keep the Cloudinary account alive (even though the app no longer talks to it) until either (a) those old images are manually migrated to R2, or (b) they're judged not worth keeping.

## Required Cloudflare/Supabase setup (not done by this change)

- Create the `fursad-media` R2 bucket and enable public access for it — either R2's own Public Development URL (`pub-*.r2.dev`) or a custom domain connected to the bucket in the Cloudflare dashboard. That base URL is `R2_PUBLIC_URL`.
- Set Edge Function secrets on the Supabase project: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.
- Deploy `supabase/functions/r2-presign` and `supabase/functions/r2-delete`.
- Retire the Cloudinary account's credentials once legacy rows are no longer needed (or keep them idle indefinitely — the app never calls Cloudinary again either way).
