import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/store/auth';
import { showSnackbar } from '@/lib/snackbar';
import { WELCOMED_KEY } from '@/data/onboarding';

// Single choke point for "sign in with Google" used by the AuthPromptModal
// and the guest Profile screen.
export async function performGoogleSignIn(): Promise<{ error?: string }> {
  return useAuthStore.getState().signInWithGoogle();
}

// Call after a successful sign-in to surface the right feedback: a one-time
// welcome the very first time this device ever signs in, and a brief
// confirmation snackbar on every sign-in after that.
export async function announceSignInSuccess(): Promise<void> {
  const welcomed = await AsyncStorage.getItem(WELCOMED_KEY).catch(() => null);
  if (!welcomed) {
    AsyncStorage.setItem(WELCOMED_KEY, 'true').catch(() => {});
    showSnackbar("🎉 Welcome to Suuq+! You're all set. Start exploring nearby listings or post your first item.", {
      tone: 'success',
      durationMs: 4500,
    });
    return;
  }
  showSnackbar('Logged in successfully', { tone: 'success', durationMs: 2000 });
}
