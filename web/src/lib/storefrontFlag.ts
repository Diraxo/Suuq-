// Off unless the build opts in. The storefront pages call tables and RPCs from migration 0054, which is not applied to any
// project yet; until it is (and the owner has approved), no entry point to them is shown. Set NEXT_PUBLIC_STOREFRONTS_ENABLED=true
// in a build that targets a database where 0054 has been applied.
export const STOREFRONTS_ENABLED = process.env.NEXT_PUBLIC_STOREFRONTS_ENABLED === 'true';
