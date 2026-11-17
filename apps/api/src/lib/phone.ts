import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Normalizes a phone number to E.164 (e.g. "+919810000001").
 * Numbers without a country prefix are interpreted in `defaultCountry` (from DEFAULT_COUNTRY_CODE,
 * never hardcoded). Returns null when the input is not a valid phone number.
 */
export function normalizePhone(input: unknown, defaultCountry: string): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim();
  if (!cleaned || cleaned.length > 40) return null;
  // Reject anything that is not digits, spaces, dashes, dots, parentheses or a leading plus.
  if (!/^\+?[\d\s\-().]+$/.test(cleaned)) return null;
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry.toUpperCase() as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}
