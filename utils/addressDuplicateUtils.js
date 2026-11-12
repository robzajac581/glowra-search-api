/**
 * Same-address duplicate candidate detection (GLO-86).
 *
 * Pure functions, no database access, so they can be unit-tested against
 * production-shaped rows. The service layer
 * (clinic-management/services/duplicateDetectionService.js) loads rows and
 * calls into this module.
 *
 * Why this exists: two historical import passes produced paired half-rows for
 * the same practice (one row with prices, the other with Google rating and
 * photos). Their names and PlaceIDs differed, so the name and PlaceID checks
 * missed every one of them. The same normalized street address does catch
 * them, but address alone is wrong roughly 15% of the time: multi-location
 * practices, and different practices sharing a building or even a suite.
 *
 * So this module only ever SURFACES CANDIDATES with evidence. It never merges.
 * Each candidate pair is classified:
 *
 *   likely_duplicate  same street + locality, no conflicting suite, and the
 *                     website registrable domain matches (or exactly one side
 *                     has no website)
 *   review_only       same street + locality, but the evidence conflicts:
 *                     different website domains, neither side has a website,
 *                     or the same website shared by two differently named
 *                     practices that both carry their own price lists
 *   excluded          same street + locality but both sides name a suite/unit
 *                     and the suites differ (different offices in one building)
 *
 * Website domain is the most decisive signal; suite mismatch overrides it.
 */

const fuzzball = require('fuzzball');
const { toCanonicalState } = require('./stateNormalizer');
const { isFullAddress, parseFullAddress } = require('./addressUtils');

const CLASSIFICATIONS = Object.freeze({
  LIKELY_DUPLICATE: 'likely_duplicate',
  REVIEW_ONLY: 'review_only',
  EXCLUDED: 'excluded'
});

// USPS street suffix and directional abbreviations, applied per token.
const STREET_TOKEN_MAP = {
  street: 'st', str: 'st',
  avenue: 'ave', av: 'ave', aven: 'ave', avn: 'ave',
  boulevard: 'blvd', boul: 'blvd', blv: 'blvd',
  road: 'rd',
  drive: 'dr', drv: 'dr',
  lane: 'ln',
  freeway: 'fwy', frwy: 'fwy',
  highway: 'hwy', hiway: 'hwy',
  parkway: 'pkwy', pky: 'pkwy', pkway: 'pkwy',
  expressway: 'expy', expwy: 'expy',
  court: 'ct',
  place: 'pl',
  circle: 'cir',
  terrace: 'ter',
  square: 'sq',
  trail: 'trl',
  turnpike: 'tpke',
  center: 'ctr', centre: 'ctr',
  plaza: 'plz',
  point: 'pt',
  mount: 'mt',
  saint: 'st',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw'
};

const UNIT_WORDS = 'suite|ste|unit|apt|apartment|room|rm|bldg|building|floor|fl';

// A trailing unit designator: "#420", "Suite 420", "STE 202", "Suite #320", "UNIT 320".
const TRAILING_UNIT_RE = new RegExp(
  `\\s*(?:#\\s*|\\b(?:${UNIT_WORDS})\\b\\.?\\s*#?\\s*)([a-z0-9][a-z0-9-]*)\\s*$`,
  'i'
);
// A line (or comma part) that starts with a unit designator: "Suite 105",
// "Suite 107 Miami" (the city sometimes trails the unit on the same line).
const LEADING_UNIT_RE = new RegExp(
  `^\\s*(?:#\\s*|\\b(?:${UNIT_WORDS})\\b\\.?\\s*#?\\s*)([a-z0-9][a-z0-9-]*)\\b\\s*(.*)$`,
  'i'
);

// Generic words that carry no identity in a clinic name.
const NAME_STOPWORDS = new Set([
  'the', 'and', 'of', 'at', 'in', 'for', 'with', 'by', 'a',
  'dr', 'md', 'm', 'd', 'do', 'facs', 'llc', 'pc', 'pllc', 'inc', 'pa',
  'plastic', 'cosmetic', 'aesthetic', 'aesthetics', 'esthetic', 'esthetics',
  'surgery', 'surgical', 'surgeon', 'surgeons', 'center', 'centre', 'clinic',
  'institute', 'associates', 'group', 'practice', 'medical', 'med', 'spa',
  'dermatology', 'skin', 'care', 'laser', 'facial', 'face', 'body', 'best'
]);

// Hosts shared by unrelated businesses: matching on them proves nothing.
const SHARED_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'linktr.ee', 'business.site', 'wixsite.com',
  'squarespace.com', 'google.com', 'goo.gl', 'yelp.com', 'realself.com',
  'healthgrades.com', 'vitals.com', 'zocdoc.com', 'linkedin.com', 'twitter.com',
  'x.com', 'tiktok.com', 'youtube.com', 'godaddysites.com', 'weebly.com',
  'wordpress.com', 'blogspot.com'
]);

// Second-level public suffixes common enough to matter here.
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
  'com.br', 'com.mx', 'co.jp', 'co.za', 'com.sg', 'com.cn', 'co.in', 'com.tr'
]);

function str(v) {
  return v == null ? '' : String(v);
}

function zip5(value) {
  const m = str(value).match(/(?<!\d)(\d{5})(?:-\d{4})?(?!\d)/);
  return m ? m[1] : '';
}

function normalizeUnit(raw) {
  const u = str(raw).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^0+(?=.)/, '');
  return u;
}

/** Lowercase, strip punctuation, abbreviate suffixes/directionals. */
function normalizeStreet(street) {
  return str(street)
    .toLowerCase()
    .replace(/[–—]/g, ' ')
    .replace(/[.,'#()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(t => STREET_TOKEN_MAP[t] || t)
    .join(' ');
}

function normalizeCity(city) {
  return str(city)
    .toLowerCase()
    .replace(/[.,']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(t => (t === 'saint' ? 'st' : t === 'fort' ? 'ft' : t === 'mount' ? 'mt' : t))
    .join(' ');
}

function canonicalState(state) {
  const s = str(state).trim();
  if (!s) return '';
  return toCanonicalState(s) || s.toLowerCase();
}

/** Split "...Blvd Suite 105" into street + unit. */
function splitTrailingUnit(text) {
  const m = str(text).match(TRAILING_UNIT_RE);
  if (!m) return { street: str(text).trim(), unit: '' };
  const street = str(text).slice(0, m.index).replace(/[\s,–—-]+$/, '').trim();
  // "#" alone with nothing before it is not a street.
  if (!street) return { street: str(text).trim(), unit: '' };
  return { street, unit: m[1] };
}

/**
 * Parse the address fields of one clinic row into comparable parts.
 *
 * Handles the shapes found in production Clinics.Address:
 *   '9230 Katy Fwy Suite 420'                        street + trailing unit
 *   '1600 Kapiolani Blvd\nSuite 105\nHonolulu'       multi-line, embedded city
 *   '8765 SW 165th Ave\n\nSuite 107 Miami'           unit and city on one line
 *   'LA Skincare Center\n2284 East Maple Ave\n...'   name line before street
 *   '5454 Wisconsin Ave, Suite 1655'                 comma-separated unit
 *   '6545 N Wickham Rd, Melbourne, FL 32940'         full one-line address
 * and City values like 'Suite 551\nReston'.
 *
 * When Clinics.Address is empty the Google street/city/state/postal code are
 * used instead (rows 100 and 118 have an empty Address and a street number in
 * PostalCode, so mixing Clinics.PostalCode with the Google street would lie).
 *
 * @param {Object} row - { address, city, state, postalCode, googleStreet,
 *   googleCity, googleState, googlePostalCode }
 * @returns {{ street: string, streetKey: string, unit: string, city: string,
 *   state: string, zip: string, source: 'clinic'|'google'|'none' }}
 */
function parseAddressParts(row = {}) {
  let address = str(row.address).trim();
  let cityField = str(row.city);
  let stateField = str(row.state);
  let zipField = str(row.postalCode);
  let source = 'clinic';

  if (!address && str(row.googleStreet).trim()) {
    address = str(row.googleStreet).trim();
    cityField = str(row.googleCity);
    stateField = str(row.googleState);
    zipField = str(row.googlePostalCode);
    source = 'google';
  }
  if (!address) {
    return { street: '', streetKey: '', unit: '', city: '', state: canonicalState(stateField), zip: '', source: 'none' };
  }

  let street = '';
  let unit = '';
  let city = '';
  let state = '';
  let zip = '';

  const lines = address.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length === 1 && isFullAddress(lines[0])) {
    const parsed = parseFullAddress(lines[0]);
    if (parsed) {
      street = parsed.street;
      city = parsed.city;
      state = parsed.state;
      zip = parsed.postalCode;
    }
  }

  if (!street) {
    // The street line is the first line that starts with a house number; a
    // leading practice-name line is skipped.
    let streetIdx = lines.findIndex(l => /^\d/.test(l));
    if (streetIdx < 0) streetIdx = 0;
    const parts = lines[streetIdx].split(',').map(p => p.trim()).filter(Boolean);
    street = parts[0] || '';
    for (const extra of parts.slice(1)) {
      const um = extra.match(LEADING_UNIT_RE);
      if (um && !unit) unit = um[1];
    }
    for (const line of lines.slice(streetIdx + 1)) {
      const um = line.match(LEADING_UNIT_RE);
      if (um) {
        if (!unit) unit = um[1];
        if (um[2] && !city) city = um[2];
        continue;
      }
      // 'Salina, KS67401' or 'Honolulu'
      const zm = zip5(line);
      if (zm && !zip) zip = zm;
      const cityPart = line.replace(/\b\d{5}(?:-\d{4})?\b/, '').split(',')[0].trim();
      const statePart = line.split(',')[1];
      if (cityPart && !city) city = cityPart;
      if (statePart && !state) state = statePart.replace(/\d/g, '').trim();
    }
  }

  const split = splitTrailingUnit(street);
  street = split.street;
  if (split.unit && !unit) unit = split.unit;

  // City field can itself carry a unit line ('Suite 551\nReston').
  const cityLines = cityField.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let fieldCity = '';
  for (const line of cityLines) {
    const um = line.match(LEADING_UNIT_RE);
    if (um) {
      if (!unit) unit = um[1];
      if (um[2]) fieldCity = um[2];
    } else {
      fieldCity = line;
    }
  }

  return {
    street,
    streetKey: normalizeStreet(street),
    unit: normalizeUnit(unit),
    city: normalizeCity(fieldCity || city),
    state: canonicalState(stateField || state),
    zip: zip5(zipField) || zip,
    source
  };
}

/**
 * Registrable domain of a website ('https://www.lyosmd.com/x?y' -> 'lyosmd.com').
 * Returns null for empty/unparseable input and for shared hosts (facebook,
 * instagram, ...) where a match would prove nothing.
 */
function registrableDomain(url) {
  const raw = str(url).trim();
  if (!raw) return null;
  let host;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\d*\./, '').replace(/\.$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join('.');
  const domain = TWO_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3
    ? labels.slice(-3).join('.')
    : lastTwo;
  if (SHARED_HOSTS.has(domain)) return null;
  return domain;
}

function nameTokens(name) {
  return str(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !NAME_STOPWORDS.has(t));
}

/**
 * Name similarity 0..100 after removing generic words ('plastic', 'surgery',
 * 'md', ...), so 'Toledo Plastic Surgery' vs 'Farris Plastic Surgery' scores
 * low instead of riding on the shared boilerplate.
 */
function nameSimilarity(a, b) {
  const ta = nameTokens(a).join(' ');
  const tb = nameTokens(b).join(' ');
  if (!ta || !tb) return 0;
  return fuzzball.token_sort_ratio(ta, tb);
}

/**
 * Do two parsed addresses denote the same street location?
 * Street keys must be equal. Locality: ZIP when both have one (and it must
 * agree); otherwise city + state.
 * @returns {{ same: boolean, localityBasis: 'zip'|'city_state'|null }}
 */
function sameLocation(pa, pb) {
  if (!pa.streetKey || !pb.streetKey || pa.streetKey !== pb.streetKey) {
    return { same: false, localityBasis: null };
  }
  if (pa.zip && pb.zip) {
    return { same: pa.zip === pb.zip, localityBasis: 'zip' };
  }
  if (pa.city && pb.city && pa.city === pb.city && (!pa.state || !pb.state || pa.state === pb.state)) {
    return { same: true, localityBasis: 'city_state' };
  }
  return { same: false, localityBasis: null };
}

function hasPrices(row) {
  if (row.pricedProcedures == null) return null;
  return Number(row.pricedProcedures) > 0;
}

/**
 * Classify a pair of clinic rows already known (or about to be checked) to
 * share an address. Returns null when the addresses do not match.
 *
 * Row shape: { clinicId, clinicName, address, city, state, postalCode,
 *   website, googleStreet?, googleCity?, googleState?, googlePostalCode?,
 *   googleWebsite?, pricedProcedures? }
 */
function classifyAddressPair(a, b) {
  const pa = parseAddressParts(a);
  const pb = parseAddressParts(b);
  const loc = sameLocation(pa, pb);
  if (!loc.same) return null;

  const domainA = registrableDomain(a.website) || registrableDomain(a.googleWebsite);
  const domainB = registrableDomain(b.website) || registrableDomain(b.googleWebsite);
  const similarity = nameSimilarity(a.clinicName, b.clinicName);

  let unitComparison;
  if (pa.unit && pb.unit) unitComparison = pa.unit === pb.unit ? 'match' : 'mismatch';
  else if (pa.unit || pb.unit) unitComparison = 'one_side_missing';
  else unitComparison = 'both_missing';

  let websiteComparison;
  if (domainA && domainB) websiteComparison = domainA === domainB ? 'match' : 'mismatch';
  else if (domainA || domainB) websiteComparison = 'one_side_missing';
  else websiteComparison = 'both_missing';

  const pricedA = hasPrices(a);
  const pricedB = hasPrices(b);

  let classification;
  let reason;
  if (unitComparison === 'mismatch') {
    classification = CLASSIFICATIONS.EXCLUDED;
    reason = 'suite_mismatch';
  } else if (websiteComparison === 'mismatch') {
    classification = CLASSIFICATIONS.REVIEW_ONLY;
    reason = 'website_domain_mismatch';
  } else if (websiteComparison === 'both_missing') {
    classification = CLASSIFICATIONS.REVIEW_ONLY;
    reason = 'no_website_on_either_side';
  } else if (websiteComparison === 'match' && similarity < 50 && pricedA === true && pricedB === true) {
    // Two differently named practices on one shared site, each with its own
    // price list (e.g. two surgeons in one group: clinics 32 / 42). The
    // historical half-row duplicates never had prices on both sides.
    classification = CLASSIFICATIONS.REVIEW_ONLY;
    reason = 'shared_website_distinct_names_both_priced';
  } else {
    classification = CLASSIFICATIONS.LIKELY_DUPLICATE;
    reason = websiteComparison === 'match' ? 'website_domain_match' : 'website_missing_on_one_side';
  }

  return {
    clinicIds: [a.clinicId ?? null, b.clinicId ?? null],
    clinicNames: [a.clinicName ?? null, b.clinicName ?? null],
    classification,
    reason,
    evidence: {
      addressMatch: true,
      normalizedStreet: pa.streetKey,
      localityBasis: loc.localityBasis,
      zip: loc.localityBasis === 'zip' ? pa.zip : null,
      units: [pa.unit || null, pb.unit || null],
      unitComparison,
      websiteDomains: [domainA, domainB],
      websiteComparison,
      nameSimilarity: similarity,
      pricedProcedures: [a.pricedProcedures ?? null, b.pricedProcedures ?? null],
      addressSources: [pa.source, pb.source]
    }
  };
}

/**
 * Find every same-address candidate pair in a set of clinic rows.
 * Rows are grouped by normalized street first, so this is linear in practice.
 * Results are sorted likely_duplicate, review_only, excluded, then by IDs.
 */
function findAddressCandidatePairs(rows) {
  const byStreet = new Map();
  for (const row of rows || []) {
    const key = parseAddressParts(row).streetKey;
    if (!key) continue;
    if (!byStreet.has(key)) byStreet.set(key, []);
    byStreet.get(key).push(row);
  }

  const order = {
    [CLASSIFICATIONS.LIKELY_DUPLICATE]: 0,
    [CLASSIFICATIONS.REVIEW_ONLY]: 1,
    [CLASSIFICATIONS.EXCLUDED]: 2
  };
  const pairs = [];
  for (const group of byStreet.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = Number(group[i].clinicId) <= Number(group[j].clinicId)
          ? [group[i], group[j]]
          : [group[j], group[i]];
        const pair = classifyAddressPair(a, b);
        if (pair) pairs.push(pair);
      }
    }
  }
  pairs.sort((x, y) =>
    order[x.classification] - order[y.classification] ||
    Number(x.clinicIds[0]) - Number(y.clinicIds[0]) ||
    Number(x.clinicIds[1]) - Number(y.clinicIds[1])
  );
  return pairs;
}

module.exports = {
  CLASSIFICATIONS,
  parseAddressParts,
  normalizeStreet,
  registrableDomain,
  nameSimilarity,
  classifyAddressPair,
  findAddressCandidatePairs
};
