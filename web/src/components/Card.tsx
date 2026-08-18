import { HTMLAttributes } from 'react';

export function Card({ elevated = true, className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return (
    <div
      className={`rounded-lg bg-surface p-4 ${elevated ? 'shadow-sm' : 'border border-border'} ${className}`}
      {...rest}
    />
  );
}
