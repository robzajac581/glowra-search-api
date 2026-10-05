/**
 * Promotional Flag Normalizer Utility
 *
 * Single source of truth for Procedures.IsPromotional / DraftProcedures.IsPromotional.
 *
 * A promotional price is one the source conditions on something rather than
 * quoting as the standard rate: "new clients only", "first treatment", "this
 * month only", "limited time", "special", "was $250, now $175", "package of
 * three". It is judged from the wording attached to the price, never from
 * whether a price merely looks low -- see is_promotional in
 * glowra-ingestion/lib/extractor.js, which is where the signal originates.
 *
 * ## Why the column is nullable, and why that is load-bearing
 *
 * This is a THREE-state field, not a boolean:
 *
 *   true   -- assessed, and the price is conditional/promotional
 *   false  -- assessed, and the price is the standard rate
 *   null   -- NOT ASSESSED. We do not know.
 *
 * ~444 clinics were loaded before the extractor existed. There is no source
 * page, no evidence quote, and nothing to derive a promotional signal from for
 * any of their procedures. Defaulting those rows to false would assert "this
 * is a standard rate" about a price nobody ever assessed -- on a
 * price-comparison marketplace that is a false claim, and it is worse than
 * showing nothing, because a wrong badge is believed while an absent badge is
 * merely uninformative.
 *
 * So: null is the default, null is preserved, and null is never coerced to
 * false anywhere in this module. A caller that omits the field leaves the row
 * unassessed; only an explicit false records "assessed, standard rate".
 *
 * That is also why normalize() distinguishes "absent" from "unparseable": an
 * absent value is a legitimate "unknown", whereas junk is a caller error that
 * should be logged rather than silently become "unknown".
 */

/** Why a value could not be resolved to a promotional flag. */
const REJECT_UNRECOGNISED = 'unrecognised';

/**
 * Input spellings accepted for each state.
 *
 * Lowercased and trimmed before lookup. The shapes here are the ones that
 * actually arrive: JSON booleans from the ingestion pusher and the admin UI,
 * 0/1 from SQLite and from the Excel import path, and 'true'/'false'/'yes'/'no'
 * strings from form posts and spreadsheet cells, which have no boolean type.
 */
const TRUE_TOKENS = new Set(['true', '1', 'yes', 'y', 'promotional', 'promo']);
const FALSE_TOKENS = new Set(['false', '0', 'no', 'n', 'standard']);

/**
 * Tokens that explicitly mean "not assessed" rather than "no".
 *
 * A spreadsheet cell reading 'unknown' is a human saying they did not check.
 * Mapping it to false would be the exact error this field exists to avoid, so
 * it resolves to null instead.
 */
const UNKNOWN_TOKENS = new Set(['unknown', 'unassessed', 'n/a', 'na', 'null', '-']);

/**
 * Resolve a value to true, false, or null (unknown).
 *
 * Strict by design: this does NOT guess and does NOT fall back to false. It
 * returns undefined for anything it does not recognise, which lets validation
 * reject a bad input instead of silently storing a state nobody asserted.
 *
 * @param {any} raw
 * @returns {boolean|null|undefined} true/false, null for "unknown",
 *   or undefined when the value is not recognised at all
 */
function toCanonicalPromotionalFlag(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'boolean') return raw;

  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }

  if (typeof raw !== 'string') return undefined;

  const key = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  // Blank is absence, not "no".
  if (!key) return null;

  if (TRUE_TOKENS.has(key)) return true;
  if (FALSE_TOKENS.has(key)) return false;
  if (UNKNOWN_TOKENS.has(key)) return null;

  return undefined;
}

/**
 * Normalise a promotional flag for storage on a write path.
 *
 * Unlike toCanonicalPromotionalFlag(), this always yields something safe to
 * store -- `value` is true, false, or null (stored as SQL NULL) -- and reports
 * whether the input had to be dropped so callers can log it.
 *
 * An unrecognised value is dropped to null, NOT to false. Dropping to false
 * would turn a caller's typo into a published "standard rate" claim.
 *
 * @param {any} raw
 * @returns {{ value: boolean|null, ok: boolean, reason: string|null, input: string|null }}
 */
function normalizePromotionalFlag(raw) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return { value: null, ok: true, reason: null, input: null };
  }

  const canonical = toCanonicalPromotionalFlag(raw);
  if (canonical !== undefined) {
    return { value: canonical, ok: true, reason: null, input: String(raw).trim() };
  }

  return {
    value: null,
    ok: false,
    reason: REJECT_UNRECOGNISED,
    input: String(raw).trim()
  };
}

/**
 * Normalise for storage and log anything dropped.
 *
 * Write paths should prefer this over normalizePromotionalFlag() so a dropped
 * value is visible in the service logs instead of disappearing into "unknown".
 *
 * @param {any} raw
 * @param {string} context - where this happened, e.g. 'createProcedure clinic 412'
 * @returns {boolean|null} flag to store, or null for "not assessed"
 */
function normalizePromotionalFlagForStorage(raw, context = 'unknown') {
  const result = normalizePromotionalFlag(raw);

  if (!result.ok) {
    console.warn(
      `[isPromotional] dropped ${JSON.stringify(result.input)} ` +
        `(not a recognised true/false/unknown value) at ${context} -- stored as NULL (not assessed)`
    );
  }

  return result.value;
}

/**
 * Pick the promotional flag out of a procedure payload.
 *
 * The field arrives under several spellings: 'isPromotional' from the ingestion
 * pusher and the API response shape, 'IsPromotional' from anything echoing the
 * database column back, and 'promotional' from the admin form. They are
 * resolved in one place so that validation and the write paths cannot disagree
 * about which key wins -- the GLO-69 priceUnit failure mode, where validating
 * only one spelling let a payload using the other bypass the enum entirely.
 *
 * Returns undefined when no spelling is present, which callers must treat as
 * "not assessed" rather than false.
 *
 * @param {object|null|undefined} procedure
 * @returns {any} the raw value under whichever key was supplied, or undefined
 */
function readPromotionalFlagField(procedure) {
  if (!procedure || typeof procedure !== 'object') return undefined;

  if ('isPromotional' in procedure) return procedure.isPromotional;
  if ('IsPromotional' in procedure) return procedure.IsPromotional;
  if ('promotional' in procedure) return procedure.promotional;

  return undefined;
}

/**
 * Whether a value is acceptable input for the flag.
 *
 * Used by schemaValidator via the field definition's `resolve` hook, so the
 * validator and the write-path normaliser agree on exactly one set of accepted
 * inputs.
 *
 * @param {any} raw
 * @returns {{ ok: boolean, value: boolean|null }}
 */
function validatePromotionalFlagInput(raw) {
  const result = normalizePromotionalFlag(raw);
  return { ok: result.ok, value: result.value };
}

/** Human-readable list of accepted inputs, for validation error messages. */
function describeAcceptedPromotionalValues() {
  return 'true, false, or blank/unknown when the price has not been assessed';
}

module.exports = {
  REJECT_UNRECOGNISED,
  TRUE_TOKENS,
  FALSE_TOKENS,
  UNKNOWN_TOKENS,
  toCanonicalPromotionalFlag,
  normalizePromotionalFlag,
  normalizePromotionalFlagForStorage,
  readPromotionalFlagField,
  validatePromotionalFlagInput,
  describeAcceptedPromotionalValues
};
