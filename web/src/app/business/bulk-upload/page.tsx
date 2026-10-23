'use client';

// Web twin of app/business/bulk-upload.tsx: pick a CSV, review every row against the same rules as Create Listing, then
// import. While the server enforces photo checks (migration 0050/0051) the rows go through the photo queue — the server
// fetches, checks and watermarks the photos and BulkQueuePanel publishes what is ready; otherwise listings are written
// directly, exactly like the app. The CSV is read in the browser as plain text and never uploaded as a file.
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, FileText, XCircle } from '@/lib/icons';
import { BulkQueuePanel } from '@/components/BulkQueuePanel';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { chooseBulkPath } from '@/lib/bulkImageQueue';
import { activeBulkBatch, BulkEnqueueError, enqueueBulk } from '@/lib/bulkQueueClient';
import { conditionApplies } from '@/lib/sellRules';
import { BULK_MAX_FILE_BYTES, BULK_MAX_ROWS, BulkRow, bulkUploadTemplate, parseBulkRow } from '@/lib/bulkUpload';
import { csvRowsToObjects, parseCsv } from '@/lib/csv';
import { createListing } from '@/services/listings';
import { fetchScanPolicy } from '@/services/imageScan';
import { useLocations } from '@/services/locations';
import { useAuthStore } from '@/store/auth';
import { activeMode } from '@/lib/profileIdentity';
import { useT } from '@/lib/i18n';
import { bulkErrorText } from '@/lib/bulkErrorText';

type Phase = 'pick' | 'preview' | 'uploading' | 'queued' | 'summary';
type UploadResult = { row: BulkRow; success: boolean; error?: string };

const QUEUE_ERRORS: Record<string, string> = {
  disabled: 'Bulk upload with photos isn’t available yet. Your file is not lost — try again later, or add listings one by one.',
  quota: 'You’ve reached today’s photo limit for bulk upload. Please try again tomorrow.',
  batch_active: 'You already have a bulk upload in progress. Finish or cancel it first.',
  too_many_rows: 'This file has too many listings for one upload. Please split it into smaller files.',
  bad_input: 'Some photo links aren’t valid. Photo links must be plain https addresses, with 1 to 5 per listing.',
  failed: 'We couldn’t start the upload. Please try again.',
};

export default function BulkUploadPage() {
  const t = useT();
  const router = useRouter();
  const authed = useRequireAuthPage('/business/bulk-upload');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  // Bulk upload is a business tool: listings carry the profile the owner has active when the batch starts, stored per listing.
  const presentation = useAuthStore((s) => activeMode(s.profile));
  const { index, status: locationsStatus } = useLocations();
  const input = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<UploadResult[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);

  // Resume the progress view if a bulk import is still open (the queue keeps working while the page is closed).
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    void activeBulkBatch().then((id) => {
      if (alive && id) {
        setBatchId(id);
        setPhase('queued');
      }
    });
    return () => {
      alive = false;
    };
  }, [authed]);

  // Re-validate against the directory once it has loaded (city names are checked against it).
  useEffect(() => {
    if (rawRows.length > 0 && locationsStatus === 'ready') setRows(rawRows.map((r) => parseBulkRow(r, index)));
  }, [rawRows, index, locationsStatus]);

  if (!authed || !userId) return <div className="min-h-[50vh]" />;

  const reset = () => {
    setBatchId(null);
    setPhase('pick');
    setFileName(null);
    setRawRows([]);
    setRows([]);
    setResults([]);
    setError(null);
    setProgress({ done: 0, total: 0 });
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size === 0) return setError(t('storefront.documentRejected.empty'));
    if (file.size > BULK_MAX_FILE_BYTES) return setError(t('web.t.thatFileIsTooLarge'));
    if (!/\.(csv|txt)$/i.test(file.name)) return setError(t('web.t.chooseACsvFileExport'));
    try {
      const text = (await file.text()).replace(/^﻿/, ''); // Excel adds a byte-order mark
      if (text.includes('\u0000')) return setError(t('web.t.thatDoesnTLookLike'));
      const objects = csvRowsToObjects(parseCsv(text));
      if (objects.length === 0) return setError(t('business.bulkUpload.emptyFileMessage'));
      if (objects.length > BULK_MAX_ROWS) return setError(t('web.m.csvTooManyRows', { count: objects.length, max: BULK_MAX_ROWS }));
      setFileName(file.name);
      setRawRows(objects);
      setRows(locationsStatus === 'ready' ? objects.map((r) => parseBulkRow(r, index)) : []);
      setPhase('preview');
    } catch {
      setError(t('web.t.couldNotReadThatFile'));
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    void readFile(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void readFile(e.dataTransfer.files?.[0]);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([bulkUploadTemplate()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-upload-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidCount = rows.length - validRows.length;

  const startUpload = async () => {
    if (validRows.length === 0) return;
    setError(null);

    // The SERVER decides: while photo checks are enforced, photos must be fetched, checked and watermarked by the queue.
    if (chooseBulkPath(await fetchScanPolicy()) === 'queue') {
      setPhase('uploading');
      setProgress({ done: 0, total: validRows.length });
      try {
        const queued = await enqueueBulk(
          validRows.map((r) => ({
            payload: { title: r.title, description: r.description, price: r.price, category: r.categoryId, categoryName: r.categoryName, condition: r.condition, city: r.city, sellerPresentation: presentation },
            photoUrls: r.images,
          })),
        );
        setBatchId(queued.batchId);
        setPhase('queued');
      } catch (e) {
        setError(QUEUE_ERRORS[e instanceof BulkEnqueueError ? e.kind : 'failed']);
        setPhase('preview');
      }
      return;
    }

    setPhase('uploading');
    setProgress({ done: 0, total: validRows.length });
    const outcomes: UploadResult[] = [];
    for (const row of validRows) {
      const { error: err } = await createListing(userId, {
        title: row.title,
        description: row.description,
        category: row.categoryId,
        condition: row.condition,
        price: row.price,
        currency: row.currency,
        city: row.city,
        region: row.region,
        images: row.images,
        negotiable: false,
        sellerPresentation: presentation,
      });
      outcomes.push({ row, success: !err, error: err ? ((err as { message?: string }).message ?? t('business.bulkUpload.unknownError')) : undefined });
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setResults(outcomes);
    setPhase('summary');
  };

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('business.bulkUpload.title')} fallbackHref="/business/dashboard" />

        {phase === 'pick' && (
          <>
            <p className="mb-4 text-sm text-textSecondary">{t('business.bulkUpload.description')}</p>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed p-10 text-center ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              <FileText size={28} className="text-textMuted" />
              <span className="mt-2 text-sm font-medium text-textPrimary">{t('web.t.clickToChooseACsv')}</span>
              <span className="mt-1 text-xs text-textMuted">{t('business.bulkUpload.downloadTemplateHint')}</span>
            </button>
            <input ref={input} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onPick} aria-label={t('web.t.chooseCsvFile')} />
            {error && (
              <p className="mt-3 text-sm text-error" role="alert">
                {t.text(error)}
              </p>
            )}
            <Card elevated={false} className="mt-4 text-xs text-textSecondary">
              {t('business.bulkUpload.expectedColumns', { columns: BULK_COLUMNS })}
            </Card>
            <div className="mt-6">
              <Button variant="outline" onClick={downloadTemplate}>
                {t('business.bulkUpload.downloadTemplate')}
              </Button>
            </div>
          </>
        )}

        {phase === 'preview' && (
          <>
            <p className="text-sm text-textSecondary">{fileName}</p>
            {locationsStatus !== 'ready' ? (
              <p className="mt-3 text-sm text-textSecondary">{locationsStatus === 'error' ? t('web.t.couldNotLoadTheList') : t('web.t.checkingYourRows')}</p>
            ) : (
              <p className="mb-4 mt-1 text-sm font-medium text-textPrimary">
                {invalidCount > 0 ? t('business.bulkUpload.rowsReadyWithErrors', { valid: validRows.length, total: rows.length, invalid: invalidCount }) : t('business.bulkUpload.rowsReady', { valid: validRows.length, total: rows.length })}
              </p>
            )}
            {error && (
              <p className="mb-3 text-sm text-error" role="alert">
                {t.text(error)}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <li key={i}>
                  <Card elevated={false} className={r.errors.length ? '!border-error' : '!border-success'}>
                    <div className="flex items-center gap-2">
                      {r.errors.length ? <XCircle size={18} className="shrink-0 text-error" /> : <CheckCircle2 size={18} className="shrink-0 text-success" />}
                      <span className="truncate text-sm font-medium text-textPrimary">
                        {i + 1}. {r.title || '(untitled)'}
                      </span>
                    </div>
                    {r.errors.length === 0 ? (
                      <p className="mt-0.5 text-xs text-textSecondary">
                        {[r.categoryName, conditionApplies(r.categoryId) ? r.condition : null, r.city].filter(Boolean).join(' · ')}
                      </p>
                    ) : (
                      r.errors.map((e, k) => (
                        <p key={k} className="mt-0.5 text-xs text-error">
                          {bulkErrorText(t, e)}
                        </p>
                      ))
                    )}
                  </Card>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-3">
              <Button variant="ghost" onClick={reset}>
                {t('business.bulkUpload.chooseDifferentFile')}
              </Button>
              <Button onClick={startUpload} disabled={validRows.length === 0 || locationsStatus !== 'ready'}>
                {t('business.bulkUpload.uploadCount', { count: validRows.length })}
              </Button>
            </div>
          </>
        )}

        {phase === 'uploading' && (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-2xl font-bold text-textPrimary">
              {progress.done} / {progress.total}
            </p>
            <p className="mt-1 text-sm text-textSecondary">{t('business.bulkUpload.uploadingListings')}</p>
            <div className="mt-4 h-2 w-full overflow-hidden rounded bg-border">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {phase === 'queued' && batchId && <BulkQueuePanel batchId={batchId} userId={userId} index={index} onPublishedSome={() => undefined} onClose={() => router.push('/my-listings')} />}

        {phase === 'summary' && (
          <>
            <div className="flex flex-col items-center py-6 text-center">
              {failed.length === 0 ? <CheckCircle2 size={44} className="text-success" /> : <AlertCircle size={44} className="text-warning" />}
              <h2 className="mt-2 text-lg font-bold text-textPrimary">
                {t('business.bulkUpload.published', { count: succeeded })}
              </h2>
              {(failed.length > 0 || invalidCount > 0) && (
                <p className="mt-1 text-sm text-textSecondary">
                  {failed.length > 0 ? `${t('business.bulkUpload.failedToUpload', { count: failed.length })} ` : ''}
                  {invalidCount > 0 ? t('business.bulkUpload.skippedInvalid', { count: invalidCount }) : ''}
                </p>
              )}
            </div>
            {failed.length > 0 && (
              <ul className="flex flex-col gap-2">
                {failed.map((f, i) => (
                  <li key={i}>
                    <Card elevated={false} className="!border-error">
                      <p className="truncate text-sm font-medium text-textPrimary">{f.row.title || '(untitled)'}</p>
                      <p className="mt-0.5 text-xs text-error">{f.error ?? t('business.bulkUpload.unknownError')}</p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex gap-3">
              <Button variant="outline" onClick={reset}>
                {t('business.bulkUpload.uploadAnotherFile')}
              </Button>
              <Button onClick={() => router.push('/my-listings')}>{t('common.done')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const BULK_COLUMNS = 'title, description, price, category, condition, city, image_urls';
