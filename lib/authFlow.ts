import { useAuthStore } from '@/store/auth';

// Single choke point for "sign in with Google" used by the onboarding Welcome
// screen, the AuthPromptModal, and the guest Profile screen.
export async function performGoogleSignIn(): Promise<{ error?: string }> {
  return useAuthStore.getState().signInWithGoogle();
}
