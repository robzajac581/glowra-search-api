const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeCategory,
  toCanonicalCategory,
  getValidCategories,
  CATEGORIES
} = require('../utils/categoryNormalizer');
const { CLINIC_CATEGORIES } = require('../clinic-management/schema/clinicFields');
const { validateClinic } = require('../clinic-management/utils/schemaValidator');

// A clinic that is valid apart from whatever category we are exercising.
function clinicWithCategory(category) {
  return {
    clinicName: 'Test Clinic',
    address: '123 Main St',
    city: 'Miami',
    state: 'Florida',
    zipCode: '33139',
    category
  };
}

function categoryErrors(category) {
  return validateClinic(clinicWithCategory(category)).errors.filter(
    (e) => e.field === 'category'
  );
}

test('schema enum and normaliser agree (the GLO-68 regression)', () => {
  assert.deepStrictEqual(CLINIC_CATEGORIES, getValidCategories());
});

test('the schema enum uses the spelling that is actually stored', () => {
  assert.ok(CLINIC_CATEGORIES.includes('Medspa / Aesthetics'));
  assert.ok(!CLINIC_CATEGORIES.includes('Med Spa / Aesthetics'));
});

test('validateClinic accepts every value normalizeCategory can emit', () => {
  for (const category of getValidCategories()) {
    assert.deepStrictEqual(
      categoryErrors(category),
      [],
      `validator rejected its own canonical value: ${category}`
    );
  }
});

test('round-trip: the normaliser output validates', () => {
  // This is the exact failure from GLO-68: post back what the API produced.
  const produced = normalizeCategory('Medical Spa');
  assert.strictEqual(produced, CATEGORIES.MEDSPA_AESTHETICS);
  assert.deepStrictEqual(categoryErrors(produced), []);
});

test('the legacy "Med Spa / Aesthetics" spelling is still accepted', () => {
  // glowra-FE's list-your-clinic form still submits this literal.
  assert.deepStrictEqual(categoryErrors('Med Spa / Aesthetics'), []);
});

test('an unrecognised category is still rejected', () => {
  const errors = categoryErrors('Veterinary');
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0].message, /Medspa \/ Aesthetics/);
});

test('the rejection message does not advertise the legacy spelling', () => {
  const errors = categoryErrors('Veterinary');
  assert.ok(!errors[0].message.includes('Med Spa / Aesthetics'));
});

test('toCanonicalCategory maps aliases without guessing', () => {
  assert.strictEqual(
    toCanonicalCategory('Med Spa / Aesthetics'),
    CATEGORIES.MEDSPA_AESTHETICS
  );
  assert.strictEqual(
    toCanonicalCategory('  medspa/aesthetics '),
    CATEGORIES.MEDSPA_AESTHETICS
  );
  assert.strictEqual(toCanonicalCategory('Plastic Surgery'), 'Plastic Surgery');

  // Unlike normalizeCategory, it does not fall back to 'Other'.
  assert.strictEqual(toCanonicalCategory('Veterinary'), null);
  assert.strictEqual(toCanonicalCategory(''), null);
  assert.strictEqual(toCanonicalCategory(null), null);
  assert.strictEqual(normalizeCategory('Veterinary'), CATEGORIES.OTHER);
});
