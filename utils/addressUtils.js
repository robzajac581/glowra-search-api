/**
 * Address parsing and normalization utilities
 * Used to prevent duplication when Clinics.Address contains full address
 * while city/state/zip are also stored separately.
 *
 * Goal: Store and return address (street only), city, state, zipCode as separate fields.
 */

const { toCanonicalState } = require('./stateNormalizer');

/**
 * US 5-digit ZIP code pattern (optionally with +4 extension)
 * Matches: 32940, 32940-1234, 90210
 */
const US_ZIP_PATTERN = /\b\d{5}(?:-\d{4})?\b/;

/**
 * Check if an address string looks like a full address (street + city + state + zip)
 * Heuristic: contains commas and a 5-digit US zip code
 *
 * @param {string} address - Address string to check
 * @returns {boolean} True if address appears to be full format
 */
function isFullAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (trimmed.length < 15) return false;
  // Must have comma(s) and a 5-digit zip
  return trimmed.includes(',') && US_ZIP_PATTERN.test(trimmed);
}

/**
 * Parse a full US address string into components
 * Handles format: "6545 N Wickham Rd Suite C-101, Melbourne, FL 32940"
 *
 * @param {string} fullAddress - Full address string
 * @returns {{ street: string, city: string, state: string, postalCode: string }|null}
 *   Parsed components or null if parsing fails
 */
function parseFullAddress(fullAddress) {
  if (!fullAddress || typeof fullAddress !== 'string') return null;

  const trimmed = fullAddress.trim();
  if (!trimmed) return null;

  // Find the 5-digit zip (possibly with +4)
  const zipMatch = trimmed.match(US_ZIP_PATTERN);
  if (!zipMatch) return null;

  const postalCode = zipMatch[0];
  const beforeZip = trimmed.substring(0, zipMatch.index).trim();
  // Remove trailing comma if present
  const beforeZipClean = beforeZip.replace(/,\s*$/, '').trim();

  // Split by comma: "6545 N Wickham Rd Suite C-101, Melbourne, FL"
  const parts = beforeZipClean.split(',').map(p => p.trim()).filter(Boolean);

  if (parts.length >= 3) {
    // Standard: street, city, state
    const state = parts[parts.length - 1];
    const city = parts[parts.length - 2];
    const street = parts.slice(0, -2).join(', ').trim();
    return { street: street || beforeZipClean, city, state, postalCode };
  }

  if (parts.length === 2) {
    // "City, ST" - no street, or "Street, City ST"
    const last = parts[1];
    const stateMatch = last.match(/\b([A-Za-z]{2})\s*$/);
    if (stateMatch) {
      const state = stateMatch[1].toUpperCase();
      const city = last.substring(0, stateMatch.index).trim();
      const street = parts[0];
      return { street, city, state, postalCode };
    }
    return { street: parts[0], city: parts[1], state: '', postalCode };
  }

  if (parts.length === 1) {
    return { street: parts[0], city: '', state: '', postalCode };
  }

  return { street: beforeZipClean, city: '', state: '', postalCode };
}

/**
 * Normalize address for storage: ensure street-only in Address, separate city/state/postalCode
 * Use when creating/updating clinic records.
 *
 * @param {Object} input
 * @param {string} [input.address] - Address (may be full or street-only)
 * @param {string} [input.city]
 * @param {string} [input.state]
 * @param {string} [input.zipCode] - Or postalCode
 * @returns {{ street: string, city: string, state: string, postalCode: string }}
 */
function normalizeAddressForStorage({ address, city, state, zipCode, postalCode }) {
  const zip = zipCode || postalCode || '';

  if (isFullAddress(address)) {
    const parsed = parseFullAddress(address);
    if (parsed) {
      return {
        street: parsed.street || address,
        city: parsed.city || city || '',
        state: canonicalStateForStorage(parsed.state || state),
        postalCode: parsed.postalCode || zip
      };
    }
  }

  // Address is street-only (or unparseable - use as-is for street)
  return {
    street: (address || '').trim(),
    city: (city || '').trim(),
    state: canonicalStateForStorage(state),
    postalCode: (zip || '').toString().trim()
  };
}

/**
 * Canonicalise a state for storage.
 *
 * This is the chokepoint every Clinics / GooglePlacesData / Locations write
 * passes through (clinic-management/services/clinicCreationService.js calls
 * normalizeAddressForStorage on create at :118, on update at :372 and for the
 * Google row at :768, and feeds addr.state to getOrCreateLocation at :156).
 * Normalising here is what stops the 48-distinct-values drift reappearing.
 *
 * Unresolvable input is passed through trimmed rather than dropped: losing a
 * value the caller asserted would be worse than storing one the audit can
 * flag, and validateClinic() rejects it at the API boundary anyway.
 */
function canonicalStateForStorage(state) {
  const trimmed = (state || '').trim();
  if (!trimmed) return '';
  return toCanonicalState(trimmed) || trimmed;
}

/**
 * Merge address components from Clinics and GooglePlacesData for API response
 * Prefer GooglePlacesData.Street for street when available; otherwise use Clinics.Address
 *
 * @param {Object} clinic - Row with Address, City?, State?, PostalCode?
 * @param {Object} googlePlaces - Row with Street, City, State, PostalCode
 * @param {Object} location - Row with City, State (from Locations via LocationID)
 * @returns {{ address: string, city: string, state: string, zipCode: string }}
 */
function mergeAddressForResponse(clinic, googlePlaces = {}, location = {}) {
  const g = googlePlaces || {};
  const l = location || {};
  const c = clinic || {};

  const address = (g.Street || c.Address || '').trim() || null;
  const city = (c.City || g.City || l.City || '').trim() || null;
  // Canonicalise on the way out as well as on the way in. Clinics.State is
  // canonical after GLO-76, but GooglePlacesData.State and Locations.State are
  // not (126/436 and 92/255 rows respectively are not two-letter codes as of
  // 2026-10-05), so whenever this COALESCE falls through to one of them the
  // API would otherwise emit 'Florida'. glowra-FE's NEARBY_STATES filter
  // (src/pages/home/components/LocalDoctors.jsx:135) does an exact match on
  // this value, so a fallback row emitting a full name is invisible to it.
  const rawState = (c.State || g.State || l.State || '').trim() || null;
  const state = rawState ? (toCanonicalState(rawState) || rawState) : null;
  const zipCode = (c.PostalCode || g.PostalCode || '').toString().trim() || null;

  return { address, city, state, zipCode };
}

module.exports = {
  isFullAddress,
  parseFullAddress,
  normalizeAddressForStorage,
  canonicalStateForStorage,
  mergeAddressForResponse,
  US_ZIP_PATTERN
};
