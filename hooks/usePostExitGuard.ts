import { useEffect } from 'react';
import { Alert, BackHandler } from 'react-native';
import { useRouter } from 'expo-router';
import { usePostDraft, PostStep } from '@/store/postDraft';
import i18n from '@/lib/i18n';

/**
 * Shared "leaving the Sell flow" guard used by every step screen.
 *
 * - Tracks `currentStep` in the persisted draft once hydrated, so re-opening
 *   Sell can jump straight back to where the seller left off (the `index`
 *   step manages this itself instead, since it's also the one deciding
 *   whether to redirect elsewhere — see app/post/index.tsx).
 * - Returns `confirmLeave`, wired to each screen's `StepHeader onClose` so
 *   it can act as a real multi-step "Back": on steps 2–6 it just pops to the
 *   previous step (no dialog — the whole point of a wizard is that going
 *   back a step isn't "leaving"). Only step 1 (`step === null`, since that's
 *   the one screen that doesn't have a previous step to fall back to) shows
 *   the leave-listing confirmation, because from there Back truly exits the
 *   Sell flow.
 * - Also intercepts the Android hardware back button with the same guard,
 *   since swipe-to-dismiss is disabled at the navigator level (app/_layout.tsx)
 *   but hardware back is a separate removal vector.
 *
 * Lives under hooks/ (not app/post/) so expo-router's file-based routing
 * doesn't try to treat it as a route screen.
 */
export function usePostExitGuard(step: PostStep | null) {
  const router = useRouter();
  const hasDraftContent = usePostDraft((s) => s.hasDraftContent);
  const setField = usePostDraft((s) => s.setField);
  const hasHydrated = usePostDraft((s) => s.hasHydrated);
  const resetDraft = usePostDraft((s) => s.reset);
  const isFirstStep = step === null;

  useEffect(() => {
    if (step && hasHydrated) setField('currentStep', step);
  }, [step, hasHydrated]);

  const discardDraft = () => {
    Alert.alert(i18n.t('post.exitGuard.discardTitle'), i18n.t('post.exitGuard.discardMessage'), [
      { text: i18n.t('common.cancel'), style: 'cancel' },
      {
        text: i18n.t('post.exitGuard.discardButton'),
        style: 'destructive',
        onPress: () => {
          resetDraft();
          router.back();
        },
      },
    ]);
  };

  const confirmLeave = () => {
    // Steps 2–6: Back always just goes to the previous step. Every field
    // already entered lives in the persisted draft, so nothing is lost and
    // there's nothing to confirm.
    if (!isFirstStep) {
      router.back();
      return;
    }
    if (!hasDraftContent()) {
      router.back();
      return;
    }
    Alert.alert(i18n.t('post.exitGuard.leaveTitle'), i18n.t('post.exitGuard.leaveMessage'), [
      { text: i18n.t('post.exitGuard.continueEditing'), style: 'cancel' },
      { text: i18n.t('post.exitGuard.saveAndExit'), onPress: () => router.back() },
      { text: i18n.t('post.exitGuard.discardButton'), style: 'destructive', onPress: discardDraft },
    ]);
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeave();
      return true;
    });
    return () => sub.remove();
  });

  return confirmLeave;
}
