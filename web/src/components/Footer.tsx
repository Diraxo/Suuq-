import Link from 'next/link';
import { Logo } from './Logo';

// Desktop-only footer — the mobile app has no equivalent (its legal links
// live under Settings/About), so this exists purely to make the desktop
// layout read as a real website rather than a stretched phone screen.
export function Footer() {
  return (
    <footer className="mt-16 hidden border-t border-border bg-surface md:block">
      <div className="mx-auto max-w-content px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-textSecondary">
              A marketplace built around how people already do business — browse, search, message sellers, and list an item in minutes.
            </p>
          </div>
          <div className="flex flex-wrap gap-12">
            <div>
              <p className="text-sm font-semibold text-textPrimary">Company</p>
              <ul className="mt-3 space-y-2 text-sm text-textSecondary">
                <li><Link href="/about" className="hover:text-textPrimary">About Fursad</Link></li>
                <li><Link href="/settings/safety" className="hover:text-textPrimary">Community Guidelines</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-textPrimary">Legal</p>
              <ul className="mt-3 space-y-2 text-sm text-textSecondary">
                <li><Link href="/settings/privacy-policy" className="hover:text-textPrimary">Privacy Policy</Link></li>
                <li><Link href="/settings/terms" className="hover:text-textPrimary">Terms &amp; Conditions</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-textPrimary">Support</p>
              <ul className="mt-3 space-y-2 text-sm text-textSecondary">
                <li><a href="mailto:fursadsupport@gmail.com" className="hover:text-textPrimary">Contact support</a></li>
                <li><Link href="/settings/language" className="hover:text-textPrimary">Language</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-10 text-xs text-textMuted">© {new Date().getFullYear()} Fursad. All rights reserved.</p>
      </div>
    </footer>
  );
}
