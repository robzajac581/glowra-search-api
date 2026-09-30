/**
 * Price Unit Normalizer Utility
 *
 * Single source of truth for Procedures.PriceUnit / DraftProcedures.PriceUnit.
 *
 * A price unit is the denominator shown next to a price ("$12 /unit"). It is a
 * short closed vocabulary, not free text -- but the write paths accepted free
 * text for a long time, so live data contains both real units that were never
 * in the enum and junk where a price leaked into the unit column.
 *
 * Verified against prod GET /api/clinics/search-index (2026-09-30): of 2333
 * stored priceUnit values, 40 were distinct and 33 were outside the enum,
 * accounting for 127 occurrences (5.4%):
 *   - real units missing from the enum: /procedure (58), /package (10),
 *     /cycle (9), /thread (2), /graft (1)  -- 80 occurrences, now canonical
 *   - junk price leaks: 47 occurrences over 28 distinct values, e.g.
 *     '/650', '/950', '/3150', '/6.25', '/2 vials', '/10-30 vials'
 *
 * The junk has a known cause: excelUnitToPriceUnit() in
 * scripts/importProceduresFromExcel.js and scripts/backfillProceduresFromExcel.js
 * lowercases whatever is in the spreadsheet's Unit column and prepends '/',
 * so a mis-shifted cell holding 650 became the unit '/650'.
 */

// Canonical stored spellings. '' means "no unit" and is stored as NULL.
const PRICE_UNITS = [
  '',            // no unit (blank)
  '/unit',
  '/session',
  '/injection',
  '/area',
  '/treatment',
  '/syringe',
  '/vial',
  '/procedure',
  '/package',
  '/cycle',
  '/thread',
  '/graft'
];

/**
 * Alternative spellings accepted on input, mapped to their canonical value.
 *
 * Keys are compared after trimming, collapsing whitespace, lowercasing, and
 * adding a leading '/' -- so only genuinely different wordings need an entry
 * here, not case or spacing variants. Singular/plural and the bare noun (no
 * slash) are the common shapes coming out of spreadsheets and the admin UI.
 *
 * Aliases are accepted, not advertised: rejection messages list only the
 * canonical values.
 */
const PRICE_UNIT_ALIASES = {
  '/units': '/unit',
  '/sessions': '/session',
  '/injections': '/injection',
  '/areas': '/area',
  '/treatments': '/treatment',
  '/syringes': '/syringe',
  '/vials': '/vial',
  '/procedures': '/procedure',
  '/packages': '/package',
  '/cycles': '/cycle',
  '/threads': '/thread',
  '/grafts': '/graft',
  // Wordings seen in import spreadsheets that mean an existing canonical unit.
  '/per unit': '/unit',
  '/per session': '/session',
  '/per treatment': '/treatment',
  '/per area': '/area',
  '/per syringe': '/syringe',
  '/per vial': '/vial',
  '/each': '/unit',
  '/visit': '/session',
  '/appointment': '/session',
  '/pkg': '/package'
};

/** Why a value could not be resolved to a canonical unit. */
const REJECT_PRICE_LEAK = 'price_leak';
const REJECT_UNRECOGNISED = 'unrecognised';

/**
 * Reduce a caller-supplied value to the form used for alias lookup:
 * trimmed, whitespace-collapsed, lowercased, with exactly one leading '/'.
 *
 * @param {any} raw
 * @returns {string|null} lookup key, or null if the value is empty
 */
function priceUnitLookupKey(raw) {
  if (raw == null) return null;

  const collapsed = String(raw).trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;

  const body = collapsed.replace(/^\/+/, '').trim();
  if (!body) return null;

  return `/${body.toLowerCase()}`;
}

/**
 * Resolve a value to its canonical price unit.
 *
 * Strict by design: this does NOT guess and does NOT fall back to a default.
 * It returns null for anything that is not canonical or a known alias, which
 * makes it safe to use for validation, where silently coercing an unrecognised
 * value would hide the input error.
 *
 * An empty/blank input resolves to '' (the canonical "no unit"), because blank
 * is a legitimate choice rather than a bad value.
 *
 * @param {any} raw
 * @returns {string|null} canonical unit (possibly ''), or null if unrecognised
 */
function toCanonicalPriceUnit(raw) {
  const key = priceUnitLookupKey(raw);
  if (key === null) return '';

  if (PRICE_UNITS.includes(key)) return key;

  return PRICE_UNIT_ALIASES[key] || null;
}

/**
 * Whether a rejected value looks like a price that leaked into the unit column
 * rather than a genuine unit we simply have not catalogued.
 *
 * Any digit in the unit body means a number is present where only a noun
 * belongs -- '/650', '/6.25', '/2 vials', '/6-session pkg'. No canonical unit
 * or alias contains a digit, so this cannot misfire on a real unit.
 *
 * @param {string} key - output of priceUnitLookupKey()
 * @returns {boolean}
 */
function looksLikePriceLeak(key) {
  return /\d/.test(key);
}

/**
 * Normalise a price unit for storage on a write path.
 *
 * Unlike toCanonicalPriceUnit(), this reports *why* a value failed so callers
 * can log it, and it always yields something safe to store: `value` is either a
 * canonical unit string or null (stored as SQL NULL). Junk is never stored.
 *
 * @param {any} raw
 * @returns {{ value: string|null, ok: boolean, reason: string|null, input: string|null }}
 *   value  - canonical unit to store, or null for "no unit"
 *   ok     - false when the input was dropped rather than resolved
 *   reason - REJECT_PRICE_LEAK | REJECT_UNRECOGNISED, or null when ok
 *   input  - the original value as a trimmed string, for log messages
 */
function normalizePriceUnit(raw) {
  const key = priceUnitLookupKey(raw);
  if (key === null) {
    return { value: null, ok: true, reason: null, input: null };
  }

  const canonical = toCanonicalPriceUnit(raw);
  if (canonical !== null) {
    // '' is canonical "no unit"; store it as NULL, not an empty string, so the
    // column has one representation of absence.
    return { value: canonical === '' ? null : canonical, ok: true, reason: null, input: String(raw).trim() };
  }

  return {
    value: null,
    ok: false,
    reason: looksLikePriceLeak(key) ? REJECT_PRICE_LEAK : REJECT_UNRECOGNISED,
    input: String(raw).trim()
  };
}

/**
 * Normalise for storage and log anything dropped.
 *
 * Write paths should prefer this over normalizePriceUnit() so that dropped
 * values are visible in the service logs instead of disappearing silently.
 *
 * @param {any} raw
 * @param {string} context - where this happened, e.g. 'createProcedure clinic 412'
 * @returns {string|null} canonical unit to store, or null
 */
function normalizePriceUnitForStorage(raw, context = 'unknown') {
  const result = normalizePriceUnit(raw);

  if (!result.ok) {
    const detail =
      result.reason === REJECT_PRICE_LEAK
        ? 'looks like a price, not a unit'
        : 'not a recognised unit';
    console.warn(
      `[priceUnit] dropped ${JSON.stringify(result.input)} (${detail}) at ${context}`
    );
  }

  return result.value;
}

/** Canonical units, as stored. Includes '' for "no unit". */
function getValidPriceUnits() {
  return [...PRICE_UNITS];
}

/**
 * Alias map for schemaValidator's enumAliases.
 *
 * validateField() builds its lookup key by trimming, collapsing whitespace and
 * lowercasing only -- it does not add the leading '/' that priceUnitLookupKey()
 * does. So the map handed to it carries both shapes of every alias ('/units'
 * and 'units'), plus the slash-less form of each canonical unit ('unit' ->
 * '/unit'). Without these, a payload of 'session' would be rejected by
 * validateProcedure() but accepted by the write-path normaliser, and the two
 * would disagree about the same input.
 *
 * @returns {Object<string, string>}
 */
function getPriceUnitAliases() {
  const aliases = {};

  for (const [key, canonical] of Object.entries(PRICE_UNIT_ALIASES)) {
    aliases[key] = canonical;
    aliases[key.replace(/^\//, '')] = canonical;
  }

  for (const unit of PRICE_UNITS) {
    if (!unit) continue;
    // Both shapes of each canonical unit map to themselves. The slashed form
    // matters because validateField() compares the raw value against the enum
    // before falling back to aliases, so ' /VIAL ' misses the enum on case and
    // whitespace and then needs '/vial' present here to resolve.
    aliases[unit] = unit;
    aliases[unit.replace(/^\//, '')] = unit;
  }

  // Whitespace-only input. validateField() short-circuits on '', null and
  // undefined but not on '   ', which collapses to '' and would otherwise be
  // rejected -- while the write-path normaliser treats it as "no unit". This
  // keeps the two in agreement.
  aliases[''] = '';

  return aliases;
}

module.exports = {
  PRICE_UNITS,
  PRICE_UNIT_ALIASES,
  REJECT_PRICE_LEAK,
  REJECT_UNRECOGNISED,
  priceUnitLookupKey,
  toCanonicalPriceUnit,
  normalizePriceUnit,
  normalizePriceUnitForStorage,
  getValidPriceUnits,
  getPriceUnitAliases
};
