'use client';

// Web twin of components/ImageScanSheet.tsx: one "Checking your listing" state, then ONE consolidated result (grouped
// issues, previews of only the affected photos, Replace / Try again / Publish for review). Wording comes from
// lib/imageScanCopy.ts, which is kept identical to the mobile strings.
import { Loader2, AlertCircle, Clock } from 'lucide-react';
import { Button } from './Button';
import { useScanCopy } from '@/lib/i18n';
import { issueRows, type ScanResult } from '@/lib/imageScanState';
import type { ImageScanFailure } from '@/services/imageScan';

export type ImageScanDialogState =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'error'; failure: ImageScanFailure }
  | { kind: 'result'; result: ScanResult };

type Props = {
  state: ImageScanDialogState;
  /** Object-URL previews of the photos that were checked, in the order they were sent. */
  previews: string[];
  categoryLabel: string;
  onReplace: () => void;
  onRetry: () => void;
  onPublishForReview: () => void;
  onClose: () => void;
  /** False outside enforce mode when a photo is held privately: the seller must replace it (see reviewPublishAllowed). Default true. */
  allowReviewPublish?: boolean;
};

const STAGES = ['stagePhotos', 'stageDuplicates', 'stageSafety', 'stageCategory'] as const;

/** `imageScan.issue.<code>.message` may contain {{category}}. */
const fill = (s: string, category: string) => s.replace('{{category}}', category);

export function ImageScanDialog({ state, previews, categoryLabel, onReplace, onRetry, onPublishForReview, onClose, allowReviewPublish = true }: Props) {
  const C = useScanCopy();
  if (state.kind === 'hidden') return null;
  const busy = state.kind === 'checking';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={busy ? C.checking.a11y : undefined}
        className="max-h-[86vh] w-full max-w-[420px] overflow-y-auto rounded-lg bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {state.kind === 'checking' && (
          <div className="text-center" aria-live="polite">
            <Loader2 size={32} className="mx-auto animate-spin text-primary" />
            <h2 className="mt-3 text-lg font-bold text-textPrimary">{C.checking.title}</h2>
            <p className="mt-1 text-sm text-textSecondary">{C.checking.subtitle}</p>
            <ul className="mt-4 space-y-1 text-left">
              {STAGES.map((s) => (
                <li key={s} className="flex items-center gap-2 text-xs text-textSecondary">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border border-textMuted" />
                  {C.checking[s]}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.kind === 'error' && (
          <div>
            <h2 className="text-center text-lg font-bold text-textPrimary">{C.issue.check_failed.title}</h2>
            <p role="alert" className="mt-2 text-center text-sm text-textSecondary">
              {C.errors[state.failure]}
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" fullWidth onClick={onClose}>
                {C.result.close}
              </Button>
              {state.failure === 'unreadable' || state.failure === 'photo_rejected' || state.failure === 'not_verified' ? (
                <Button fullWidth onClick={onReplace}>
                  {C.result.replace}
                </Button>
              ) : state.failure === 'update_required' ? null : (
                <Button fullWidth onClick={onRetry}>
                  {C.result.tryAgain}
                </Button>
              )}
            </div>
          </div>
        )}

        {state.kind === 'result' && (
          <ResultView
            result={state.result}
            previews={previews}
            categoryLabel={categoryLabel}
            onReplace={onReplace}
            onRetry={onRetry}
            onPublishForReview={onPublishForReview}
            onClose={onClose}
            allowReviewPublish={allowReviewPublish}
          />
        )}
      </div>
    </div>
  );
}

function ResultView({ result, previews, categoryLabel, onReplace, onRetry, onPublishForReview, onClose, allowReviewPublish }: Omit<Props, 'state'> & { result: ScanResult; allowReviewPublish: boolean }) {
  const C = useScanCopy();
  const rows = issueRows(result);
  const needsFix = result.outcome === 'needs_changes';
  const mustReplace = needsFix || !allowReviewPublish;
  return (
    <>
      <h2 className="text-center text-lg font-bold text-textPrimary">{needsFix ? C.result.fixTitle : C.result.reviewTitle}</h2>
      <p className="mt-1 text-center text-sm text-textSecondary">{needsFix ? C.result.fixIntro : C.result.reviewIntro}</p>

      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const issue = C.issue[row.code as keyof typeof C.issue];
          return (
            <li key={row.code} className="rounded-md bg-background p-3">
              <div className="flex items-center gap-2">
                {row.severity === 'fix' ? <AlertCircle size={18} className="text-error" aria-hidden /> : <Clock size={18} className="text-textSecondary" aria-hidden />}
                <span className="text-sm font-semibold text-textPrimary">{issue.title}</span>
              </div>
              <p className="mt-1 text-sm text-textSecondary">{fill(issue.message, categoryLabel)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {row.photos.map((n) => (
                  <figure key={n} className="text-center" aria-label={`Photo ${n}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previews[n - 1]} alt="" className="h-[52px] w-[52px] rounded-sm bg-inputBackground object-cover" />
                    <figcaption className="text-xs text-textSecondary">{n}</figcaption>
                  </figure>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 space-y-2">
        {mustReplace ? (
          <>
            {!needsFix && result.canRetry && (
              <Button variant="outline" fullWidth onClick={onRetry}>
                {C.result.tryAgain}
              </Button>
            )}
            <Button fullWidth onClick={onReplace}>
              {C.result.replace}
            </Button>
          </>
        ) : (
          <>
            {result.canRetry && (
              <Button fullWidth onClick={onRetry}>
                {C.result.tryAgain}
              </Button>
            )}
            <Button variant={result.canRetry ? 'outline' : 'primary'} fullWidth onClick={onPublishForReview}>
              {C.result.publishForReview}
            </Button>
            <Button variant="ghost" fullWidth onClick={onReplace}>
              {C.result.replace}
            </Button>
          </>
        )}
        <Button variant="ghost" fullWidth onClick={onClose}>
          {C.result.close}
        </Button>
      </div>
    </>
  );
}
