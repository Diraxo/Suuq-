/** Temporary diagnostic: hide the mobile watermark overlay to time the photo viewer with and without it.
 *  Needs BOTH a development build (`__DEV__`) and EXPO_PUBLIC_DIAG_NO_WATERMARK=1 at bundle time, so a
 *  release build can never show unwatermarked photos. Remove once the black-screen investigation is closed. */
export const DIAG_HIDE_WATERMARK: boolean = __DEV__ && process.env.EXPO_PUBLIC_DIAG_NO_WATERMARK === '1';
