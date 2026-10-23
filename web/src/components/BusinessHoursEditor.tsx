'use client';

// Monday–Sunday open/close editor for profiles.business_hours ({ days: { mon: { closed, open, close } } }) — the web twin of
// components/BusinessHoursEditor.tsx on mobile: same value shape, same defaults.
import { DEFAULT_DAY_HOURS, DayHours, HoursDays, WEEK_DAYS, WeekDay } from '@/lib/profileRules';
import { useT } from '@/lib/i18n';

const LABEL: Record<WeekDay, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const TIME = 'rounded-md border border-border bg-inputBackground px-2 py-2 text-sm outline-none focus:border-primary';

export function BusinessHoursEditor({ value, onChange, invalid }: { value: HoursDays; onChange: (next: HoursDays) => void; invalid?: boolean }) {
  const t = useT();
  const dayValue = (day: WeekDay): DayHours => value[day] ?? DEFAULT_DAY_HOURS;
  const update = (day: WeekDay, patch: Partial<DayHours>) => onChange({ ...value, [day]: { ...dayValue(day), ...patch } });

  return (
    <div className="space-y-2" role="group" aria-label={t('seller.hours.title')}>
      {WEEK_DAYS.map((day) => {
        const h = dayValue(day);
        const bad = invalid && !h.closed && h.open >= h.close;
        return (
          <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface px-3 py-2">
            <span className="w-24 text-sm font-medium text-textPrimary">{t.text(LABEL[day])}</span>
            <label className="flex items-center gap-2 text-sm text-textSecondary">
              <input type="checkbox" checked={h.closed} onChange={(e) => update(day, { closed: e.target.checked })} className="h-4 w-4 accent-primary" />
              {t('components.businessHoursEditor.closed')}
            </label>
            {!h.closed && (
              <span className="flex items-center gap-2 text-sm text-textSecondary">
                <input type="time" value={h.open} onChange={(e) => e.target.value && update(day, { open: e.target.value })} className={TIME} aria-label={`${t.text(LABEL[day])} opens`} />
                {t('web.m.timeTo')}
                <input type="time" value={h.close} onChange={(e) => e.target.value && update(day, { close: e.target.value })} className={TIME} aria-label={`${t.text(LABEL[day])}`} />
              </span>
            )}
            {bad && <span className="text-xs text-error">{t('web.t.closingTimeMustBeAfter')}</span>}
          </div>
        );
      })}
    </div>
  );
}
