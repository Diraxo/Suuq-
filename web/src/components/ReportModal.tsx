'use client';

// Web port of app/report/index.tsx on mobile: pick a reason (radio-pill
// list, reason set depends on target type), optional free-text details,
// submit disabled until a reason is picked, an "already reported" state
// instead of letting a duplicate through, and a real Supabase insert on
// confirm — replaces the alert() placeholder that used to stand in for
// this on the listing detail page.
import { useEffect, useState } from 'react';
import { CheckCircle2, Flag, X } from '@/lib/icons';
import { Button } from './Button';
import { REPORT_REASONS } from '@/lib/reportReasons';
import { ReportTargetType, submitReport } from '@/services/reports';
import { useAuthStore } from '@/store/auth';

type Props = {
  open: boolean;
  targetType: ReportTargetType;
  targetId: string;
  alreadyReported: boolean;
  onClose: () => void;
  onSubmitted: () => void;
};

const TITLES: Record<ReportTargetType, string> = {
  listing: 'Report this listing',
  user: 'Report this user',
  review: 'Report this review',
};

export function ReportModal({ open, targetType, targetId, alreadyReported, onClose, onSubmitted }: Props) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(null);
      setDetails('');
      setError(undefined);
      setSubmitted(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    const reporterId = useAuthStore.getState().session?.user.id;
    if (!reason || !reporterId) return;
    setSubmitting(true);
    const { error: submitError } = await submitReport({ reporterId, targetType, targetId, reason, details });
    setSubmitting(false);
    if (submitError) {
      setError(submitError);
      return;
    }
    setSubmitted(true);
    onSubmitted();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={submitting ? undefined : onClose} role="presentation">
      <div className="w-full max-w-[400px] rounded-lg bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flag size={18} className="text-error" />
            <h2 className="text-lg font-bold text-textPrimary">{TITLES[targetType]}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-textMuted">
            <X size={20} />
          </button>
        </div>

        {submitted ? (
          <div className="mt-5 flex flex-col items-center py-4 text-center">
            <CheckCircle2 size={32} className="text-success" />
            <p className="mt-3 text-sm font-medium text-textPrimary">Report received</p>
            <p className="mt-1 text-sm text-textSecondary">Thank you — our team will review it.</p>
            <Button variant="outline" className="mt-4" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : alreadyReported ? (
          <div className="mt-5 flex flex-col items-center py-4 text-center">
            <CheckCircle2 size={32} className="text-success" />
            <p className="mt-3 text-sm font-medium text-textPrimary">Already reported</p>
            <p className="mt-1 text-sm text-textSecondary">You&apos;ve already reported this — our team will review it.</p>
            <Button variant="outline" className="mt-4" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-textSecondary">Reports are confidential. The other party won&apos;t be notified who reported them.</p>

            <div className="mt-4 flex flex-col gap-2">
              {REPORT_REASONS[targetType].map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setReason(r);
                    if (error) setError(undefined);
                  }}
                  className={`flex items-center justify-between rounded-md border-[1.5px] px-3 py-2.5 text-left text-sm ${
                    reason === r ? 'border-error bg-error/5 text-textPrimary' : 'border-border bg-background text-textPrimary'
                  }`}
                >
                  {r}
                  {reason === r && <CheckCircle2 size={18} className="text-error" />}
                </button>
              ))}
            </div>

            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Additional details (optional)"
              rows={3}
              disabled={submitting}
              className="mt-3 w-full resize-none rounded-md border border-border bg-inputBackground px-3 py-2.5 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <p className="mt-1 text-xs text-error">{error}</p>}

            <Button variant="danger" fullWidth className="mt-4" disabled={!reason || submitting} loading={submitting} onClick={handleSubmit}>
              Submit report
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
