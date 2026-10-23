'use client';

import { useState } from 'react';
import { X } from '@/lib/icons';
import { Button } from './Button';

export type AdminActionExtra = { message?: string; until?: string };

// Shared "confirm + reason" prompt for every admin write action (warn,
// suspend/unsuspend, remove/restore listing, report status change) — same
// overlay/sheet pattern as SignInModal.tsx. The reason typed here is the INTERNAL justification written to the
// audit trail; it is never shown to the seller. Actions that notify the seller can also ask for an optional
// message that IS shown to them (as "Suuqiye Support Team"), and suspensions ask for an end date.
export function AdminActionModal({
  open,
  title,
  description,
  confirmLabel,
  danger,
  requireReason = true,
  showMessage = false,
  showUntil = false,
  defaultUntilDays = 7,
  confirmPhrase,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  requireReason?: boolean;
  /** Ask for a message that is shown to the seller (optional). */
  showMessage?: boolean;
  /** Ask for a suspension end date (required, must be in the future). */
  showUntil?: boolean;
  defaultUntilDays?: number;
  /** Irreversible actions: the reviewer must type this exact word before the confirm button works. */
  confirmPhrase?: string;
  onConfirm: (reason: string, extra: AdminActionExtra) => Promise<{ error?: string } | void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const defaultUntil = () => {
    const d = new Date(Date.now() + defaultUntilDays * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const untilValue = until || (showUntil ? defaultUntil() : '');

  const handleConfirm = async () => {
    if (requireReason && !reason.trim()) {
      setError('A reason is required.');
      return;
    }
    let untilIso: string | undefined;
    if (showUntil) {
      const t = new Date(untilValue).getTime();
      if (!Number.isFinite(t) || t <= Date.now()) {
        setError('Choose an end date in the future.');
        return;
      }
      untilIso = new Date(t).toISOString();
    }
    if (confirmPhrase && typed.trim() !== confirmPhrase) {
      setError(`Type ${confirmPhrase} to confirm.`);
      return;
    }
    if (submitting) return; // a double click must never send the action twice
    setSubmitting(true);
    setError(null);
    const result = await onConfirm(reason.trim(), { message: message.trim() || undefined, until: untilIso });
    setSubmitting(false);
    if (result && 'error' in result && result.error) {
      setError(result.error);
      return;
    }
    setReason('');
    setMessage('');
    setUntil('');
    setTyped('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-xl bg-surface p-6 pb-8 shadow-md md:rounded-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-textPrimary">{title}</h2>
          <button onClick={onClose} aria-label="Dismiss" className="rounded-full p-1 hover:bg-inputBackground">
            <X size={18} className="text-textMuted" />
          </button>
        </div>
        {description && <p className="mt-1 text-sm text-textSecondary">{description}</p>}
        {showUntil && (
          <label className="mt-4 block text-xs font-medium text-textSecondary">
            Suspension ends
            <input
              type="datetime-local"
              value={untilValue}
              onChange={(e) => setUntil(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-inputBackground p-2 text-sm text-textPrimary outline-none focus:border-primary"
            />
          </label>
        )}
        <label className="mt-4 block text-xs font-medium text-textSecondary">
          {requireReason ? 'Internal reason (required, never shown to the seller)' : 'Internal note (optional)'}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm text-textPrimary outline-none focus:border-primary"
          />
        </label>
        {showMessage && (
          <label className="mt-3 block text-xs font-medium text-textSecondary">
            Message to the seller (optional — sent as “Suuqiye Support Team”)
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm text-textPrimary outline-none focus:border-primary"
            />
          </label>
        )}
        {confirmPhrase && (
          <label className="mt-3 block text-xs font-medium text-textSecondary">
            Type {confirmPhrase} to confirm this cannot be undone by accident
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-border bg-inputBackground p-2 text-sm text-textPrimary outline-none focus:border-primary"
            />
          </label>
        )}
        {error && (
          <p className="mt-2 text-sm text-error" role="alert">
            {error}
          </p>
        )}
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
