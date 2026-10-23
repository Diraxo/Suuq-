// Where tapping a notification goes on the web app. Mirrors navigateForPush() in lib/push.ts on mobile.
// Pure so it can be unit-tested (tests/notificationRoute.test.ts). Every id that ends up in a path must be a uuid:
// notification payloads are data, and a malformed or hostile value must never become an arbitrary route.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = data?.[key];
  return typeof v === 'string' && UUID.test(v) ? v : null;
}

export function notificationHref(rawType: string | null | undefined, data?: Record<string, unknown> | null): string | null {
  switch (rawType) {
    case 'message': {
      const c = id(data, 'conversationId');
      return c ? `/chat/${c}` : '/chat';
    }
    case 'favorite':
    case 'price_drop': {
      const l = id(data, 'listingId');
      return l ? `/listing/${l}` : null;
    }
    case 'follow': {
      const f = id(data, 'followerId');
      return f ? `/seller/${f}` : null;
    }
    case 'offer_new':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_countered':
    case 'offer_cancelled':
    case 'offer_expired': {
      const l = id(data, 'listingId');
      return l ? `/offers?listingId=${l}` : '/offers';
    }
    case 'listing_sold':
      return '/my-listings?tab=sold';
    case 'moderation':
      return '/support';
    case 'support_reply': {
      const c = id(data, 'caseId');
      return c ? `/support/${c}` : '/support';
    }
    case 'verification':
      return '/profile';
    case 'storefront': // verification decisions, suspension / reinstatement (written by migration 0054's staff RPCs)
      return '/business/storefront';
    case 'report_staff': {
      const r = id(data, 'reportId');
      return r ? `/admin/reports/${r}` : '/admin/reports';
    }
    case 'support_staff': {
      const c = id(data, 'caseId');
      return c ? `/admin/support/${c}` : '/admin/support';
    }
    case 'listing_staff': {
      const l = id(data, 'listingId');
      return l && Number(data?.count ?? 1) <= 1 ? `/admin/listings/${l}` : '/admin/listings';
    }
    case 'user_staff': {
      const u = id(data, 'userId');
      return u ? `/admin/users/${u}` : '/admin/users';
    }
    case 'activity_staff': {
      const u = id(data, 'userId');
      return u ? `/admin/users/${u}` : '/admin/users';
    }
    default:
      return null; // report_result, review, system, legacy rows: stay on the list
  }
}
