// Which URLs the app may hand to the operating system. Pure (tested in tests/routeParams.test.ts).
// Only web pages, phone numbers and mail: a stored profile link must never be able to start another app's custom scheme
// (intent:, file:, javascript:, data:, market:, ...).

const WEB = /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i;
const TEL = /^tel:\+?[0-9 ()-]{3,30}$/i;
const MAIL = /^mailto:[^\s@]+@[^\s@]+$/i;

export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 2048 && (WEB.test(url) || TEL.test(url) || MAIL.test(url));
}
