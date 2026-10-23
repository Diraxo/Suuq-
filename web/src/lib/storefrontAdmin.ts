// Pure rules for the staff storefront-verification workspace (/admin/businesses). Web only: the app has no admin console.
// Everything here mirrors what migration 0054's staff RPCs enforce (the database is the authority); this only lets the UI
// explain a problem before a round trip and turn the RPCs' own refusals into plain language. Never shows raw database text.

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** One row of admin_list_storefront_reviews(). */
export type ReviewListItem = {
  requestId: string;
  storefrontId: string;
  ownerId: string;
  businessName: string | null;
  status: ReviewStatus;
  documentCount: number;
  submittedAt: string;
};

/** admin_get_storefront_review(). Calling it writes an audit row, so the UI calls it once per open, never on a timer. */
export type ReviewDetail = {
  requestId: string;
  status: ReviewStatus;
  documentPaths: string[];
  ownerNote: string | null;
  submittedAt: string;
  submittedName: string;
  submittedAddress: string | null;
  decisionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  storefront: {
    id: string;
    ownerId: string;
    name: string | null;
    description: string | null;
    address: string | null;
    website: string | null;
    status: 'draft' | 'published' | 'suspended';
    verificationStatus: 'not_requested' | 'pending' | 'verified' | 'rejected';
  };
};

/** One row of admin_list_businesses() (migration 0071): every storefront, whether or not it asked for verification. No contact data. */
export type StorefrontStatus = 'draft' | 'published' | 'suspended';
export type VerificationStatus = 'not_requested' | 'pending' | 'verified' | 'rejected';
export type BusinessListItem = {
  storefrontId: string;
  ownerId: string;
  ownerName: string | null;
  ownerAccountStatus: 'active' | 'suspended' | 'banned';
  businessName: string | null;
  status: StorefrontStatus;
  verificationStatus: VerificationStatus;
  publishedAt: string | null;
  verifiedAt: string | null;
  suspendedAt: string | null;
  updatedAt: string;
  activeListings: number;
  openUserReports: number;
  openListingReports: number;
  /** The pending verification request, when there is one. Opening it goes through the audited review flow. */
  pendingRequestId: string | null;
};

export type BusinessFilters = { status: StorefrontStatus | null; verification: VerificationStatus | null; search: string };

export type BusinessActions = {
  /** Staff cannot moderate their own storefront (the RPCs refuse it; the UI explains instead of showing a dead button). */
  ownBusiness: boolean;
  review: boolean;
  suspend: boolean;
  reinstate: boolean;
  revoke: boolean;
};

/**
 * Which directory actions apply, mirroring admin_set_storefront_status / admin_revoke_storefront_verification / the review flow.
 * Publication (suspend, reinstate) and verification (review, revoke) are listed separately on purpose: approving one never implies the other.
 */
export function businessActions(b: Pick<BusinessListItem, 'ownerId' | 'status' | 'verificationStatus' | 'pendingRequestId'>, staffId: string | null | undefined): BusinessActions {
  const own = !!staffId && b.ownerId === staffId;
  return {
    ownBusiness: own,
    review: !own && b.verificationStatus === 'pending' && !!b.pendingRequestId,
    suspend: !own && b.status !== 'suspended',
    reinstate: !own && b.status === 'suspended',
    revoke: !own && b.verificationStatus === 'verified',
  };
}

/** Plain words for the two separate states, so a published business is never described as "approved" or "verified" by accident. */
export const PUBLICATION_LABEL: Record<StorefrontStatus, string> = { draft: 'Not published', published: 'Published', suspended: 'Suspended' };
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  not_requested: 'Not verified',
  pending: 'Verification pending',
  verified: 'Verified',
  rejected: 'Verification rejected',
};

/** Wording for the confirmation dialog of each consequential action (shared by the request view and the directory). */
export type StaffAction = 'approve' | 'reject' | 'revoke' | 'suspend' | 'reinstate';
export const ACTION_COPY: Record<StaffAction, { title: string; confirm: string; danger?: boolean; description: string }> = {
  approve: { title: 'Approve verification', confirm: 'Approve', description: 'The business gets a Verified badge and is notified. Only approve if the documents match the name and address shown. This does not change whether the storefront is published.' },
  reject: { title: 'Reject verification', confirm: 'Reject', danger: true, description: 'The owner is notified and can submit new documents. Your message below is the only text they see.' },
  revoke: { title: 'Remove verification', confirm: 'Remove verification', danger: true, description: 'The Verified badge is removed and the owner is notified. The storefront stays published.' },
  suspend: { title: 'Suspend storefront', confirm: 'Suspend', danger: true, description: 'The storefront disappears from public view and the owner cannot edit or publish it. The owner’s account and listings are not changed. The owner is notified.' },
  reinstate: { title: 'Reinstate storefront', confirm: 'Reinstate', description: 'The storefront returns to the state it was in before suspension (a draft stays unpublished). The owner is notified.' },
};

export const MIN_REASON = 10;
export const MAX_MESSAGE = 1000;

/** The decision RPCs refuse a reason shorter than 10 characters (after trimming). */
export const reasonOk = (reason: string): boolean => reason.trim().length >= MIN_REASON;

/** The approve RPC refuses when the storefront's name/address no longer equal what the documents were submitted for. */
export function identityChanged(d: Pick<ReviewDetail, 'submittedName' | 'submittedAddress' | 'storefront'>): boolean {
  return (d.storefront.name ?? null) !== d.submittedName || (d.storefront.address ?? null) !== (d.submittedAddress ?? null);
}

export type ReviewActions = {
  approve: boolean;
  reject: boolean;
  revoke: boolean;
  suspend: boolean;
  reinstate: boolean;
  /** Why approve is unavailable even though the request is pending (so the UI can say so instead of showing a dead button). */
  approveBlockedBy: null | 'identityChanged' | 'suspended';
};

/** Which staff actions apply to this request/storefront, mirroring the RPC preconditions. */
export function reviewActions(d: ReviewDetail): ReviewActions {
  const pending = d.status === 'pending' && d.storefront.verificationStatus === 'pending';
  const suspended = d.storefront.status === 'suspended';
  const approveBlockedBy = !pending ? null : suspended ? 'suspended' : identityChanged(d) ? 'identityChanged' : null;
  return {
    approve: pending && !approveBlockedBy,
    reject: pending,
    revoke: d.storefront.verificationStatus === 'verified',
    suspend: !suspended,
    reinstate: suspended,
    approveBlockedBy,
  };
}

/** Label for a document button from its path. Never shows the owner's id or the generated file name. */
export function documentLabel(path: string, index: number): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toUpperCase() ?? 'FILE';
  return `Document ${index + 1} (${ext})`;
}

type PgLike = { code?: string; message?: string } | null | undefined;

/** Plain-language text for a staff RPC refusal. */
export function adminErrorMessage(error: PgLike): string {
  const code = error?.code ?? '';
  const m = error?.message ?? '';
  if (code === '42P01' || code === '42883' || code === 'PGRST205' || code === 'PGRST202') return 'Storefront review isn’t available on this project yet.';
  if (code === '42501') return /own storefront/i.test(m) ? 'You can’t review your own storefront.' : 'You don’t have permission to do that.';
  if (code === '22023') return /reason/i.test(m) ? `Give a reason of at least ${MIN_REASON} characters.` : /message/i.test(m) ? 'The message to the owner is too long.' : 'Those details aren’t valid.';
  if (code === '23505') return /already decided/i.test(m) ? 'Someone already decided this request. Reload to see the outcome.' : 'That change was already made.';
  if (code === '23514') {
    if (/identity changed/i.test(m)) return 'The business changed its name or address after submitting. Reject it and ask the owner to resubmit.';
    if (/reinstate/i.test(m)) return 'Reinstate the suspended storefront before approving.';
    if (/not awaiting/i.test(m)) return 'This storefront is no longer awaiting verification. Reload.';
    if (/not suspended/i.test(m)) return 'This storefront isn’t suspended.';
    if (/not verified/i.test(m)) return 'This storefront isn’t verified.';
    return 'That change isn’t allowed in the current state.';
  }
  if (code === 'P0002') return 'That request or storefront no longer exists.';
  return 'Something went wrong. Please try again.';
}

/** Outcome of asking the verification-document Edge Function for a signed URL, by HTTP status (see verificationDocumentHandler). */
export function documentOpenMessage(status: number | null | undefined): string {
  switch (status) {
    case 401:
      return 'Your session has expired. Sign in again.';
    case 403:
      return 'You don’t have permission to open documents.';
    case 404:
      return 'That document couldn’t be found for this request.';
    case 400:
      return 'That document reference isn’t valid.';
    default:
      return 'The document couldn’t be opened. Nothing was shown; try again.';
  }
}

/** The function answers with { signedUrl, expiresInSeconds }; anything else (or a non-https URL) is treated as a failure. */
export function parseSignedUrl(body: unknown): { url: string; expiresInSeconds: number } | null {
  const b = body as { signedUrl?: unknown; expiresInSeconds?: unknown } | null;
  if (!b || typeof b.signedUrl !== 'string') return null;
  try {
    const u = new URL(b.signedUrl);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return null;
    return { url: u.toString(), expiresInSeconds: typeof b.expiresInSeconds === 'number' ? b.expiresInSeconds : 120 };
  } catch {
    return null;
  }
}
