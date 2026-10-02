const test = require('node:test');
const assert = require('node:assert');

const {
  toCanonicalPriceUnit,
  normalizePriceUnit,
  getValidPriceUnits,
  REJECT_PRICE_LEAK,
  REJECT_UNRECOGNISED
} = require('../utils/priceUnitNormalizer');
const { PRICE_UNITS } = require('../clinic-management/schema/procedureFields');
const { validateProcedure } = require('../clinic-management/utils/schemaValidator');

// A procedure that is valid apart from whatever unit we are exercising.
function procedureWithUnit(unitFieldName, value) {
  return {
    procedureName: 'Botox',
    category: 'Injectables',
    priceMin: 12,
    priceMax: 15,
    [unitFieldName]: value
  };
}

function unitErrors(unitFieldName, value) {
  return validateProcedure(procedureWithUnit(unitFieldName, value)).errors.filter(
    (e) => e.field === 'procedures[0].unit'
  );
}

test('schema enum and normaliser agree', () => {
  assert.deepStrictEqual(PRICE_UNITS, getValidPriceUnits());
});

test('the enum contains the real units found in live data (GLO-69)', () => {
  // Verified present in prod: /procedure (58), /package (10), /cycle (9),
  // /thread (2), /graft (1). These were in use but not in the enum.
  for (const unit of ['/procedure', '/package', '/cycle', '/thread', '/graft']) {
    assert.ok(PRICE_UNITS.includes(unit), `enum missing live unit: ${unit}`);
  }
});

test('validateProcedure accepts every canonical unit', () => {
  for (const unit of getValidPriceUnits()) {
    assert.deepStrictEqual(
      unitErrors('unit', unit),
      [],
      `validator rejected its own canonical value: ${JSON.stringify(unit)}`
    );
  }
});

test('the enum is closed: junk price leaks are rejected', () => {
  // Real values observed in the Procedures.PriceUnit column.
  for (const junk of ['/650', '/950', '/3150', '/1095', '/6.25', '/2 vials', '/6-session pkg', '/10-30 vials']) {
    assert.strictEqual(
      unitErrors('unit', junk).length,
      1,
      `validator accepted junk unit: ${junk}`
    );
  }
});

test('a payload using priceUnit cannot bypass the enum (the actual leak)', () => {
  // clinicCreationService/draftService read priceUnit first, but the schema
  // field is named 'unit' -- so before GLO-69 this validated clean and was
  // written straight to the column.
  assert.strictEqual(unitErrors('priceUnit', '/650').length, 1);
  assert.strictEqual(unitErrors('PriceUnit', '/650').length, 1);
  assert.deepStrictEqual(unitErrors('priceUnit', '/session'), []);
});

test('priceUnit takes precedence over unit, matching the write paths', () => {
  const errors = validateProcedure({
    ...procedureWithUnit('unit', '/session'),
    priceUnit: '/650'
  }).errors.filter((e) => e.field === 'procedures[0].unit');
  assert.strictEqual(errors.length, 1, 'priceUnit junk was masked by a valid unit');
});

test('blank and absent units are allowed', () => {
  assert.deepStrictEqual(unitErrors('unit', ''), []);
  assert.deepStrictEqual(unitErrors('unit', null), []);
  assert.deepStrictEqual(unitErrors('unit', undefined), []);
  assert.deepStrictEqual(validateProcedure({
    procedureName: 'Botox', category: 'Injectables'
  }).errors.filter((e) => e.field === 'procedures[0].unit'), []);
});

test('accepted aliases validate and canonicalise', () => {
  const cases = {
    '/sessions': '/session',
    sessions: '/session',
    session: '/session',
    '/Units': '/unit',
    ' /VIAL ': '/vial',
    '/per treatment': '/treatment',
    '/pkg': '/package',
    each: '/unit',
    '/grafts': '/graft'
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.strictEqual(
      toCanonicalPriceUnit(input),
      expected,
      `normaliser did not canonicalise ${JSON.stringify(input)}`
    );
    assert.deepStrictEqual(
      unitErrors('unit', input),
      [],
      `validator rejected accepted alias ${JSON.stringify(input)}`
    );
  }
});

test('validator and write-path normaliser agree on every input', () => {
  // A value the validator accepts must normalise to something storable, and a
  // value it rejects must not be stored. Disagreement here is the class of bug
  // that produced GLO-68 and GLO-69.
  const inputs = [
    ...getValidPriceUnits(),
    '/sessions', 'sessions', '/PER UNIT', '/pkg', 'graft',
    '/650', '/2 vials', '/banana', '', null, undefined, '  '
  ];
  for (const input of inputs) {
    const validatorAccepts = unitErrors('unit', input).length === 0;
    const normalised = normalizePriceUnit(input);
    assert.strictEqual(
      validatorAccepts,
      normalised.ok,
      `disagreement on ${JSON.stringify(input)}: validator accepts=${validatorAccepts}, normaliser ok=${normalised.ok}`
    );
  }
});

test('normalizePriceUnit stores null for blank rather than an empty string', () => {
  for (const blank of [null, undefined, '', '   ', '/']) {
    const result = normalizePriceUnit(blank);
    assert.strictEqual(result.value, null, `blank ${JSON.stringify(blank)} did not become null`);
    assert.strictEqual(result.ok, true);
  }
});

test('normalizePriceUnit distinguishes a price leak from an unknown unit', () => {
  assert.strictEqual(normalizePriceUnit('/650').reason, REJECT_PRICE_LEAK);
  assert.strictEqual(normalizePriceUnit('/2 vials').reason, REJECT_PRICE_LEAK);
  assert.strictEqual(normalizePriceUnit('/6.25').reason, REJECT_PRICE_LEAK);
  assert.strictEqual(normalizePriceUnit('/banana').reason, REJECT_UNRECOGNISED);
});

test('no canonical unit or alias contains a digit', () => {
  // The price-leak heuristic is "contains a digit", so a canonical unit with a
  // digit in it would be misclassified as junk.
  for (const unit of getValidPriceUnits()) {
    assert.ok(!/\d/.test(unit), `canonical unit contains a digit: ${unit}`);
  }
});

test('junk is dropped, never stored', () => {
  for (const junk of ['/650', '/6.25', '/2 vials', '/10-30 vials', '/banana']) {
    const result = normalizePriceUnit(junk);
    assert.strictEqual(result.value, null, `junk ${junk} would have been stored`);
    assert.strictEqual(result.ok, false);
  }
});

test('normalising is idempotent', () => {
  for (const input of ['/sessions', 'each', '/PER VIAL', '/graft', '/650']) {
    const once = normalizePriceUnit(input).value;
    assert.strictEqual(normalizePriceUnit(once).value, once, `not idempotent: ${input}`);
  }
});
