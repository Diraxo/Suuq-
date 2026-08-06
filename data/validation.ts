import { CategoryField } from './categoryFields';
import { getPhoneCountry, PhoneCountryCode } from './phoneCountries';

export const TITLE_MIN_LENGTH = 5;
export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MIN_LENGTH = 20;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const NAME_MAX_LENGTH = 100;

export function validateTitle(title: string): string | undefined {
  const trimmed = title.trim();
  if (!trimmed) return 'Title is required.';
  if (trimmed.length < TITLE_MIN_LENGTH) return `Title must be at least ${TITLE_MIN_LENGTH} characters.`;
  if (trimmed.length > TITLE_MAX_LENGTH) return `Title must be under ${TITLE_MAX_LENGTH} characters.`;
  return undefined;
}

export function validateDescription(description: string): string | undefined {
  const trimmed = description.trim();
  if (!trimmed) return 'Description is required.';
  if (trimmed.length < DESCRIPTION_MIN_LENGTH) return `Description must be at least ${DESCRIPTION_MIN_LENGTH} characters.`;
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) return `Description must be under ${DESCRIPTION_MAX_LENGTH} characters.`;
  return undefined;
}

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
  if (digits.length < min || digits.length > max) return 'Enter a valid phone number.';
  return undefined;
}

export function validatePrice(price: string): string | undefined {
  if (!price) return 'Price is required.';
  if (Number(price) <= 0) return 'Enter a price greater than 0.';
  return undefined;
}

export function validateCity(city: string | undefined): string | undefined {
  if (!city) return 'Select a city.';
  return undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Demo/mock listings ('l1', 'l2', ...) are mixed into the public feed alongside
// real Supabase rows. Only real rows have a uuid id and a backing row for
// foreign keys (offers, conversations, favorites, etc.) to point at.
export function isRealListingId(id: string | undefined | null): boolean {
  return !!id && UUID_RE.test(id);
}

export function validateRequiredAttributes(fields: CategoryField[], attributes: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.required && !attributes[field.key]) {
      errors[field.key] = `${field.label} is required.`;
    }
  }
  return errors;
}
