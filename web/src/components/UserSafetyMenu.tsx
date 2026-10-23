'use client';

// Web twin of components/UserSafetySheet.tsx on mobile: one three-dots menu for the chat header, the listing seller card
// and the profile page — View profile · Report this listing · Report user · Block / Unblock. Nobody sees it for
// themselves. Blocks are enforced by the database (0043/0044); this is only the entry point.
import { useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, Flag, MoreVertical, UserCircle } from 'lucide-react';
import { ReportModal } from '@/components/ReportModal';
import { ReportTargetType, listMyReportedKeys } from '@/services/reports';
import { useAuthStore } from '@/store/auth';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { requireAuth } from '@/store/authPrompt';
import { useT } from '@/lib/i18n';

type Props = {
  userId: string;
  userName: string;
  /** The listing the card/conversation is about — offers "Report this listing" (a separate report category). */
  listingId?: string | null;
  source: 'chat' | 'listing' | 'profile';
  conversationId?: string;
  hideViewProfile?: boolean;
  className?: string;
};

export function UserSafetyMenu({ userId, userName, listingId, source, conversationId, hideViewProfile, className }: Props) {
  const t = useT();
  const meId = useAuthStore((s) => s.session?.user.id);
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<{ type: ReportTargetType; id: string; already: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (meId && meId === userId) return null; // nobody can block or report themselves
  const blockedByMe = blocked.some((b) => b.id === userId);

  const openReport = (type: ReportTargetType, id: string) => {
    setOpen(false);
    requireAuth(
      async () => {
        const uid = useAuthStore.getState().session?.user.id;
        const keys = uid ? await listMyReportedKeys(uid) : new Set<string>();
        setReport({ type, id, already: keys.has(`${type}:${id}`) });
      },
      { next: typeof window === 'undefined' ? undefined : window.location.pathname }
    );
  };

  const toggleBlock = () => {
    setOpen(false);
    requireAuth(async () => {
      if (blockedByMe) {
        if (!window.confirm(t('web.m.unblockConfirm', { name: userName }))) return;
        await useBlockedUsersStore.getState().unblock(userId);
        setNotice(t('seller.unblockedSnackbar', { name: userName }));
      } else {
        if (!window.confirm(`${t('seller.blockConfirmTitle', { name: userName })}\n\n${t('seller.blockConfirmMessage')}`)) return;
        await useBlockedUsersStore.getState().block(userId);
        setNotice(t('seller.blockedSnackbar', { name: userName }));
      }
      setTimeout(() => setNotice(null), 4000);
    });
  };

  const item = 'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-inputBackground';
  const context = source + (conversationId ? ` · conversation ${conversationId}` : '');

  return (
    <div className={`relative ${className ?? ''}`}>
      <button onClick={() => setOpen((v) => !v)} aria-label={t('safety.menuLabel')} aria-haspopup="menu" aria-expanded={open} className="rounded-full p-2 text-textMuted hover:bg-inputBackground">
        <MoreVertical size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} role="presentation" />
          <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
            {!hideViewProfile && (
              <Link href={`/seller/${userId}`} role="menuitem" className={`${item} text-textPrimary`} onClick={() => setOpen(false)}>
                <UserCircle size={18} /> {t('safety.viewProfile')}
              </Link>
            )}
            {listingId && (
              <button role="menuitem" className={`${item} text-textPrimary`} onClick={() => openReport('listing', listingId)}>
                <Flag size={18} /> {t('safety.reportListing')}
              </button>
            )}
            <button role="menuitem" className={`${item} text-textPrimary`} onClick={() => openReport('user', userId)}>
              <Flag size={18} /> {t('safety.reportUser', { name: userName })}
            </button>
            <div className="my-1 h-px bg-border" />
            <button role="menuitem" className={`${item} ${blockedByMe ? 'text-textPrimary' : 'text-error'}`} onClick={toggleBlock}>
              {blockedByMe ? <CheckCircle2 size={18} /> : <Ban size={18} />} {blockedByMe ? `Unblock ${userName}` : `Block ${userName}`}
            </button>
          </div>
        </>
      )}
      {notice && (
        <div role="status" className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-md bg-textPrimary px-4 py-2 text-sm text-background shadow-lg">
          {t.text(notice)}
        </div>
      )}
      <ReportModal
        open={!!report}
        targetType={report?.type ?? 'user'}
        targetId={report?.id ?? ''}
        alreadyReported={!!report?.already}
        context={context}
        chatContext={source === 'chat'}
        onClose={() => setReport(null)}
        onSubmitted={() => setReport((r) => (r ? { ...r, already: true } : r))}
      />
    </div>
  );
}
