'use client';

import { useState } from 'react';
import { X } from '@/lib/icons';
import { Button } from './Button';

// Shared "confirm + reason" prompt for every admin write action (warn,
// suspend/unsuspend, remove/restore listing, report status change) — same
// overlay/sheet pattern as SignInModal.tsx. The reason typed here is what
// ends up in admin_audit_log.reason (and, for warn_user, in the notification
// sent to the user), so it's required by default.
export function AdminActionModal({
  open,
  title,
  description,
  confirmLabel,
  danger,
  requireReason = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<{ error?: string } | void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleConfirm = async () => {
    if (requireReason && !reason.trim()) {
      setError('A reason is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await onConfirm(reason.trim());
    setSubmitting(false);
    if (result && 'error' in result && result.error) {
      setError(result.error);
      return;
    }
    setReason('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-xl bg-surface p-6 pb-8 shadow-md md:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-textPrimary">{title}</h2>
          <button onClick={onClose} aria-label="Dismiss" className="rounded-full p-1 hover:bg-inputBackground">
            <X size={18} className="text-textMuted" />
          </button>
        </div>
        {description && <p className="mt-1 text-sm text-textSecondary">{description}</p>}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={requireReason ? 'Reason (required)' : 'Note (optional)'}
          rows={3}
          className="mt-4 w-full rounded-md border border-border bg-inputBackground p-3 text-sm text-textPrimary outline-none focus:border-primary"
        />
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
        <div className="mt-5 flex gap-3">
          <Button variant="outline" fullWidth onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} fullWidth loading={submitting} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
