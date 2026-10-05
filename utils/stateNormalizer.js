/**
 * State Normalizer Utility
 *
 * Single source of truth for the canonical representation of Clinics.State,
 * ClinicDrafts.State, GooglePlacesData.State and Locations.State.
 *
 * ---------------------------------------------------------------------------
 * CANONICAL FORMAT: two-letter uppercase USPS code ('FL', 'IL', 'DC').
 * ---------------------------------------------------------------------------
 *
 * Why the code and not the full name. Three consumers decided it:
 *
 *   1. glowra-FE src/pages/home/components/LocalDoctors.jsx:17-25,135 keys its
 *      NEARBY_STATES adjacency map on two-letter codes and filters the
 *      search-index response with `nearbyStates.includes(c.state)` -- an exact
 *      string match. Every row stored as 'Florida' or 'Illinois' is invisible
 *      to that feature and fails silently, which is precisely the bug class
 *      this ticket exists to close.
 *   2. glowra-FE src/utils/addressUtils.js:80-88 (formatClinicLocationDisplay)
 *      already converts whatever it receives to a two-letter code for display,
 *      so the code is what the product shows users regardless.
 *   3. clinic-management/services/duplicateDetectionService.js:401-402 compares
 *      Locations.State against Clinics.State with a plain case-insensitive
 *      equality test. Mixed formats make that comparison miss.
 *
 * The one consumer that tolerates both is utils/locationUtils.js:312
 * (stateMatches), which checks the abbreviation and the full name. It keeps
 * working either way, so it does not constrain the choice.
 *
 * Working against the code: the list-your-clinic form in glowra-FE
 * (src/pages/list-your-clinic/constants.js) submits FULL NAMES, as does the
 * admin BasicInfoTab, and clinic-management/schema/clinicFields.js previously
 * declared its enum as full names. That is an input-format problem, not a
 * storage-format problem. It is solved the same way GLO-68 solved the
 * 'Med Spa / Aesthetics' category spelling: full names are accepted as
 * aliases on input and normalised to the canonical code before storage. No
 * frontend change is required and none is made here.
 *
 * ---------------------------------------------------------------------------
 * NON-US VALUES
 * ---------------------------------------------------------------------------
 * The column also holds ISO country codes for non-US clinics -- eight Istanbul
 * rows carry 'TR'. 'TR' is not a US state and must not be coerced into one or
 * blanked. toCanonicalState() returns it unchanged via NON_US_PASSTHROUGH and
 * classifyState() labels it 'non_us' so audits can count it separately instead
 * of filing it as a format defect. Nothing in this module invents a US state
 * for a non-US clinic.
 */

/** Canonical two-letter USPS codes -> full state name. */
const STATE_CODE_TO_NAME = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};

/**
 * Non-US values that legitimately live in this column and are passed through
 * unchanged. Keyed by the uppercased input.
 *
 * Only 'TR' is listed because only 'TR' is present in production (eight
 * Istanbul clinics). This is deliberately a closed list rather than "any
 * two-letter string we do not recognise": an unrecognised two-letter value is
 * far more likely to be a typo than a new country, and silently accepting it
 * is how 48 distinct values accumulated in the first place.
 */
const NON_US_PASSTHROUGH = new Set(['TR']);

const STATE_NAME_TO_CODE = Object.freeze(
  Object.entries(STATE_CODE_TO_NAME).reduce((acc, [code, name]) => {
    acc[name.toLowerCase()] = code;
    return acc;
  }, {})
);

/**
 * Extra input spellings accepted and mapped to a canonical code.
 * Keys are compared lowercased with collapsed whitespace.
 */
const STATE_ALIASES = {
  'washington dc': 'DC',
  'washington, d.c.': 'DC',
  'd.c.': 'DC',
  'dc.': 'DC',
  'fl.': 'FL',
  'calif': 'CA',
  'calif.': 'CA',
  'penn': 'PA',
  'penna': 'PA',
  'mass': 'MA',
  'mass.': 'MA',
  'n/a': null,
  'none': null,
  'unknown': null
};

/** Collapse whitespace, strip trailing punctuation noise, trim. */
function tidy(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:·|-]+|[\s.,;:·|-]+$/g, '')
    .trim();
}

/**
 * Resolve a caller-supplied state to its canonical stored value.
 *
 * Like toCanonicalCategory() in utils/categoryNormalizer.js, this does NOT
 * guess and does NOT fall back to a default. It returns null for anything it
 * cannot resolve with certainty, so callers can reject bad input rather than
 * silently storing a state nobody asserted.
 *
 * Resolves, in order:
 *   - already-canonical two-letter codes (case/whitespace insensitive)
 *   - known non-US passthrough codes ('TR')
 *   - full state names ('Florida', 'district of columbia')
 *   - listed aliases ('Fl.', 'Washington DC')
 *
 * It does NOT resolve embedded states ('Columbia SC', 'CHICAGO ILLINOIS').
 * Those are malformed values, not alternative spellings; extracting a state
 * from them is a judgement call that belongs in the one-off migration script
 * with the evidence written down, not in the write-path validator where it
 * would quietly accept garbage.
 *
 * @param {string|null|undefined} state
 * @returns {string|null} canonical value, or null if unresolvable/empty
 */
function toCanonicalState(state) {
  const cleaned = tidy(state);
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(STATE_CODE_TO_NAME, upper)) return upper;
  if (NON_US_PASSTHROUGH.has(upper)) return upper;

  const lower = cleaned.toLowerCase();
  if (STATE_NAME_TO_CODE[lower]) return STATE_NAME_TO_CODE[lower];

  if (Object.prototype.hasOwnProperty.call(STATE_ALIASES, lower)) {
    return STATE_ALIASES[lower];
  }

  return null;
}

/**
 * Classify a stored value for auditing. Distinguishes the three cases this
 * ticket treats differently, so a report can count them separately instead of
 * lumping every non-'FL' value together.
 *
 * @param {string|null|undefined} state
 * @returns {{ kind: string, canonical: string|null, raw: string|null }}
 *   kind is one of:
 *     'null'          -- absent; nothing to fix without a second source
 *     'canonical'     -- already a two-letter US code
 *     'format_variant'-- resolvable full name or alias; mechanical fix
 *     'non_us'        -- known non-US code, left alone on purpose
 *     'malformed'     -- unresolvable; needs a judgement call
 */
function classifyState(state) {
  const raw = state === null || state === undefined ? null : String(state);
  const cleaned = tidy(state);
  if (!cleaned) return { kind: 'null', canonical: null, raw };

  const upper = cleaned.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(STATE_CODE_TO_NAME, upper)) {
    // 'fl' and ' FL ' are canonical in meaning but not as stored; only an
    // exact match is left untouched by the migration.
    return {
      kind: cleaned === upper && raw === upper ? 'canonical' : 'format_variant',
      canonical: upper,
      raw
    };
  }
  if (NON_US_PASSTHROUGH.has(upper)) return { kind: 'non_us', canonical: upper, raw };

  const canonical = toCanonicalState(cleaned);
  if (canonical) return { kind: 'format_variant', canonical, raw };

  return { kind: 'malformed', canonical: null, raw };
}

/** @returns {string[]} canonical US codes, as stored. */
function getValidStateCodes() {
  return Object.keys(STATE_CODE_TO_NAME);
}

/** @returns {string[]} every canonical value accepted in the column, incl. non-US. */
function getValidStateValues() {
  return [...getValidStateCodes(), ...NON_US_PASSTHROUGH];
}

function isValidStateValue(state) {
  return getValidStateValues().includes(state);
}

/**
 * Alias map for schemaValidator's enumAliases (see priceUnitNormalizer's
 * getPriceUnitAliases for the same pattern and the same reason).
 *
 * validateField() builds its lookup key by trimming, collapsing whitespace and
 * lowercasing only. It compares the raw value against the enum FIRST, so
 * lowercase and padded forms of a canonical code ('fl', ' FL ') miss the enum
 * and must be present here to resolve. Full state names must be here too, or
 * the list-your-clinic form -- which submits 'Florida' -- would be rejected by
 * validateClinic() while the write-path normaliser happily accepted it, and
 * the two would disagree about the same input.
 *
 * @returns {Object<string, string>}
 */
function getStateAliases() {
  const aliases = {};

  for (const [code, name] of Object.entries(STATE_CODE_TO_NAME)) {
    aliases[code.toLowerCase()] = code;
    aliases[name.toLowerCase()] = code;
  }
  for (const code of NON_US_PASSTHROUGH) {
    aliases[code.toLowerCase()] = code;
  }
  for (const [key, canonical] of Object.entries(STATE_ALIASES)) {
    if (canonical) aliases[key] = canonical;
  }

  return aliases;
}

module.exports = {
  toCanonicalState,
  classifyState,
  getValidStateCodes,
  getValidStateValues,
  isValidStateValue,
  getStateAliases,
  STATE_CODE_TO_NAME,
  NON_US_PASSTHROUGH
};
