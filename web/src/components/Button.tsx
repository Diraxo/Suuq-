'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
};

// Mirrors components/Button.tsx on mobile: same variant/size vocabulary,
// pill radius, primary=indigo / secondary=coral / outline & ghost=text-only.
const HEIGHT: Record<Size, string> = { sm: 'h-10', md: 'h-[50px]', lg: 'h-[58px]' };
const PAD_X: Record<Size, string> = { sm: 'px-4', md: 'px-5', lg: 'px-6' };
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primaryText',
  secondary: 'bg-accent text-slate-900',
  outline: 'bg-transparent text-primary border-[1.5px] border-primary',
  ghost: 'bg-transparent text-primary',
  danger: 'bg-error text-white',
};

export function Button({ variant = 'primary', size = 'md', fullWidth, loading, disabled, icon, children, className = '', ...rest }: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-pill font-semibold text-[15px] transition-opacity active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed',
        HEIGHT[size],
        PAD_X[size],
        VARIANT[variant],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
