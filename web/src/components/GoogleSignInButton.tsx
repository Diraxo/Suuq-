'use client';

import { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { GoogleLogo } from './GoogleLogo';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  loading?: boolean;
};

// Mirrors components/GoogleSignInButton.tsx on mobile: 54px pill, white on
// light / dark on dark, 26px icon box, 20px semibold label.
export function GoogleSignInButton({ label, loading, disabled, className = '', ...rest }: Props) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-label={label}
      className={[
        'inline-flex h-[54px] w-full items-center justify-center rounded-full border px-4',
        'border-[#747775] bg-white text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]',
        'text-xl font-semibold leading-none transition-opacity active:opacity-85 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2 size={20} className="animate-spin" />
      ) : (
        <>
          <span className="flex h-[26px] w-[26px] items-center justify-center">
            <GoogleLogo size={22} />
          </span>
          <span className="ml-2.5 truncate">{label}</span>
        </>
      )}
    </button>
  );
}
