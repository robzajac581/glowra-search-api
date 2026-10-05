const test = require('node:test');
const assert = require('node:assert');

const {
  toCanonicalPromotionalFlag,
  normalizePromotionalFlag,
  normalizePromotionalFlagForStorage,
  readPromotionalFlagField,
  REJECT_UNRECOGNISED
} = require('../utils/promotionalFlagNormalizer');

const { validateProcedure } = require('../clinic-management/utils/schemaValidator');
const { procedureFields } = require('../clinic-management/schema/procedureFields');

/** Validation errors raised for the promotional flag on an otherwise valid procedure. */
function promoErrors(key, value) {
  const procedure = { procedureName: 'Botox', category: 'Injectables' };
  if (key !== null) procedure[key] = value;
  return validateProcedure(procedure).errors.filter((e) =>
    e.field.endsWith('.isPromotional')
  );
}

// ---------------------------------------------------------------------------
// The whole point of the field: null is a state, and it is not false.
// ---------------------------------------------------------------------------

test('absent means NOT ASSESSED (null), never false', () => {
  // This is the claim the ~444 pre-extractor clinics depend on. If any of
  // these ever returned false, the API would start asserting "standard rate"
  // about procedures nobody has ever looked at.
  for (const absent of [undefined, null, '', '   ']) {
    assert.strictEqual(
      normalizePromotionalFlag(absent).value,
      null,
      `${JSON.stringify(absent)} must normalise to null, not false`
    );
    assert.notStrictEqual(normalizePromotionalFlag(absent).value, false);
  }

  assert.strictEqual(readPromotionalFlagField({ procedureName: 'Botox' }), undefined);
  assert.strictEqual(normalizePromotionalFlagForStorage(undefined, 'test'), null);
});

test('an unrecognised value degrades to NULL, not to false', () => {
  // A caller typo must become "we do not know", never a published claim that
  // the price is a standard rate.
  for (const junk of ['maybe', 'sometimes', 2, -1, 'discount?', {}, []]) {
    const result = normalizePromotionalFlag(junk);
    assert.strictEqual(result.ok, false, `${JSON.stringify(junk)} should be rejected`);
    assert.strictEqual(result.value, null, `${JSON.stringify(junk)} must degrade to null`);
    assert.strictEqual(result.reason, REJECT_UNRECOGNISED);
  }
});

test('"unknown"-style tokens resolve to null rather than false', () => {
  for (const token of ['unknown', 'Unassessed', 'N/A', 'na', 'NULL', '-']) {
    assert.strictEqual(
      toCanonicalPromotionalFlag(token),
      null,
      `${token} must mean "not assessed"`
    );
  }
});

// ---------------------------------------------------------------------------
// The two assessed states
// ---------------------------------------------------------------------------

test('true and false round-trip through every accepted spelling', () => {
  for (const truthy of [true, 1, 'true', 'TRUE', ' yes ', 'y', 'promotional', 'promo']) {
    assert.strictEqual(
      toCanonicalPromotionalFlag(truthy),
      true,
      `${JSON.stringify(truthy)} should resolve to true`
    );
  }
  for (const falsy of [false, 0, 'false', 'FALSE', ' no ', 'n', 'standard']) {
    assert.strictEqual(
      toCanonicalPromotionalFlag(falsy),
      false,
      `${JSON.stringify(falsy)} should resolve to false`
    );
  }
});

test('an explicit false is preserved as an assessment, not collapsed to unknown', () => {
  // false means "somebody checked and it is the standard rate". Collapsing it
  // to null would throw away a real assessment.
  const result = normalizePromotionalFlag(false);
  assert.strictEqual(result.value, false);
  assert.strictEqual(result.ok, true);
});

test('normalising is idempotent', () => {
  for (const input of [true, false, null, undefined, 'yes', 'no', 'unknown', 'junk']) {
    const once = normalizePromotionalFlag(input).value;
    assert.strictEqual(normalizePromotionalFlag(once).value, once, `not idempotent: ${input}`);
  }
});

// ---------------------------------------------------------------------------
// Validation, and the spelling-bypass failure mode from GLO-69
// ---------------------------------------------------------------------------

test('the schema declares isPromotional and routes it through the normaliser', () => {
  assert.ok(procedureFields.isPromotional, 'isPromotional missing from procedureFields');
  assert.strictEqual(procedureFields.isPromotional.required, false);
  assert.strictEqual(typeof procedureFields.isPromotional.resolve, 'function');
});

test('a payload cannot bypass validation by choosing a different spelling', () => {
  // The GLO-69 leak: validating only one key name let a payload using another
  // reach the column unvalidated. All three spellings the write paths read
  // must be validated.
  for (const key of ['isPromotional', 'IsPromotional', 'promotional']) {
    assert.strictEqual(promoErrors(key, 'maybe').length, 1, `${key} junk was not rejected`);
    assert.deepStrictEqual(promoErrors(key, true), [], `${key}=true was wrongly rejected`);
    assert.deepStrictEqual(promoErrors(key, false), [], `${key}=false was wrongly rejected`);
  }
});

test('omitting the flag is valid — an unassessed procedure is not an error', () => {
  assert.deepStrictEqual(promoErrors(null, undefined), []);
  assert.deepStrictEqual(promoErrors('isPromotional', null), []);
  assert.deepStrictEqual(promoErrors('isPromotional', ''), []);
});

test('the validator and the write-path normaliser accept exactly the same inputs', () => {
  // If these ever diverge, one of them is wrong about what reaches the column.
  const inputs = [
    true, false, 1, 0, 'true', 'false', 'yes', 'no', 'y', 'n',
    'promotional', 'promo', 'standard', 'unknown', 'n/a', '',
    'maybe', 'sometimes', 2, -1, 'discount?'
  ];
  for (const input of inputs) {
    const validatorAccepts = promoErrors('isPromotional', input).length === 0;
    const normaliserAccepts = normalizePromotionalFlag(input).ok;
    assert.strictEqual(
      validatorAccepts,
      normaliserAccepts,
      `disagreement on ${JSON.stringify(input)}: validator=${validatorAccepts} normaliser=${normaliserAccepts}`
    );
  }
});

test('readPromotionalFlagField prefers isPromotional, then IsPromotional, then promotional', () => {
  assert.strictEqual(
    readPromotionalFlagField({ isPromotional: true, IsPromotional: false, promotional: false }),
    true
  );
  assert.strictEqual(readPromotionalFlagField({ IsPromotional: true, promotional: false }), true);
  assert.strictEqual(readPromotionalFlagField({ promotional: true }), true);
  // An explicitly-null key is still "present", and present-but-null is unknown.
  assert.strictEqual(readPromotionalFlagField({ isPromotional: null }), null);
});

// ---------------------------------------------------------------------------
// The API encoding
// ---------------------------------------------------------------------------

test('the API omits the key for unassessed rows and emits a real boolean otherwise', () => {
  // Mirrors optionalIsPromotional() in app.js. Absence is the "unknown"
  // encoding, so a client that reads a missing key as false is wrong — but a
  // client that reads an emitted value gets a genuine boolean, never 0/1.
  const optionalIsPromotional = (raw) => {
    if (raw === null || raw === undefined) return {};
    return { isPromotional: raw === true || raw === 1 };
  };

  assert.deepStrictEqual(optionalIsPromotional(null), {});
  assert.deepStrictEqual(optionalIsPromotional(undefined), {});
  assert.deepStrictEqual(optionalIsPromotional(true), { isPromotional: true });
  assert.deepStrictEqual(optionalIsPromotional(1), { isPromotional: true });
  assert.deepStrictEqual(optionalIsPromotional(false), { isPromotional: false });
  assert.deepStrictEqual(optionalIsPromotional(0), { isPromotional: false });
});
