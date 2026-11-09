type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'solid' | 'sale';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface text-textSecondary border border-border',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  // Discount red: #DC2626 with white text is about 4.8:1 (AA).
  sale: 'bg-[#DC2626] text-white font-bold shadow-sm',
  solid: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-medium capitalize ${TONE[tone]}`}>{label}</span>
  );
}
