const test = require('node:test');
const assert = require('node:assert');

const {
  toCanonicalState,
  classifyState,
  getValidStateCodes,
  getValidStateValues,
  getStateAliases
} = require('../utils/stateNormalizer');
const { canonicalStateForStorage, normalizeAddressForStorage } = require('../utils/addressUtils');
const { validateClinic } = require('../clinic-management/utils/schemaValidator');

// A clinic that is valid apart from whatever state we are exercising.
function clinicWithState(state) {
  return {
    clinicName: 'Test Clinic',
    address: '123 Main St',
    city: 'Miami',
    state,
    zipCode: '33139',
    category: 'Plastic Surgery'
  };
}

function stateErrors(state) {
  return validateClinic(clinicWithState(state)).errors.filter(
    e => (e.field || '') === 'state' || /state/i.test(e.message || String(e))
  );
}

test('canonical form is the two-letter USPS code', () => {
  assert.strictEqual(toCanonicalState('Florida'), 'FL');
  assert.strictEqual(toCanonicalState('FL'), 'FL');
  assert.strictEqual(toCanonicalState('  fl  '), 'FL');
  assert.strictEqual(toCanonicalState('Illinois'), 'IL');
  assert.strictEqual(toCanonicalState('District of Columbia'), 'DC');
  assert.strictEqual(toCanonicalState('Washington DC'), 'DC');
});

test('every canonical code round-trips through its full name', () => {
  const { STATE_CODE_TO_NAME } = require('../utils/stateNormalizer');
  for (const [code, name] of Object.entries(STATE_CODE_TO_NAME)) {
    assert.strictEqual(toCanonicalState(code), code, `${code} should be canonical`);
    assert.strictEqual(toCanonicalState(name), code, `${name} should resolve to ${code}`);
  }
});

test('unresolvable input returns null rather than guessing', () => {
  // Unlike normalizeCategory, there is no 'Other' bucket to fall back to.
  assert.strictEqual(toCanonicalState('Columbia SC'), null);
  assert.strictEqual(toCanonicalState('CHICAGO ILLINOIS'), null);
  assert.strictEqual(toCanonicalState('Floridaa'), null);
  assert.strictEqual(toCanonicalState(''), null);
  assert.strictEqual(toCanonicalState(null), null);
  assert.strictEqual(toCanonicalState(undefined), null);
  assert.strictEqual(toCanonicalState(42), null);
});

test('TR is passed through, not coerced into a US state or blanked', () => {
  assert.strictEqual(toCanonicalState('TR'), 'TR');
  assert.strictEqual(classifyState('TR').kind, 'non_us');
  assert.ok(!getValidStateCodes().includes('TR'), 'TR is not a US state code');
  assert.ok(getValidStateValues().includes('TR'), 'TR is a permitted stored value');
});

test('classifyState separates the three cases this migration treats differently', () => {
  assert.strictEqual(classifyState('FL').kind, 'canonical');
  assert.strictEqual(classifyState('Florida').kind, 'format_variant');
  assert.strictEqual(classifyState('fl').kind, 'format_variant');
  assert.strictEqual(classifyState('Columbia SC').kind, 'malformed');
  assert.strictEqual(classifyState(null).kind, 'null');
  assert.strictEqual(classifyState('   ').kind, 'null');

  assert.strictEqual(classifyState('Florida').canonical, 'FL');
  assert.strictEqual(classifyState('Columbia SC').canonical, null);
});

test('validateClinic accepts every value the normaliser can emit', () => {
  // The GLO-68 failure mode: the schema enum declared a second spelling, so
  // validateClinic() rejected the normaliser's own output.
  for (const value of getValidStateValues()) {
    assert.strictEqual(
      stateErrors(value).length,
      0,
      `validateClinic rejected canonical value ${value}`
    );
  }
});

test('validateClinic still accepts the full names glowra-FE submits', () => {
  // src/pages/list-your-clinic/constants.js submits 'Florida', not 'FL'.
  for (const name of ['Florida', 'Illinois', 'New York', 'District of Columbia']) {
    assert.strictEqual(stateErrors(name).length, 0, `validateClinic rejected ${name}`);
  }
});

test('validateClinic rejects malformed states', () => {
  assert.ok(stateErrors('Columbia SC').length > 0);
  assert.ok(stateErrors('Floridaa').length > 0);
});

test('alias map covers both the cased and lowercased forms the validator looks up', () => {
  const aliases = getStateAliases();
  // validateField lowercases and collapses whitespace but compares the RAW
  // value against the enum first, so 'fl' must be present as a key.
  assert.strictEqual(aliases['fl'], 'FL');
  assert.strictEqual(aliases['florida'], 'FL');
  assert.strictEqual(aliases['tr'], 'TR');
});

test('the storage chokepoint canonicalises state', () => {
  assert.strictEqual(canonicalStateForStorage('Florida'), 'FL');
  assert.strictEqual(canonicalStateForStorage(' illinois '), 'IL');
  assert.strictEqual(canonicalStateForStorage(''), '');
  assert.strictEqual(canonicalStateForStorage(null), '');
  // Unresolvable input is preserved, not silently dropped.
  assert.strictEqual(canonicalStateForStorage('Columbia SC'), 'Columbia SC');
});

test('normalizeAddressForStorage canonicalises state on both branches', () => {
  // street-only branch
  assert.strictEqual(
    normalizeAddressForStorage({ address: '1 Main St', city: 'Chicago', state: 'Illinois' }).state,
    'IL'
  );
  // full-address branch
  assert.strictEqual(
    normalizeAddressForStorage({ address: '1 Main St, Chicago, Illinois 60654' }).state,
    'IL'
  );
});

test('mergeAddressForResponse canonicalises whichever source wins', () => {
  const { mergeAddressForResponse } = require('../utils/addressUtils');
  // Clinics.State wins and is already canonical.
  assert.strictEqual(mergeAddressForResponse({ State: 'FL' }, {}, {}).state, 'FL');
  // Falls through to GooglePlacesData, which stores full names.
  assert.strictEqual(mergeAddressForResponse({}, { State: 'Florida' }, {}).state, 'FL');
  // Falls through to Locations.
  assert.strictEqual(mergeAddressForResponse({}, {}, { State: 'Illinois' }).state, 'IL');
  // Unresolvable values are preserved, not dropped.
  assert.strictEqual(mergeAddressForResponse({ State: 'Columbia SC' }, {}, {}).state, 'Columbia SC');
  assert.strictEqual(mergeAddressForResponse({}, {}, {}).state, null);
});
