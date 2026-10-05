#!/usr/bin/env node
/**
 * Glowra data-quality audit.
 *
 * Reports, per clinic, which clauses of the publishing bar it fails, plus the
 * known structural data defects kept as their OWN lines.
 *
 * ---------------------------------------------------------------------------
 * THE PUBLISHING BAR (as of 2026-10-05)
 * ---------------------------------------------------------------------------
 *   - at least 3 procedures with a price
 *   - at least 1 photo
 *   - a Google rating
 * The provider clause was dropped on 2026-10-05 and is deliberately not here.
 *
 * ---------------------------------------------------------------------------
 * DEFECTS ARE NOT FOLDED INTO CLAUSE COUNTS
 * ---------------------------------------------------------------------------
 * A clinic with no photo because its PlaceID resolves to the wrong place
 * (GLO-75) is a different problem from a clinic Google genuinely has no photo
 * for. Conflating them is what hid GLO-75: the photo clause counted both as
 * "needs a photo", so the wrong-PlaceID rows looked like ordinary backlog.
 * Defects are therefore reported as separate named lines and the clause counts
 * are left untouched, so the two numbers can move independently.
 *
 * ---------------------------------------------------------------------------
 * RE-RUNNABLE AND DIFFABLE
 * ---------------------------------------------------------------------------
 * Every output is deterministic: IDs sorted numerically, keys in a fixed
 * order, no timestamps in the diffable body (the run timestamp lives in a
 * separate `meta` block that `--no-meta` omits). Commit the JSON and
 * `git diff` two runs to see exactly which clinics crossed the bar.
 *
 * Usage:
 *   node scripts/auditDataQuality.js                       # query prod, print summary
 *   node scripts/auditDataQuality.js --json <file>         # also write the diffable JSON
 *   node scripts/auditDataQuality.js --fixture <file>      # offline: read rows from a fixture
 *   node scripts/auditDataQuality.js --dump-fixture <file> # save the raw rows as a fixture
 *   node scripts/auditDataQuality.js --no-meta             # omit the timestamp block
 *
 * Azure SQL here is Basic / 5 DTU and a SELECT * timed out at 15s during
 * GLO-73. The audit therefore runs ONE query that names its columns, with the
 * per-clinic counts pre-aggregated in CTEs rather than pulled row-by-row.
 */

process.env.DISABLE_SCHEDULED_JOBS = 'true';

const fs = require('fs');
const path = require('path');
const { toCanonicalState, classifyState } = require('../utils/stateNormalizer');

const MIN_PRICED_PROCEDURES = 3;
const MIN_PHOTOS = 1;

/**
 * Coarse ZIP-prefix sanity check: first digit of a US ZIP -> the states that
 * use it. Used ONLY to flag gross mismatches, never to derive a state.
 *
 * It exists because Clinics.PostalCode is not trustworthy. Verified
 * 2026-10-05: Synergy Plastic Surgery (Austin TX) carries '11200', Sean Younai
 * MD (Encino CA) carries '16055', Omaha Face (Elkhorn NE) carries '17838'.
 * Read as ZIPs those are New York and Pennsylvania. A coarse first-digit check
 * catches that class without needing a full ZIP database.
 */
const ZIP1_TO_STATES = {
  '0': ['CT', 'MA', 'ME', 'NH', 'NJ', 'RI', 'VT'],
  '1': ['DE', 'NY', 'PA'],
  '2': ['DC', 'MD', 'NC', 'SC', 'VA', 'WV'],
  '3': ['AL', 'FL', 'GA', 'MS', 'TN'],
  '4': ['IN', 'KY', 'MI', 'OH'],
  '5': ['IA', 'MN', 'MT', 'ND', 'SD', 'WI'],
  '6': ['IL', 'KS', 'MO', 'NE'],
  '7': ['AR', 'LA', 'OK', 'TX'],
  '8': ['AZ', 'CO', 'ID', 'NM', 'NV', 'UT', 'WY'],
  '9': ['AK', 'CA', 'HI', 'OR', 'WA']
};

const QUERY = `
  WITH priced AS (
    SELECT ClinicID, COUNT(*) AS n
    FROM Procedures
    WHERE ClinicID IS NOT NULL AND AverageCost IS NOT NULL AND AverageCost > 0
    GROUP BY ClinicID
  ),
  photos AS (
    SELECT ClinicID, COUNT(*) AS n FROM ClinicPhotos GROUP BY ClinicID
  )
  SELECT
    c.ClinicID,
    c.State,
    c.PostalCode,
    c.PlaceID,
    c.GoogleRating,
    c.Latitude,
    c.Longitude,
    ISNULL(priced.n, 0) AS PricedProcedures,
    ISNULL(photos.n, 0) AS PhotoCount,
    g.GoogleDataID,
    g.State AS GoogleState,
    g.Photo AS GooglePhoto
  FROM Clinics c
  LEFT JOIN priced ON priced.ClinicID = c.ClinicID
  LEFT JOIN photos ON photos.ClinicID = c.ClinicID
  LEFT JOIN GooglePlacesData g ON g.ClinicID = c.ClinicID
  ORDER BY c.ClinicID
`;

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

/** Pure: rows in, report out. Keeps the audit testable without a database. */
function buildReport(rows) {
  const clauses = {
    missing_priced_procedures: [],
    missing_photo: [],
    missing_google_rating: []
  };

  const defects = {
    // GLO-75 class: the PlaceID resolves to somewhere else entirely, so every
    // Google-sourced field on the clinic is suspect.
    placeid_geo_mismatch: [],
    // No Google row at all: the clinic can never gain a rating or a Google
    // photo until it is matched. Distinct from "Google has no photo for it".
    no_google_places_row: [],
    // Google row exists and resolves correctly, but Google genuinely has no
    // photo. This is real backlog, not a bug.
    google_has_no_photo: [],
    // GLO-61: coordinates rounded to whole degrees, ~111km of error.
    whole_degree_coordinates: [],
    // PostalCode's first digit is inconsistent with the state. Coarse check.
    postalcode_not_a_zip: [],
    // GLO-76: State not stored as a canonical two-letter USPS code.
    state_format_variant: [],
    state_malformed: [],
    state_null: [],
    state_non_us: []
  };

  let passing = 0;

  for (const row of rows) {
    const id = row.ClinicID;
    const priced = Number(row.PricedProcedures) || 0;
    const photoCount = Number(row.PhotoCount) || 0;
    const hasRating = row.GoogleRating !== null && row.GoogleRating !== undefined;

    if (priced < MIN_PRICED_PROCEDURES) clauses.missing_priced_procedures.push(id);
    if (photoCount < MIN_PHOTOS) clauses.missing_photo.push(id);
    if (!hasRating) clauses.missing_google_rating.push(id);

    if (priced >= MIN_PRICED_PROCEDURES && photoCount >= MIN_PHOTOS && hasRating) passing += 1;

    // --- defects, reported independently of the clause counts ---

    const clinicState = toCanonicalState(row.State);
    const googleState = toCanonicalState(row.GoogleState);
    if (clinicState && googleState && clinicState !== googleState) {
      defects.placeid_geo_mismatch.push(id);
    }

    if (isBlank(row.GoogleDataID)) {
      defects.no_google_places_row.push(id);
    } else if (isBlank(row.GooglePhoto)) {
      defects.google_has_no_photo.push(id);
    }

    if (
      row.Latitude !== null && row.Latitude !== undefined &&
      row.Longitude !== null && row.Longitude !== undefined &&
      Number(row.Latitude) === Math.round(Number(row.Latitude)) &&
      Number(row.Longitude) === Math.round(Number(row.Longitude))
    ) {
      defects.whole_degree_coordinates.push(id);
    }

    const zip = isBlank(row.PostalCode) ? null : String(row.PostalCode).trim();
    if (zip && /^\d{5}$/.test(zip) && clinicState && ZIP1_TO_STATES[zip[0]]) {
      if (!ZIP1_TO_STATES[zip[0]].includes(clinicState)) {
        defects.postalcode_not_a_zip.push(id);
      }
    }

    const { kind } = classifyState(row.State);
    if (kind === 'format_variant') defects.state_format_variant.push(id);
    else if (kind === 'malformed') defects.state_malformed.push(id);
    else if (kind === 'null') defects.state_null.push(id);
    else if (kind === 'non_us') defects.state_non_us.push(id);
  }

  const sortNum = a => [...a].sort((x, y) => x - y);
  const section = obj =>
    Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map(k => [k, { count: obj[k].length, clinicIds: sortNum(obj[k]) }])
    );

  return {
    bar: {
      minPricedProcedures: MIN_PRICED_PROCEDURES,
      minPhotos: MIN_PHOTOS,
      requiresGoogleRating: true,
      note: 'Provider clause dropped 2026-10-05.'
    },
    totals: {
      clinics: rows.length,
      passing,
      failing: rows.length - passing
    },
    failingClauses: section(clauses),
    defects: section(defects)
  };
}

function printSummary(report) {
  const { totals } = report;
  const pct = totals.clinics ? ((totals.passing / totals.clinics) * 100).toFixed(1) : '0.0';
  console.log(`\nGlowra data-quality audit`);
  console.log(`  clinics            ${totals.clinics}`);
  console.log(`  PASSING the bar    ${totals.passing}  (${pct}%)`);
  console.log(`  failing            ${totals.failing}`);

  console.log(`\n  Failing clauses (a clinic can fail more than one):`);
  for (const [name, v] of Object.entries(report.failingClauses)) {
    console.log(`    ${name.padEnd(28)} ${String(v.count).padStart(4)}`);
  }

  console.log(`\n  Known data defects (NOT folded into the clause counts):`);
  for (const [name, v] of Object.entries(report.defects)) {
    console.log(`    ${name.padEnd(28)} ${String(v.count).padStart(4)}`);
  }
  console.log('');
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const fixturePath = arg('--fixture');
  const dumpPath = arg('--dump-fixture');
  const jsonPath = arg('--json');
  const noMeta = argv.includes('--no-meta');

  let rows;
  let source;
  if (fixturePath) {
    rows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    source = `fixture:${path.basename(fixturePath)}`;
    console.log(`DRY RUN: reading ${rows.length} rows from ${fixturePath}. No database access.`);
  } else {
    const { db } = require('../db');
    const pool = await db.getConnection();
    const result = await pool.request().query(QUERY);
    rows = result.recordset;
    source = 'database';
    if (dumpPath) {
      fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
      fs.writeFileSync(dumpPath, JSON.stringify(rows, null, 2) + '\n');
      console.log(`Fixture written to ${dumpPath} (${rows.length} rows).`);
    }
  }

  const report = buildReport(rows);
  printSummary(report);

  if (jsonPath) {
    // meta is kept OUT of the diffable body on purpose: a timestamp in the
    // body would make every run diff against every other run.
    const payload = noMeta ? report : { meta: { generatedAt: new Date().toISOString(), source }, ...report };
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
    console.log(`Report written to ${jsonPath}`);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { buildReport, ZIP1_TO_STATES, QUERY };
