'use client';

// A photo and its watermark as ONE unit. The photo stays invisible until its natural size is known, then the photo
// and the mark fade in together — so a viewer never sees the bare picture first and the mark seconds later. Mount it
// with key={src} (or let the key below do it) so every photo change starts from a fresh, hidden state.
//
// With previewSizes, a second, smaller copy of the photo is drawn underneath. Pass the same `sizes` the page already used for
// this photo and the browser serves it from cache at once: the viewer opens on a real picture (with its mark) while the
// large copy loads and fades in over it. The mark is laid out from the aspect ratio, which both copies share.
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ImageOff, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { isWatermarkedDerivative } from '@/lib/imageSafety';
import { WatermarkOverlay } from '@/components/WatermarkOverlay';

const SPINNER_DELAY_MS = 350;

type Props = {
  src: string;
  alt: string;
  fit: 'cover' | 'contain';
  sizes: string;
  priority?: boolean;
  /** `sizes` of a copy that is probably already cached (e.g. the listing page's). Shown while the full photo loads. */
  previewSizes?: string;
  /** Called once per photo when the full copy has loaded or failed (the page uses it to start lower-priority downloads). */
  onSettled?: () => void;
};

export function WatermarkedPhoto({ src, alt, fit, sizes, priority, previewSizes, onSettled }: Props) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [full, setFull] = useState<{ src: string; ok: boolean } | null>(null);
  const needsOverlay = !isWatermarkedDerivative(src);
  const ready = !needsOverlay || natural?.src === src;
  const fullDone = full?.src === src;
  const fullShown = fullDone && full.ok;
  const settledFor = useRef<string | null>(null);
  // The spinner is only for a photo that is genuinely slow: it waits a moment, and never draws over a picture that is
  // already showing (the small copy or the full one). Fast connections and cached photos never see it.
  const [slowFor, setSlowFor] = useState<string | null>(null);
  useEffect(() => {
    if (fullDone) return;
    const id = setTimeout(() => setSlowFor(src), SPINNER_DELAY_MS);
    return () => clearTimeout(id);
  }, [fullDone, src]);
  const showSpinner = !fullDone && slowFor === src && natural?.src !== src;
  useEffect(() => {
    if (fullDone && settledFor.current !== src) {
      settledFor.current = src;
      onSettled?.();
    }
  }, [fullDone, src, onSettled]);

  // A ref callback also catches photos already in the browser cache, whose load event fired before React attached onLoad.
  const measure = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth > 0) setNatural((n) => (n?.src === src ? n : { src, w: img.naturalWidth, h: img.naturalHeight }));
    },
    [src],
  );
  const measureFull = useCallback(
    (img: HTMLImageElement | null) => {
      measure(img);
      if (img && img.complete && img.naturalWidth > 0) setFull((f) => (f?.src === src ? f : { src, ok: true }));
      // A photo that failed before React attached onError (server-rendered page) is complete with no pixels: show the failure, not a spinner forever.
      else if (img && img.complete && img.currentSrc) setFull((f) => (f?.src === src ? f : { src, ok: false }));
    },
    [measure, src],
  );

  const photoClass = fit === 'cover' ? 'object-cover' : 'object-contain';

  return (
    <>
      <div key={src} className="absolute inset-0" style={{ opacity: ready ? 1 : 0, transition: 'opacity 120ms ease-out' }}>
        {previewSizes && (
          <Image
            ref={measure}
            src={src}
            alt=""
            aria-hidden
            fill
            sizes={previewSizes}
            className={photoClass}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural((n) => (n?.src === src ? n : { src, w: img.naturalWidth, h: img.naturalHeight }));
            }}
          />
        )}
        <Image
          key={attempt}
          ref={measureFull}
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={photoClass}
          style={previewSizes ? { opacity: fullShown ? 1 : 0, transition: 'opacity 150ms ease-out' } : undefined}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNatural({ src, w: img.naturalWidth, h: img.naturalHeight });
            setFull({ src, ok: true });
          }}
          onError={() => setFull({ src, ok: false })}
        />
        {needsOverlay && natural?.src === src && <WatermarkOverlay src={src} naturalWidth={natural.w} naturalHeight={natural.h} fit={fit} />}
      </div>
      {showSpinner && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-live="polite">
          <Loader2 size={28} className="animate-spin text-white/80 drop-shadow" aria-hidden />
        </div>
      )}
      {/* A photo that failed must say so, never leave a blank box. If the smaller copy is showing, it stays as the picture. */}
      {fullDone && !full.ok && natural?.src !== src && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-white/70" role="alert">
          <ImageOff size={32} aria-hidden />
          <span className="text-sm">{t('components.zoomableImage.loadFailed')}</span>
          {/* A span, not a button: on the listing page this sits inside the button that opens the full-screen viewer. */}
          <span
            role="button"
            tabIndex={0}
            className="pointer-events-auto mt-1 flex min-h-11 min-w-28 cursor-pointer items-center justify-center rounded-full bg-white/15 px-5 text-sm text-white"
            onClick={(e) => { e.stopPropagation(); setFull(null); setAttempt((n) => n + 1); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setFull(null); setAttempt((n) => n + 1); } }}
          >
            {t('common.retry')}
          </span>
        </div>
      )}
    </>
  );
}
