'use client';

// Lets the person frame their picture before it is uploaded, like Facebook / YouTube: a fixed frame in the exact shape the picture will have,
// drag to move, slider to zoom. What is inside the frame is what gets saved. Pure canvas, no library.
import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useT } from '@/lib/i18n';

type Props = {
  file: File;
  /** width / height of the frame (1 = square avatar/logo, 16/9 = banner). */
  aspect: number;
  /** Longest side of the cropped result in pixels. */
  outputSide: number;
  round?: boolean;
  title: string;
  onCancel: () => void;
  /** Called with the cropped picture. If the browser cannot show the file, called with the original so the normal checks decide. */
  onDone: (file: File) => void;
};

const FRAME_LONG_SIDE = 320;

export function ImageCropDialog({ file, aspect, outputSide, round, title, onCancel, onDone }: Props) {
  const t = useT();
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const frameW = aspect >= 1 ? FRAME_LONG_SIDE : Math.round(FRAME_LONG_SIDE * aspect);
  const frameH = aspect >= 1 ? Math.round(FRAME_LONG_SIDE / aspect) : FRAME_LONG_SIDE;

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const base = natural ? Math.max(frameW / natural.w, frameH / natural.h) : 1;
  const scale = base * zoom;
  const dw = natural ? natural.w * scale : 0;
  const dh = natural ? natural.h * scale : 0;
  const clamp = (x: number, y: number) => ({ x: Math.min(0, Math.max(frameW - dw, x)), y: Math.min(0, Math.max(frameH - dh, y)) });

  // Centre the picture when it loads, and keep it covering the frame whenever the zoom changes.
  useEffect(() => {
    if (!natural) return;
    setPos((p) => clamp(p.x === 0 && p.y === 0 ? (frameW - dw) / 2 : p.x, p.x === 0 && p.y === 0 ? (frameH - dh) / 2 : p.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, zoom]);

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setPos(clamp(drag.current.x + e.clientX - drag.current.px, drag.current.y + e.clientY - drag.current.py));
  };
  const onUp = () => {
    drag.current = null;
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img || !natural) return onDone(file);
    const outW = aspect >= 1 ? outputSide : Math.round(outputSide * aspect);
    const outH = aspect >= 1 ? Math.round(outputSide / aspect) : outputSide;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return onDone(file);
    ctx.drawImage(img, -pos.x / scale, -pos.y / scale, frameW / scale, frameH / scale, 0, 0, outW, outH);
    canvas.toBlob(
      (blob) => onDone(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file),
      'image/jpeg',
      0.92
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-xl bg-surface p-4 shadow-lg">
        <h2 className="text-base font-semibold text-textPrimary">{title}</h2>
        <p className="mt-1 text-xs text-textSecondary">{t('web.t.dragToMoveThePicture')}</p>
        <div
          className={`relative mx-auto mt-3 touch-none select-none overflow-hidden bg-black ${round ? 'rounded-full' : 'rounded-lg'}`}
          style={{ width: frameW, height: frameH, cursor: 'grab' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => onDone(file)}
            style={{ position: 'absolute', left: pos.x, top: pos.y, width: dw || undefined, height: dh || undefined, maxWidth: 'none' }}
          />
        </div>
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="mt-4 w-full" aria-label={t('web.m.zoom')} />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={confirm} disabled={!natural}>
            {t('web.t.usePhoto')}
          </Button>
        </div>
      </div>
    </div>
  );
}
