'use client';

import { ChevronLeft, X } from '@/lib/icons';
import { useSellT } from '@/lib/sellI18n';

// Mirrors components/StepHeader.tsx on mobile: progress bar + close/back +
// title/subtitle, identical "step X of N" convention.
export function StepHeader({
  step,
  totalSteps,
  title,
  subtitle,
  onClose,
}: {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const t = useSellT();
  const isFirstStep = step === 1;
  return (
    <div className="pt-2">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={onClose} aria-label={isFirstStep ? t('common.close') : t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
          {isFirstStep ? <X size={22} /> : <ChevronLeft size={22} />}
        </button>
        <span className="text-sm text-textMuted">
          {t('components.stepHeader.stepOf', { step, total: totalSteps })}
        </span>
      </div>
      <div className="mb-4 h-1 rounded-pill bg-border">
        <div className="h-full rounded-pill bg-primary transition-all" style={{ width: `${(step / totalSteps) * 100}%` }} />
      </div>
      <h1 className="text-xl font-bold text-textPrimary">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-textSecondary">{subtitle}</p>}
    </div>
  );
}
