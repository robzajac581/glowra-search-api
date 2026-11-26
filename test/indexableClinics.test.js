const test = require('node:test');
const assert = require('node:assert');

const {
  CLINICS_SQL,
  proceduresSql,
  buildIndexableClinics,
  fetchIndexableClinics
} = require('../services/indexableClinics');

const BASE = 'https://api.example.test';

function clinicRow(overrides = {}) {
  return {
    ClinicID: 7,
    ClinicName: ' Glow Med Spa ',
    Address: '1 Main St',
    City: 'Miami',
    State: 'FL',
    PostalCode: '33139',
    Phone: '305-555-0100',
    Website: 'https://glow.example',
    Latitude: 25.79,
    Longitude: -80.13,
    GoogleRating: 4.7,
    GoogleReviewCount: 120,
    Street: '1 Main Street',
    GpCity: null,
    GpState: null,
    GpPostalCode: null,
    Category: 'medical spa',
    Description: 'A spa.',
    GooglePhoto: null,
    LCity: null,
    LState: null,
    PrimaryPhotoID: 99,
    PrimaryPhotoReference: 'AciIO2' + 'x'.repeat(60),
    PrimaryPhotoURL: null,
    ...overrides
  };
}

function procRows(clinicId, n, overrides = {}) {
  return Array.from({ length: n }, (_, i) => ({
    ClinicID: clinicId,
    ProcedureID: clinicId * 100 + i,
    ProcedureName: `Procedure ${i}`,
    AverageCost: 100 + i,
    PriceUnit: null,
    Category: 'Face',
    ...overrides
  }));
}

test('shapes a clinic with address, procedures and prices', () => {
  const [c] = buildIndexableClinics([clinicRow()], [
    ...procRows(7, 3),
    { ClinicID: 7, ProcedureID: 1, ProcedureName: 'Botox', AverageCost: 12, PriceUnit: 'per unit', Category: 'Injectables' }
  ], { baseURL: BASE });

  assert.strictEqual(c.clinicId, 7);
  assert.strictEqual(c.clinicName, 'Glow Med Spa');
  assert.strictEqual(c.address, '1 Main Street'); // GooglePlacesData.Street wins
  assert.strictEqual(c.city, 'Miami');
  assert.strictEqual(c.state, 'FL');
  assert.strictEqual(c.zipCode, '33139');
  assert.strictEqual(c.rating, 4.7);
  assert.strictEqual(c.reviewCount, 120);
  assert.strictEqual(c.procedures.length, 4);
  const botox = c.procedures.find(p => p.procedureName === 'Botox');
  assert.deepStrictEqual(botox, {
    procedureId: 1, procedureName: 'Botox', category: 'Injectables', price: 12, priceUnit: 'per unit'
  });
  assert.ok(!('priceUnit' in c.procedures[0]));
});

test('photo is a URL on our proxy and never carries a Google key', () => {
  const [c] = buildIndexableClinics([clinicRow()], procRows(7, 3), { baseURL: BASE });
  assert.strictEqual(c.photoUrl, `${BASE}/api/photos/proxy/99?size=medium`);
  assert.ok(!/key=/.test(JSON.stringify(c)));
});

test('drops a clinic whose de-duplicated priced procedures fall below 3', () => {
  const rows = [...procRows(7, 2), { ...procRows(7, 1)[0], ProcedureID: 5, AverageCost: 0 }];
  assert.strictEqual(buildIndexableClinics([clinicRow()], rows, { baseURL: BASE }).length, 0);
});

test('a clinic listed twice (two GooglePlacesData rows) appears once', () => {
  const out = buildIndexableClinics([clinicRow(), clinicRow({ Street: 'Other' })], procRows(7, 3), { baseURL: BASE });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].address, '1 Main Street');
});

test('procedures are attached to the right clinic', () => {
  const out = buildIndexableClinics(
    [clinicRow({ ClinicID: 1 }), clinicRow({ ClinicID: 2 })],
    [...procRows(1, 3), ...procRows(2, 4)],
    { baseURL: BASE }
  );
  assert.deepStrictEqual(out.map(c => [c.clinicId, c.procedures.length]), [[1, 3], [2, 4]]);
});

test('SQL enforces the complete-data bar and excludes deleted clinics', () => {
  assert.match(CLINICS_SQL, /HAVING COUNT\(\*\) >= 3/);
  assert.match(CLINICS_SQL, /AverageCost > 0/);
  assert.match(CLINICS_SQL, /photos\.n >= 1/);
  assert.match(CLINICS_SQL, /GoogleRating IS NOT NULL/);
  assert.match(CLINICS_SQL, /DeletedClinics/);
  // Read-only.
  for (const q of [CLINICS_SQL, proceduresSql('p.PriceUnit')]) {
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|MERGE)\b/i.test(q));
  }
});

test('fetch runs a fixed number of queries, sequentially, regardless of clinic count', async () => {
  const queries = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const pool = {
    request() {
      return {
        async query(q) {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          queries.push(q);
          await new Promise(r => setImmediate(r));
          inFlight -= 1;
          if (/INFORMATION_SCHEMA/.test(q)) return { recordset: [{ ok: 1 }] };
          if (/FROM Clinics c/.test(q)) {
            return { recordset: [clinicRow({ ClinicID: 1 }), clinicRow({ ClinicID: 2 })] };
          }
          return { recordset: [...procRows(1, 3), ...procRows(2, 3)] };
        }
      };
    }
  };
  const out = await fetchIndexableClinics(pool, { baseURL: BASE });
  assert.strictEqual(out.length, 2);
  assert.ok(queries.length <= 3, `expected <= 3 queries, got ${queries.length}`);
  assert.strictEqual(maxInFlight, 1);
});
