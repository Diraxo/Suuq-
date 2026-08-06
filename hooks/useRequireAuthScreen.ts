import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { useAuthPromptStore } from '@/store/authPrompt';

/**
 * Screen-level guard for account-only routes (My Listings, Notifications,
 * Offers, Reviews, Report, Favorites, Chat, Edit Profile, ...). Most of these
 * are also gated at their nav entry point via `requireAuth`, but a guest can
 * still land here directly (deep link, back-stack, an entry point that
 * forgot to gate), so every such screen calls this too as the real
 * guarantee: no session -> immediately show the sign-in prompt, and go back
 * if it's declined so the guest never sees the screen's real content.
 *
 * Returns whether the screen is authed and safe to render its real content.
 */
export function useRequireAuthScreen(): boolean {
  const session = useAuthStore((s) => s.session);
  const router = useRouter();

  useEffect(() => {
    if (session) return;
    if (useAuthPromptStore.getState().visible) return;
    useAuthPromptStore.getState().show(undefined, () => {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/home');
    });
  }, [session, router]);

  return !!session;
}
