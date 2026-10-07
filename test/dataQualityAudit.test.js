const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { buildReport, redactSecrets, ZIP1_TO_STATES } = require('../scripts/auditDataQuality');

// Real production rows, captured 2026-10-05 via
//   node scripts/auditDataQuality.js --dump-fixture test/fixtures/dataQualityRows.json
// Only the columns the audit reads; no PII beyond clinic IDs. The dump redacts
// API keys out of the photo-proxy URLs -- the raw dump used to carry the live
// GOOGLE_PLACES_API_KEY in every GooglePhoto value.
const FIXTURE = require(path.join(__dirname, 'fixtures', 'dataQualityRows.json'));

function row(overrides = {}) {
  return {
    ClinicID: 1,
    State: 'FL',
    PostalCode: '33139',
    PlaceID: 'abc',
    GoogleRating: 4.5,
    Latitude: 25.7907,
    Longitude: -80.13,
    PricedProcedures: 5,
    PhotoCount: 2,
    GoogleDataID: 10,
    GoogleState: 'Florida',
    GooglePhoto: 'https://example.test/p.jpg',
    ...overrides
  };
}

test('reproduces the known production baseline', () => {
  const r = buildReport(FIXTURE);
  assert.strictEqual(r.totals.clinics, 451);
  assert.strictEqual(r.totals.passing, 375);
  assert.strictEqual(r.failingClauses.missing_priced_procedures.count, 52);
  assert.strictEqual(r.failingClauses.missing_photo.count, 27);
  assert.strictEqual(r.failingClauses.missing_google_rating.count, 18);
});

test('a clinic passes only when all three clauses hold', () => {
  assert.strictEqual(buildReport([row()]).totals.passing, 1);
  assert.strictEqual(buildReport([row({ PricedProcedures: 2 })]).totals.passing, 0);
  assert.strictEqual(buildReport([row({ PhotoCount: 0 })]).totals.passing, 0);
  assert.strictEqual(buildReport([row({ GoogleRating: null })]).totals.passing, 0);
  // Exactly 3 priced procedures and exactly 1 photo is the bar, not above it.
  assert.strictEqual(buildReport([row({ PricedProcedures: 3, PhotoCount: 1 })]).totals.passing, 1);
});

test('the provider clause is not part of the bar', () => {
  // Dropped 2026-10-05. Nothing in the report should mention providers.
  const r = buildReport([row()]);
  const keys = [...Object.keys(r.failingClauses), ...Object.keys(r.defects)];
  assert.ok(!keys.some(k => /provider/i.test(k)), `provider clause leaked in: ${keys}`);
});

test('a wrong PlaceID is reported separately from a genuinely missing photo', () => {
  // This is the GLO-75 conflation the audit exists to prevent.
  const wrongPlace = row({ ClinicID: 1, State: 'SC', GoogleState: 'Michigan', PhotoCount: 0 });
  const genuinelyNoPhoto = row({ ClinicID: 2, PhotoCount: 0, GooglePhoto: null });
  const r = buildReport([wrongPlace, genuinelyNoPhoto]);

  // Both still count against the photo clause -- the clause measures reality.
  assert.deepStrictEqual(r.failingClauses.missing_photo.clinicIds, [1, 2]);
  // But their causes are separable.
  assert.deepStrictEqual(r.defects.placeid_geo_mismatch.clinicIds, [1]);
  assert.deepStrictEqual(r.defects.google_has_no_photo.clinicIds, [2]);
});

test('no Google row is distinct from Google having no photo', () => {
  const r = buildReport([
    row({ ClinicID: 1, GoogleDataID: null, GoogleState: null, GooglePhoto: null }),
    row({ ClinicID: 2, GooglePhoto: null })
  ]);
  assert.deepStrictEqual(r.defects.no_google_places_row.clinicIds, [1]);
  assert.deepStrictEqual(r.defects.google_has_no_photo.clinicIds, [2]);
});

test('flags whole-degree coordinates (GLO-61)', () => {
  const r = buildReport([row({ ClinicID: 7, Latitude: 41, Longitude: -87 })]);
  assert.deepStrictEqual(r.defects.whole_degree_coordinates.clinicIds, [7]);
  assert.strictEqual(buildReport([row()]).defects.whole_degree_coordinates.count, 0);
});

test('flags a PostalCode whose ZIP region contradicts the state', () => {
  // Synergy Plastic Surgery (ClinicID 2) is in Austin TX with PostalCode
  // '11200' -- a ZIP-1 of 1 is DE/NY/PA.
  const r = buildReport([row({ ClinicID: 2, State: 'TX', PostalCode: '11200' })]);
  assert.deepStrictEqual(r.defects.postalcode_not_a_zip.clinicIds, [2]);
  // A consistent pair is not flagged.
  assert.strictEqual(
    buildReport([row({ State: 'TX', PostalCode: '78701' })]).defects.postalcode_not_a_zip.count,
    0
  );
});

test('the ZIP-1 table covers all ten leading digits and only US codes', () => {
  assert.deepStrictEqual(Object.keys(ZIP1_TO_STATES).sort(), '0123456789'.split(''));
  const { getValidStateCodes } = require('../utils/stateNormalizer');
  const valid = new Set(getValidStateCodes());
  for (const [d, states] of Object.entries(ZIP1_TO_STATES)) {
    for (const s of states) assert.ok(valid.has(s), `${s} under ZIP-1 ${d} is not a US state code`);
  }
});

test('state defects are broken out by kind, not lumped together', () => {
  const r = buildReport([
    row({ ClinicID: 1, State: 'Florida' }),
    row({ ClinicID: 2, State: 'Columbia SC', GoogleState: null }),
    row({ ClinicID: 3, State: null, GoogleState: null }),
    row({ ClinicID: 4, State: 'TR', GoogleState: null })
  ]);
  assert.deepStrictEqual(r.defects.state_format_variant.clinicIds, [1]);
  assert.deepStrictEqual(r.defects.state_malformed.clinicIds, [2]);
  assert.deepStrictEqual(r.defects.state_null.clinicIds, [3]);
  assert.deepStrictEqual(r.defects.state_non_us.clinicIds, [4]);
});

test('output is deterministic and diffable', () => {
  const shuffled = [...FIXTURE].reverse();
  assert.strictEqual(
    JSON.stringify(buildReport(FIXTURE)),
    JSON.stringify(buildReport(shuffled)),
    'report must not depend on row order'
  );
  // IDs sorted numerically, not lexicographically.
  const ids = buildReport(FIXTURE).failingClauses.missing_photo.clinicIds;
  assert.deepStrictEqual(ids, [...ids].sort((a, b) => a - b));
});

test('the committed fixture carries no API key', () => {
  for (const row of FIXTURE) {
    if (typeof row.GooglePhoto !== 'string') continue;
    const m = row.GooglePhoto.match(/[?&]key=([^&]*)/);
    if (m) assert.strictEqual(m[1], 'REDACTED', `clinic ${row.ClinicID} leaks a key`);
  }
});

test('redactSecrets strips key params without touching anything else', () => {
  const [out] = redactSecrets([
    row({
      GooglePhoto: 'https://x.test/photo?maxwidth=400&key=AIzaSecretValue123&ref=abc',
      State: 'FL',
      GoogleRating: 4.5,
      PlaceID: null
    })
  ]);
  assert.strictEqual(
    out.GooglePhoto,
    'https://x.test/photo?maxwidth=400&key=REDACTED&ref=abc'
  );
  assert.strictEqual(out.State, 'FL');
  assert.strictEqual(out.GoogleRating, 4.5);
  assert.strictEqual(out.PlaceID, null);
});

test('redactSecrets catches a key on any column, not just GooglePhoto', () => {
  const [out] = redactSecrets([
    row({ PlaceID: 'https://maps.test/d?api_key=AIzaOther999', GooglePhoto: null })
  ]);
  assert.strictEqual(out.PlaceID, 'https://maps.test/d?api_key=REDACTED');
  assert.strictEqual(out.GooglePhoto, null);
});
