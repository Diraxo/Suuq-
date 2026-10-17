// Same stable-English reason lists as app/report/index.tsx on mobile (there
// they're i18n keys resolved through REASON_EN before being stored; the
// website has no UI-string i18n layer, so the label shown to the user and
// the value stored in `reports.reason` are the same string here — kept
// identical to mobile's English values for admin-dashboard consistency).
import { ReportTargetType } from '@/services/reports';

// A user reported from inside a chat (same list as mobile's CHAT_USER_REASON_KEYS).
export const CHAT_USER_REPORT_REASONS = ['Harassment', 'Scam or fraud', 'Pressure to pay outside the app', 'Spam messages', 'Inappropriate messages', 'Fake profile'];

export const REPORT_REASONS: Record<ReportTargetType, string[]> = {
  listing: ['Scam or fraud', 'Prohibited item', 'Duplicate listing', 'Wrong category', 'Offensive content'],
  user: ['Scam or fraud', 'Harassment', 'Fake profile', 'Spam messages', 'Offensive behavior'],
  review: ['Fake review', 'Offensive language', 'Harassment', 'Irrelevant to item'],
};
