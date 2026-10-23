import { CategoryField } from './categoryFields';
import { validateAttributes, sellError } from './sellRules';
import { getPhoneCountry, PhoneCountryCode } from './phoneCountries';

// Title / description / price / attribute rules live in data/sellRules.ts (pure,
// shared verbatim with the website) — re-exported here so existing imports of
// '@/data/validation' keep working.
export {
  TITLE_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  validateTitle,
  validateDescription,
  validatePrice,
  validateAttributes,
  validateSellerNotes,
} from './sellRules';

export const NAME_MAX_LENGTH = 100;

// Used for first/last name in the edit-profile screen — optional overall
// (a blank name is allowed), but if present must be sane.
export function validateName(name: string): string | undefined {
  if (!name.trim()) return undefined;
  if (name.trim().length > NAME_MAX_LENGTH) return `Must be under ${NAME_MAX_LENGTH} characters.`;
  return undefined;
}

// Phone is optional overall (a seller may only accept chat), so this only
// fires once something has been typed — the required digit count depends on
// the selected country (Ethiopia/Somalia have different local number lengths).
// Used by the Sell flow's country + local-number PhoneNumberInput.
export function validatePhoneLocal(country: PhoneCountryCode, local: string): string | undefined {
  if (!local) return undefined;
  const digits = local.replace(/\D/g, '');
  const [min, max] = getPhoneCountry(country).localLength;
  if (digits.length < min || digits.length > max) return sellError('phoneInvalid');
  return undefined;
}

export function validateCity(city: string | undefined): string | undefined {
  if (!city) return sellError('cityChoose');
  return undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Demo/mock listings ('l1', 'l2', ...) are mixed into the public feed alongside
// real Supabase rows. Only real rows have a uuid id and a backing row for
// foreign keys (offers, conversations, favorites, etc.) to point at.
export function isRealListingId(id: string | undefined | null): boolean {
  return !!id && UUID_RE.test(id);
}

/** @deprecated use validateAttributes (also checks types/ranges, not just "required"). */
export function validateRequiredAttributes(fields: CategoryField[], attributes: Record<string, string>): Record<string, string> {
  return validateAttributes(fields, attributes);
}
