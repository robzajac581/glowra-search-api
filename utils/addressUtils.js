/**
 * Address parsing and normalization utilities
 * Used to prevent duplication when Clinics.Address contains full address
 * while city/state/zip are also stored separately.
 *
 * Goal: Store and return address (street only), city, state, zipCode as separate fields.
 */

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
        state: parsed.state || state || '',
        postalCode: parsed.postalCode || zip
      };
    }
  }

  // Address is street-only (or unparseable - use as-is for street)
  return {
    street: (address || '').trim(),
    city: (city || '').trim(),
    state: (state || '').trim(),
    postalCode: (zip || '').toString().trim()
  };
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
  const state = (c.State || g.State || l.State || '').trim() || null;
  const zipCode = (c.PostalCode || g.PostalCode || '').toString().trim() || null;

  return { address, city, state, zipCode };
}

module.exports = {
  isFullAddress,
  parseFullAddress,
  normalizeAddressForStorage,
  mergeAddressForResponse,
  US_ZIP_PATTERN
};
