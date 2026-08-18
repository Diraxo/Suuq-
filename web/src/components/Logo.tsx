import Image from 'next/image';
import Link from 'next/link';

// Real Fursad brand asset (assets/images/fursad-logo.png in the mobile repo)
// — never a text "F" placeholder.
export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`} aria-label="Fursad home">
      <Image src="/fursad-logo.png" alt="Fursad" width={32} height={32} className="rounded-lg" priority />
      <span className="text-lg font-bold text-textPrimary">Fursad</span>
    </Link>
  );
}
