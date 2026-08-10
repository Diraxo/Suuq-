// AsyncStorage key marking that a device has completed the first-launch
// region/interests picker — shared between app/index.tsx (reads it) and
// (onboarding)/select-interests.tsx (writes it).
export const ONBOARDED_KEY = '@suuq/onboarded';

// AsyncStorage key marking that this device has ever completed a sign-in —
// gates the one-time welcome message in lib/authFlow.ts so it only ever
// shows after a user's very first successful login.
export const WELCOMED_KEY = '@suuq/welcomed';
