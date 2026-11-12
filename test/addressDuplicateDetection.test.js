const test = require('node:test');
const assert = require('node:assert');

const {
  CLASSIFICATIONS,
  parseAddressParts,
  normalizeStreet,
  registrableDomain,
  nameSimilarity,
  classifyAddressPair,
  findAddressCandidatePairs
} = require('../utils/addressDuplicateUtils');

const { LIKELY_DUPLICATE, REVIEW_ONLY, EXCLUDED } = CLASSIFICATIONS;

// Clinic rows below are production data (GLO-86). Rows marked "pre-merge" are
// the archived duplicate halves from DeletedClinics as they stood before the
// 2026-10-21 merges; DeletedClinics keeps no City/State/PostalCode, so those
// rows carry only what was archived plus the state of their counterpart.
// Rows marked "current" are Clinics rows read on 2026-10-21.
const C = {
  // Known true duplicate pairs.
  c3: { clinicId: 3, clinicName: 'Toledo Plastic Surgery', address: '6110 Sherry Ln\nDallas', state: 'TX', postalCode: '75225', website: 'https://toledoplasticsurgery.com/pricing-financing' }, // pre-merge
  c1: { clinicId: 1, clinicName: 'Farris Plastic Surgery', address: '6110 Sherry Ln', city: 'Dallas', state: 'TX', postalCode: '75225', website: 'https://toledoplasticsurgery.com/?utm_source=google' },
  c4: { clinicId: 4, clinicName: "Patronella's Plastic Surgery", address: '', state: 'TX', website: 'https://www.patronellamd.com/price-list/' }, // pre-merge
  c118: { clinicId: 118, clinicName: 'Christopher K. Patronella, MD', address: '', state: 'TX', postalCode: '12727', website: 'https://www.patronellamd.com/?y_source=1', googleStreet: '12727 Kimberley Ln Suite 300', googleCity: 'Houston', googleState: 'Texas', googlePostalCode: '77024' }, // current
  c36: { clinicId: 36, clinicName: 'Primera Plastic Surgery & Med Spa', address: '1035 Primera Boulevard\nLake Mary', state: 'FL', website: 'https://www.wedofaces.com/pricing/' }, // pre-merge
  c127: { clinicId: 127, clinicName: 'Primera Plastic Surgery: Edward J. Gross, MD', address: '1035 Primera Blvd', city: 'Lake Mary', state: 'FL', postalCode: '32746', website: 'https://www.wedofaces.com/?utm_source=google' },
  c37: { clinicId: 37, clinicName: 'LYOS PLASTIC SURGERY & DERMATOLOGY ASSOCIATES', address: '9230 Katy Freeway #420', city: 'Houston', state: 'TX', postalCode: '77055', website: 'https://www.lyosmd.com/patient-resources/price-list/' }, // pre-merge
  c117: { clinicId: 117, clinicName: 'Andrew Lyos, MD, FACS', address: '9230 Katy Fwy Suite 420', city: 'Houston', state: 'TX', postalCode: '77055', website: 'https://www.lyosmd.com/?utm_source=GMBlisting' },
  c49: { clinicId: 49, clinicName: 'Allure Esthetic Plastic Surgery', address: '600 Broadway Suite 320\nSeattle', state: 'WA', website: 'https://www.allureesthetic.com/price-list/' }, // pre-merge
  c116: { clinicId: 116, clinicName: 'Allure Esthetic - Dr. Javad Sajan - Best Plastic Surgeon in Seattle', address: '600 Broadway UNIT 320', city: 'Seattle', state: 'WA', postalCode: '98122', website: 'https://www.allureesthetic.com/?utm_source=Google+Map' },
  c63: { clinicId: 63, clinicName: 'Certified Cosmetics and Skin Care With Dr.Sergio Gaitan', address: '8765 SW 165th Ave\n\nSuite 107 Miami', state: 'FL', website: 'https://www.certifiedcosmeticsmiami.com/cosmetic-dermatology' }, // pre-merge
  c123: { clinicId: 123, clinicName: 'Certified Cosmetics Dermatology and Laser', address: '8765 SW 165th Ave #107', city: 'Miami', state: 'FL', postalCode: '33193', website: 'https://www.certifiedcosmeticsmiami.com/' },
  c115: { clinicId: 115, clinicName: 'BRAD M GANDOLFI MD FACS', address: '25 5th Ave Suite 1F\nNew York', state: 'NY', website: 'https://www.drgandolfi.com/pricesheet/' }, // pre-merge (merged 2026-10-08)
  c124: { clinicId: 124, clinicName: 'Dr. Brad Gandolfi MD at Hudson Plastic Surgery and Medical Aesthetics', address: '25 5th Ave #1F', city: 'New York', state: 'NY', postalCode: '10003', website: 'http://www.drgandolfi.com/?utm_source=google' },

  // Known non-duplicates (current).
  c17: { clinicId: 17, clinicName: 'Surgical Arts On State', address: '1722 State Street\nSuite 201\nSanta Barbara', state: 'CA', postalCode: '93101', website: 'https://surgicalartsonstate.com/pricing/', pricedProcedures: 27 },
  c121: { clinicId: 121, clinicName: 'Surgical Arts Surgical Center', address: '1722 State St STE 202', city: 'Santa Barbara', state: 'CA', postalCode: '93101', website: 'http://www.surgicalartssc.com/', pricedProcedures: 0 },
  c20: { clinicId: 20, clinicName: 'Loftus Plastic Surgery Center', address: '2139 Auburn Ave #201', city: 'Cincinnati', state: 'OH', postalCode: '45219', website: 'https://infoplasticsurgery.com/' },
  c21: { clinicId: 21, clinicName: 'Loftus Plastic Surgery Center', address: '1881 Dixie Highway\nSuite 300\nFort Wright', state: 'KY', postalCode: '41011', website: 'https://infoplasticsurgery.com/?cost-plastic-surgery/costloftus/' },
  c98: { clinicId: 98, clinicName: 'The Naderi Center for Plastic Surgery & Dermatology', address: '5454 Wisconsin Ave, Suite 1655', city: 'Chevy Chase', state: 'MD', postalCode: '20815', website: 'https://www.virginiafacialplasticsurgery.com/for-patients/surgery-fees', googleStreet: 'Pavillion II, 1850 Town Center Pkwy Suite 551', googleCity: 'Reston', googleState: 'Virginia', googlePostalCode: '20190' },
  c99: { clinicId: 99, clinicName: 'The Naderi Center for Plastic Surgery & Dermatology', address: '1850 Town Center Parkway, Pavillion II', city: 'Suite 551\nReston', state: 'VA', postalCode: '20190', website: 'https://www.virginiafacialplasticsurgery.com/for-patients/surgery-fees' },
  c54: { clinicId: 54, clinicName: 'HUGO HIGA,M.D. Eyelid and Facial Surgery', address: '1600 Kapiolani Blvd\nSuite 105\nHonolulu', state: 'HI', postalCode: '96814', website: 'https://www.hugohigamd.com/patient-resources/fees-financing/' },
  c119: { clinicId: 119, clinicName: 'Higa Hugo M.D., LLC', address: '1600 Kapiolani Blvd #105', city: 'Honolulu', state: 'HI', postalCode: '96814', website: 'http://www.hawaiianeye.land/' },
  c32: { clinicId: 32, clinicName: 'Dr.Zoran Cosmetic & Plastic Surgery', address: '1116 E Broward Blvd\nFort Lauderdale', state: 'FL', postalCode: '33301', website: 'https://www.drzoran.com/patient-resources-2/price-estimates/', pricedProcedures: 53 },
  c42: { clinicId: 42, clinicName: 'Y Plastic Surgery- Dr.Asaf Yalif', address: '1116 E Broward Blvd', city: 'Fort Lauderdale', state: 'FL', postalCode: '33301', website: 'https://www.drzoran.com/?utm_source=GMBlisting', pricedProcedures: 27 }
};

function classify(a, b) {
  const pair = classifyAddressPair(a, b);
  return pair && pair.classification;
}

// --- known true duplicate pairs ---------------------------------------------

test('3/1: multi-line address with embedded city, same domain, different names', () => {
  const pair = classifyAddressPair(C.c3, C.c1);
  assert.strictEqual(pair.classification, LIKELY_DUPLICATE);
  assert.strictEqual(pair.evidence.localityBasis, 'zip');
  assert.strictEqual(pair.evidence.websiteComparison, 'match');
  assert.ok(pair.evidence.nameSimilarity < 50, 'names really are different');
});

test('37/117: Freeway #420 vs Fwy Suite 420', () => {
  const pair = classifyAddressPair(C.c37, C.c117);
  assert.strictEqual(pair.classification, LIKELY_DUPLICATE);
  assert.deepStrictEqual(pair.evidence.units, ['420', '420']);
  assert.strictEqual(pair.evidence.unitComparison, 'match');
});

test('36/127: Boulevard vs Blvd, locality from embedded city when ZIP missing', () => {
  const pair = classifyAddressPair(C.c36, C.c127);
  assert.strictEqual(pair.classification, LIKELY_DUPLICATE);
  assert.strictEqual(pair.evidence.localityBasis, 'city_state');
});

test('49/116: Suite 320 vs UNIT 320', () => {
  assert.strictEqual(classify(C.c49, C.c116), LIKELY_DUPLICATE);
});

test('63/123: unit and city on one line ("Suite 107 Miami") vs #107', () => {
  const pair = classifyAddressPair(C.c63, C.c123);
  assert.strictEqual(pair.classification, LIKELY_DUPLICATE);
  assert.deepStrictEqual(pair.evidence.units, ['107', '107']);
});

test('115/124: alphanumeric suite 1F', () => {
  assert.strictEqual(classify(C.c115, C.c124), LIKELY_DUPLICATE);
});

test('4/118: NOT detectable by address -- the archived half had an empty Address', () => {
  // Documented limitation, not a desired outcome: clinic 4 was archived with
  // Address '' and DeletedClinics keeps no ZIP/city, so there is nothing to
  // compare. The website domain (patronellamd.com) is the only shared signal.
  assert.strictEqual(classifyAddressPair(C.c4, C.c118), null);
});

// --- known non-duplicates ----------------------------------------------------

test('17/121: same building, suite 201 vs 202, different sites -> excluded', () => {
  const pair = classifyAddressPair(C.c17, C.c121);
  assert.strictEqual(pair.classification, EXCLUDED);
  assert.strictEqual(pair.reason, 'suite_mismatch');
});

test('20/21: same practice, different cities -> not a candidate', () => {
  assert.strictEqual(classifyAddressPair(C.c20, C.c21), null);
});

test('98/99: different street addresses -> not a candidate (Google street on 98 is not used)', () => {
  assert.strictEqual(classifyAddressPair(C.c98, C.c99), null);
});

test('54/119: same suite but different websites -> review_only, never likely', () => {
  const pair = classifyAddressPair(C.c54, C.c119);
  assert.strictEqual(pair.classification, REVIEW_ONLY);
  assert.strictEqual(pair.reason, 'website_domain_mismatch');
});

test('32/42: one site, two differently named surgeons, both priced -> review_only', () => {
  const pair = classifyAddressPair(C.c32, C.c42);
  assert.strictEqual(pair.classification, REVIEW_ONLY);
  assert.strictEqual(pair.reason, 'shared_website_distinct_names_both_priced');
});

test('32/42 without price counts falls back to the domain rule', () => {
  const { pricedProcedures: _a, ...a } = C.c32;
  const { pricedProcedures: _b, ...b } = C.c42;
  assert.strictEqual(classify(a, b), LIKELY_DUPLICATE);
});

// --- whole-set scan ----------------------------------------------------------

test('findAddressCandidatePairs over all known rows', () => {
  const pairs = findAddressCandidatePairs(Object.values(C));
  const byIds = Object.fromEntries(pairs.map(p => [p.clinicIds.join('/'), p.classification]));
  assert.deepStrictEqual(byIds, {
    '1/3': LIKELY_DUPLICATE,
    '36/127': LIKELY_DUPLICATE,
    '37/117': LIKELY_DUPLICATE,
    '49/116': LIKELY_DUPLICATE,
    '63/123': LIKELY_DUPLICATE,
    '115/124': LIKELY_DUPLICATE,
    '32/42': REVIEW_ONLY,
    '54/119': REVIEW_ONLY,
    '17/121': EXCLUDED
  });
  // Sorted likely first, excluded last.
  assert.strictEqual(pairs[0].classification, LIKELY_DUPLICATE);
  assert.strictEqual(pairs[pairs.length - 1].classification, EXCLUDED);
});

// --- building blocks ---------------------------------------------------------

test('normalizeStreet abbreviates suffixes and directionals', () => {
  assert.strictEqual(normalizeStreet('1035 Primera Boulevard'), '1035 primera blvd');
  assert.strictEqual(normalizeStreet('9230 Katy Freeway'), '9230 katy fwy');
  assert.strictEqual(normalizeStreet('2284 East Maple Ave.'), '2284 e maple ave');
  assert.strictEqual(normalizeStreet('1850 Town Center Parkway'), '1850 town ctr pkwy');
});

test('parseAddressParts handles production address shapes', () => {
  const higa = parseAddressParts(C.c54);
  assert.strictEqual(higa.streetKey, '1600 kapiolani blvd');
  assert.strictEqual(higa.unit, '105');
  assert.strictEqual(higa.city, 'honolulu');

  // Unit hidden in the City column.
  const naderi = parseAddressParts(C.c99);
  assert.strictEqual(naderi.unit, '551');
  assert.strictEqual(naderi.city, 'reston');
  assert.strictEqual(naderi.streetKey, '1850 town ctr pkwy');

  // Practice-name line before the street.
  const la = parseAddressParts({ address: 'LA Skincare Center\n2284 East Maple Ave\nEl Segundo', state: 'CA' });
  assert.strictEqual(la.streetKey, '2284 e maple ave');
  assert.strictEqual(la.city, 'el segundo');

  // "Suite #320" and a blank line.
  assert.strictEqual(parseAddressParts({ address: '600 Broadway Suite #320\n\nSeattle' }).unit, '320');

  // City + state + ZIP on the last line with no space.
  const salina = parseAddressParts({ address: '828 Elmhurst\nSalina, KS67401' });
  assert.strictEqual(salina.city, 'salina');
  assert.strictEqual(salina.zip, '67401');

  // One-line full address.
  const full = parseAddressParts({ address: '6545 N Wickham Rd Suite C-101, Melbourne, FL 32940' });
  assert.strictEqual(full.streetKey, '6545 n wickham rd');
  assert.strictEqual(full.unit, 'c101');
  assert.strictEqual(full.zip, '32940');
  assert.strictEqual(full.state, 'FL');
});

test('empty Clinics.Address falls back to the Google street and ZIP as a set', () => {
  // Clinic 118 has PostalCode '12727' (its street number); it must not be
  // mixed with the Google street.
  const p = parseAddressParts(C.c118);
  assert.strictEqual(p.source, 'google');
  assert.strictEqual(p.streetKey, '12727 kimberley ln');
  assert.strictEqual(p.zip, '77024');
  assert.strictEqual(p.unit, '300');
});

test('conflicting ZIPs are never the same location', () => {
  const a = { clinicName: 'A', address: '100 Main St', postalCode: '10001', website: 'a.com' };
  const b = { clinicName: 'A', address: '100 Main Street', postalCode: '20002', website: 'a.com' };
  assert.strictEqual(classifyAddressPair(a, b), null);
});

test('no ZIP and no city on one side -> not a candidate', () => {
  const a = { clinicName: 'A', address: '100 Main St', state: 'TX', website: 'a.com' };
  const b = { clinicName: 'A', address: '100 Main St', city: 'Austin', state: 'TX', postalCode: '78701', website: 'a.com' };
  assert.strictEqual(classifyAddressPair(a, b), null);
});

test('website rules: one side missing -> likely; both missing -> review', () => {
  const a = { clinicName: 'Glow', address: '1 Elm St', postalCode: '30301', website: 'https://glow.com' };
  const b = { clinicName: 'Glow Spa', address: '1 Elm Street', postalCode: '30301', website: null };
  const c = { clinicName: 'Glow', address: '1 Elm St', postalCode: '30301' };
  assert.strictEqual(classify(a, b), LIKELY_DUPLICATE);
  assert.strictEqual(classifyAddressPair(b, c).reason, 'no_website_on_either_side');
  assert.strictEqual(classify(b, c), REVIEW_ONLY);
});

test('one side names a suite, the other does not -> not excluded', () => {
  const a = { clinicName: 'X', address: '5 Oak Ave Suite 9', postalCode: '30301', website: 'xclinic.com' };
  const b = { clinicName: 'X', address: '5 Oak Ave', postalCode: '30301', website: 'xclinic.com' };
  const pair = classifyAddressPair(a, b);
  assert.strictEqual(pair.classification, LIKELY_DUPLICATE);
  assert.strictEqual(pair.evidence.unitComparison, 'one_side_missing');
});

test('registrableDomain', () => {
  assert.strictEqual(registrableDomain('https://www.lyosmd.com/?utm_source=GMBlisting'), 'lyosmd.com');
  assert.strictEqual(registrableDomain('toledoplasticsurgery.com/pricing'), 'toledoplasticsurgery.com');
  assert.strictEqual(registrableDomain('http://www.hawaiianeye.land/'), 'hawaiianeye.land');
  assert.strictEqual(registrableDomain('https://locations.example.co.uk/a'), 'example.co.uk');
  assert.strictEqual(registrableDomain('https://shop.example.com'), 'example.com');
  assert.strictEqual(registrableDomain('https://www.instagram.com/cps_plasticsurgery/'), null);
  assert.strictEqual(registrableDomain(''), null);
  assert.strictEqual(registrableDomain(null), null);
});

test('nameSimilarity ignores boilerplate words', () => {
  assert.ok(nameSimilarity('Toledo Plastic Surgery', 'Farris Plastic Surgery') < 50);
  assert.ok(nameSimilarity('HUGO HIGA,M.D. Eyelid and Facial Surgery', 'Higa Hugo M.D., LLC') >= 50);
  assert.strictEqual(nameSimilarity('Plastic Surgery', 'Plastic Surgery Center'), 0);
});
