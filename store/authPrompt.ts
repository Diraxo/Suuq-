import { create } from 'zustand';
import { useAuthStore } from '@/store/auth';

type AuthPromptState = {
  visible: boolean;
  onSuccess: (() => void) | null;
  /** Run when the prompt is declined (backdrop tap, "Not now", hardware back) — e.g. a screen-level guard navigating back so a guest never lands on a blank protected screen. */
  onCancel: (() => void) | null;
  show: (onSuccess?: () => void, onCancel?: () => void) => void;
  hide: () => void;
};

export const useAuthPromptStore = create<AuthPromptState>((set) => ({
  visible: false,
  onSuccess: null,
  onCancel: null,
  show: (onSuccess, onCancel) => set({ visible: true, onSuccess: onSuccess ?? null, onCancel: onCancel ?? null }),
  hide: () => set({ visible: false, onSuccess: null, onCancel: null }),
}));

// Call this instead of an account-only action directly. Runs the action
// immediately if already signed in; otherwise opens the sign-in prompt and
// runs the action once sign-in succeeds.
export function requireAuth(action?: () => void): void {
  if (useAuthStore.getState().session) {
    action?.();
    return;
  }
  useAuthPromptStore.getState().show(action);
}
