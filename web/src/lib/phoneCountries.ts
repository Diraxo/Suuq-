export type PhoneCountryCode = 'ET' | 'SO';

export type PhoneCountry = {
  code: PhoneCountryCode;
  dial: string;
  name: string;
  flag: string;
  /** Inclusive [min, max] digit length for the local number, excluding the dial code. */
  localLength: [number, number];
  placeholder: string;
};

export const phoneCountries: PhoneCountry[] = [
  { code: 'ET', dial: '+251', name: 'Ethiopia', flag: '🇪🇹', localLength: [9, 9], placeholder: '912345678' },
  { code: 'SO', dial: '+252', name: 'Somalia', flag: '🇸🇴', localLength: [8, 9], placeholder: '615123456' },
];

export function getPhoneCountry(code: PhoneCountryCode): PhoneCountry {
  return phoneCountries.find((c) => c.code === code) ?? phoneCountries[0];
}

/** Combines country + local digits into a single stored string, e.g. "+251912345678". */
export function formatFullPhone(code: PhoneCountryCode, local: string): string {
  return `${getPhoneCountry(code).dial}${local}`;
}
