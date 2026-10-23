'use client';

// One control for the three profile images (avatar, business logo, business banner) — Change / Remove / View, like the
// mobile avatar menu and the logo/banner pickers. All the validation, cropping and compression lives in
// services/profileMedia.ts; this only picks the file and shows progress and errors.
import { ChangeEvent, DragEvent, useRef, useState } from 'react';
import { Briefcase, CameraIcon, Eye, Trash2, User, X } from '@/lib/icons';
import { Button } from '@/components/Button';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { IMAGE_ACCEPT, IMAGE_SLOTS, ProfileImageKind, removeProfileImage, setProfileImage } from '@/services/profileMedia';
import { useT } from '@/lib/i18n';
import { mediaLabel } from '@/services/profileMedia';

const SHAPE: Record<ProfileImageKind, string> = {
  avatar: 'h-28 w-28 rounded-full',
  logo: 'h-24 w-24 rounded-2xl',
  banner: 'aspect-video w-full rounded-lg',
};

type Props = {
  kind: ProfileImageKind;
  userId: string;
  url: string | null | undefined;
  /** R2 key of the current image, so it can be deleted when replaced or removed. */
  imageKey: string | null | undefined;
  title: string;
  hint?: string;
  /** Shown when there is no uploaded image (e.g. the Google photo), without offering Remove for it. */
  fallbackUrl?: string;
};

export function ProfileImageEditor({ kind, userId, url, imageKey, title, hint, fallbackUrl }: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'upload' | 'remove'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // The picture the person chose, waiting to be framed in the crop dialog before it is uploaded.
  const [cropping, setCropping] = useState<File | null>(null);
  const label = mediaLabel(t, IMAGE_SLOTS[kind].label);
  const shown = url || fallbackUrl || null;

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy('upload');
    setError(null);
    setNotice(null);
    const res = await setProfileImage(kind, file, userId, imageKey ?? null);
    setBusy(null);
    if (res.ok) setNotice(t('web.m.profileUpdated', { label }));
    else setError(res.message);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be chosen again after an error
    if (file) setCropping(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setCropping(file);
  };

  const remove = async () => {
    setConfirmRemove(false);
    setBusy('remove');
    setError(null);
    setNotice(null);
    const res = await removeProfileImage(kind, userId, imageKey ?? null);
    setBusy(null);
    if (res.ok) setNotice(t('web.m.profileRemoved', { label }));
    else setError(res.message);
  };

  const Empty = kind === 'avatar' ? User : Briefcase;

  return (
    <div className={kind === 'avatar' ? 'flex flex-col items-center text-center' : ''}>
      <p className={kind === 'avatar' ? 'sr-only' : 'text-sm font-medium text-textPrimary'}>{title}</p>
      <div
        className={`relative mt-2 overflow-hidden bg-inputBackground ${SHAPE[kind]} ${dragOver ? 'ring-2 ring-primary' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={title} className={`h-full w-full ${kind === 'logo' ? 'object-contain' : 'object-cover'}`} />
        ) : (
          <button type="button" onClick={() => input.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-1 text-textMuted" aria-label={t('web.m.addMedia', { label })}>
            <Empty size={kind === 'banner' ? 28 : 30} />
            {kind !== 'avatar' && <span className="text-xs">{t('web.t.clickOrDropAnImage')}</span>}
          </button>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white" role="status">
            {busy === 'upload' ? t('web.t.uploading') : t('web.t.removing')}
          </div>
        )}
      </div>

      <input ref={input} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={onPick} aria-label={t('web.m.chooseMedia', { label })} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" icon={<CameraIcon size={16} />} disabled={!!busy} onClick={() => input.current?.click()}>
          {url ? t('post.details.change') : 'Add'}
        </Button>
        {shown && kind === 'avatar' && (
          <Button type="button" variant="ghost" size="sm" icon={<Eye size={16} />} disabled={!!busy} onClick={() => setViewing(true)}>
            {t('web.m.view')}
          </Button>
        )}
        {url && !confirmRemove && (
          <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={16} />} disabled={!!busy} onClick={() => setConfirmRemove(true)} className="!text-error">
            {t('common.remove')}
          </Button>
        )}
        {url && confirmRemove && (
          <span className="flex flex-wrap items-center gap-2 text-sm text-textPrimary">
            {t('web.m.removeThisMedia', { label })}
            <Button type="button" variant="danger" size="sm" onClick={remove}>
              {t('web.t.yesRemove')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
              {t('common.cancel')}
            </Button>
          </span>
        )}
      </div>
      {hint && <p className="mt-2 text-xs text-textMuted">{hint}</p>}
      <p className="mt-1 min-h-[1rem] text-xs" role="status" aria-live="polite">
        {error ? <span className="text-error">{t.text(error)}</span> : notice ? <span className="text-success">{t.text(notice)}</span> : null}
      </p>

      {cropping && (
        <ImageCropDialog
          file={cropping}
          aspect={IMAGE_SLOTS[kind].prepare.aspect ?? 1}
          outputSide={IMAGE_SLOTS[kind].prepare.maxSide ?? 1024}
          round={kind === 'avatar'}
          title={t('web.m.adjustYour', { label })}
          onCancel={() => setCropping(null)}
          onDone={(cropped) => {
            setCropping(null);
            void upload(cropped);
          }}
        />
      )}

      {viewing && shown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={() => setViewing(false)}>
          <button type="button" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white" onClick={() => setViewing(false)} aria-label={t('common.close')}>
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt={title} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
