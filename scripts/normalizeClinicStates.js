#!/usr/bin/env node
/**
 * GLO-76: normalise Clinics.State to canonical two-letter USPS codes.
 *
 * The canonical format and the reasoning behind it live in
 * utils/stateNormalizer.js. This script only applies it to existing rows.
 *
 * Usage:
 *   node scripts/normalizeClinicStates.js                 # simulate, write plan, change nothing
 *   node scripts/normalizeClinicStates.js --apply         # back up, re-simulate, apply in a transaction
 *   node scripts/normalizeClinicStates.js --plan <file>   # write/read the plan at a given path
 *   node scripts/normalizeClinicStates.js --rollback      # restore State from the backup table
 *
 * --apply refuses to run unless a plan file from a prior simulation exists and
 * the live rows still match it exactly. See assertPlanStillHolds().
 *
 * ---------------------------------------------------------------------------
 * THREE CASES, HANDLED SEPARATELY
 * ---------------------------------------------------------------------------
 *
 * 1. FORMAT VARIANTS ('Florida' -> 'FL'). Mechanical and safe. Resolved by
 *    toCanonicalState(), which does not guess.
 *
 * 2. MALFORMED ('Columbia SC'). A judgement call, listed explicitly below in
 *    MALFORMED_DECISIONS with the evidence, never inferred at runtime.
 *
 * 3. NULLs. NOT invented. Derived only from the two independent geographic
 *    sources already in the database -- GooglePlacesData.State and
 *    Locations.State -- and only when every non-null source agrees on one US
 *    state. See deriveFromSources().
 *
 * ---------------------------------------------------------------------------
 * WHY NOT PostalCode
 * ---------------------------------------------------------------------------
 * Clinics.PostalCode is NOT a reliable ZIP for the NULL-state rows and MUST
 * NOT be used to derive a state. Verified 2026-10-05:
 *
 *   ClinicID 2   Synergy Plastic Surgery   Austin, TX      PostalCode '11200'
 *   ClinicID 15  Sean Younai MD            Encino, CA      PostalCode '16055'
 *   ClinicID 76  Omaha Face                Elkhorn, NE     PostalCode '17838'
 *   ClinicID 100 Richmond Aesthetic Surgery Richmond, VA   PostalCode '11934'
 *
 * Read as ZIP prefixes those are NY, PA, PA and NY respectively. Deriving the
 * state from PostalCode would have moved four clinics to the wrong side of the
 * country. The bad PostalCode values are a separate defect (see the audit's
 * `postalcode_not_a_zip` line); this script leaves PostalCode untouched.
 */

process.env.DISABLE_SCHEDULED_JOBS = 'true';

const fs = require('fs');
const path = require('path');
const { db, sql } = require('../db');
const { toCanonicalState, classifyState } = require('../utils/stateNormalizer');

const BACKUP_TABLE = 'Clinics_GLO76_StateBackup';
const DEFAULT_PLAN = path.join(__dirname, 'data', 'glo76-state-plan.json');

/**
 * Judgement calls on malformed values. Each one is written down with its
 * evidence rather than being derived by a heuristic, so a reviewer can
 * disagree with a specific row instead of auditing a regex.
 */
const MALFORMED_DECISIONS = {
  95: {
    from: 'Columbia SC',
    to: 'SC',
    reason:
      "City+state crammed into State. Address '700 Gervais St' and PostalCode " +
      "'29201' are both Columbia, South Carolina, and Locations.State is " +
      "'South Carolina'. GooglePlacesData says 'Michigan' / 'West Bloomfield " +
      "Township', which is a wrong-PlaceID defect in its own right (reported " +
      'separately by the audit as placeid_geo_mismatch), not evidence about ' +
      'this clinic. Clinics.City is also wrong (\'STE 150\') but is out of ' +
      'scope for this ticket.'
  }
};

/** Clinic IDs we deliberately leave alone, with the reason. */
function passthroughReason(kind) {
  if (kind === 'non_us') {
    return 'Non-US clinic; State holds the ISO country code. Not a US state and not a format defect.';
  }
  return null;
}

/**
 * Derive a state for a NULL row from the two independent geographic sources
 * already stored alongside the clinic.
 *
 * Rule: every non-null source must resolve to the same US state. One
 * dissenting source makes the row ambiguous and it stays NULL.
 *
 * This is not an invention. app.js and
 * clinic-management/routes/adminRoutes.js:215 already serve
 * COALESCE(c.State, g.State, l.State) to the frontend, and
 * utils/addressUtils.js:135 does the same in mergeAddressForResponse -- so the
 * value written here is the value production already displays for these
 * clinics. The migration materialises it so that exact-match consumers like
 * glowra-FE's NEARBY_STATES filter can see it too.
 */
function deriveFromSources(row) {
  const candidates = [
    { source: 'GooglePlacesData.State', value: row.gState },
    { source: 'Locations.State', value: row.lState }
  ].filter(c => c.value !== null && c.value !== undefined && String(c.value).trim() !== '');

  if (candidates.length === 0) {
    return { to: null, reason: 'No GooglePlacesData or Locations row to derive from.' };
  }

  const resolved = candidates.map(c => ({ ...c, canonical: toCanonicalState(c.value) }));
  const unresolved = resolved.filter(r => r.canonical === null);
  if (unresolved.length > 0) {
    return {
      to: null,
      reason:
        'Ambiguous: ' +
        unresolved.map(u => `${u.source}='${u.value}' is not a recognised state`).join('; ')
    };
  }

  const distinct = [...new Set(resolved.map(r => r.canonical))];
  if (distinct.length > 1) {
    return {
      to: null,
      reason:
        'Sources disagree: ' + resolved.map(r => `${r.source}=${r.canonical}`).join(', ')
    };
  }

  if (!/^[A-Z]{2}$/.test(distinct[0]) || distinct[0] === 'TR') {
    return { to: null, reason: `Sources agree on a non-US value (${distinct[0]}); not inventing a US state.` };
  }

  return {
    to: distinct[0],
    reason: `Unanimous across ${resolved.length} source(s): ` +
      resolved.map(r => `${r.source}='${r.value}'`).join(', ')
  };
}

/** One narrow query. No SELECT *; Azure SQL here is Basic / 5 DTU. */
const PLAN_QUERY = `
  SELECT c.ClinicID, c.State, g.State AS gState, l.State AS lState
  FROM Clinics c
  LEFT JOIN GooglePlacesData g ON g.ClinicID = c.ClinicID
  LEFT JOIN Locations l ON l.LocationID = c.LocationID
  ORDER BY c.ClinicID
`;

async function buildPlan(pool) {
  const { recordset } = await pool.request().query(PLAN_QUERY);

  const changes = [];
  const unchanged = { canonical: 0, non_us: 0 };
  const leftNull = [];
  const unclassified = [];

  for (const row of recordset) {
    const { kind, canonical } = classifyState(row.State);

    if (kind === 'canonical') {
      unchanged.canonical += 1;
      continue;
    }

    if (kind === 'non_us') {
      unchanged.non_us += 1;
      unclassified.push({
        clinicId: row.ClinicID,
        value: row.State,
        reason: passthroughReason(kind)
      });
      continue;
    }

    if (kind === 'format_variant') {
      changes.push({ clinicId: row.ClinicID, from: row.State, to: canonical, case: 'format_variant' });
      continue;
    }

    if (kind === 'malformed') {
      const decision = MALFORMED_DECISIONS[row.ClinicID];
      if (decision && decision.from === row.State) {
        changes.push({
          clinicId: row.ClinicID,
          from: row.State,
          to: decision.to,
          case: 'malformed',
          reason: decision.reason
        });
      } else {
        unclassified.push({
          clinicId: row.ClinicID,
          value: row.State,
          reason: 'Malformed and no reviewed decision in MALFORMED_DECISIONS. Left as-is.'
        });
      }
      continue;
    }

    // kind === 'null'
    const derived = deriveFromSources(row);
    if (derived.to) {
      changes.push({
        clinicId: row.ClinicID,
        from: null,
        to: derived.to,
        case: 'null_derived',
        reason: derived.reason
      });
    } else {
      leftNull.push({ clinicId: row.ClinicID, reason: derived.reason });
    }
  }

  changes.sort((a, b) => a.clinicId - b.clinicId);
  leftNull.sort((a, b) => a.clinicId - b.clinicId);
  unclassified.sort((a, b) => a.clinicId - b.clinicId);

  return {
    ticket: 'GLO-76',
    totalRows: recordset.length,
    unchanged,
    counts: {
      format_variant: changes.filter(c => c.case === 'format_variant').length,
      malformed: changes.filter(c => c.case === 'malformed').length,
      null_derived: changes.filter(c => c.case === 'null_derived').length,
      total: changes.length,
      leftNull: leftNull.length,
      unclassified: unclassified.length
    },
    changes,
    leftNull,
    unclassified
  };
}

async function ensureBackup(pool) {
  const exists = await pool
    .request()
    .query(`SELECT OBJECT_ID('dbo.${BACKUP_TABLE}') AS id`);
  if (exists.recordset[0].id) {
    const n = await pool.request().query(`SELECT COUNT(*) AS n FROM ${BACKUP_TABLE}`);
    console.log(`Backup ${BACKUP_TABLE} already exists (${n.recordset[0].n} rows); reusing it.`);
    return;
  }
  // Same pattern as Clinics_GLO73_RatingBackup.
  await pool.request().query(`
    SELECT ClinicID, State, SYSUTCDATETIME() AS BackedUpAt
    INTO ${BACKUP_TABLE}
    FROM Clinics
  `);
  const n = await pool.request().query(`SELECT COUNT(*) AS n FROM ${BACKUP_TABLE}`);
  console.log(`Created ${BACKUP_TABLE} with ${n.recordset[0].n} rows.`);
}

/**
 * Re-simulate against live rows and refuse to proceed unless the result is
 * identical to the saved plan. Guards against the table changing between the
 * review of the plan and the write.
 */
function assertPlanStillHolds(savedPlan, livePlan) {
  const key = p => JSON.stringify(p.changes.map(c => [c.clinicId, c.from, c.to]));
  if (savedPlan.changes.length !== livePlan.changes.length) {
    throw new Error(
      `ABORT: plan has ${savedPlan.changes.length} changes but live simulation produced ` +
        `${livePlan.changes.length}. Re-run the simulation and review before applying.`
    );
  }
  if (key(savedPlan) !== key(livePlan)) {
    throw new Error('ABORT: live rows no longer match the reviewed plan. Re-run the simulation.');
  }
}

async function apply(pool, plan) {
  if (plan.changes.length === 0) {
    console.log('Nothing to apply.');
    return;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    let affected = 0;
    for (const change of plan.changes) {
      const request = new sql.Request(transaction);
      request.input('clinicId', sql.Int, change.clinicId);
      request.input('to', sql.NVarChar(100), change.to);
      // The WHERE clause re-asserts the expected prior value, so a row that
      // changed underneath us updates 0 rows and trips the assertion below.
      let where;
      if (change.from === null) {
        where = 'State IS NULL';
      } else {
        request.input('from', sql.NVarChar(100), change.from);
        where = 'State = @from';
      }
      const r = await request.query(
        `UPDATE Clinics SET State = @to WHERE ClinicID = @clinicId AND ${where}`
      );
      affected += r.rowsAffected[0];
    }

    if (affected !== plan.changes.length) {
      throw new Error(
        `ABORT: expected to update ${plan.changes.length} rows, actually updated ${affected}. ` +
          'Rolling back; no rows changed.'
      );
    }

    await transaction.commit();
    console.log(`Committed ${affected} row updates.`);
  } catch (err) {
    await transaction.rollback();
    console.error('Rolled back.', err.message);
    throw err;
  }
}

async function rollback(pool) {
  const exists = await pool.request().query(`SELECT OBJECT_ID('dbo.${BACKUP_TABLE}') AS id`);
  if (!exists.recordset[0].id) {
    throw new Error(`No ${BACKUP_TABLE} to roll back from.`);
  }
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const r = await new sql.Request(transaction).query(`
      UPDATE c SET c.State = b.State
      FROM Clinics c JOIN ${BACKUP_TABLE} b ON b.ClinicID = c.ClinicID
      WHERE (c.State IS NULL AND b.State IS NOT NULL)
         OR (c.State IS NOT NULL AND b.State IS NULL)
         OR c.State <> b.State
    `);
    await transaction.commit();
    console.log(`Rollback restored ${r.rowsAffected[0]} rows from ${BACKUP_TABLE}.`);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

function summarise(plan) {
  console.log(`\nGLO-76 state normalisation plan (${plan.totalRows} rows)`);
  console.log(`  already canonical      ${plan.unchanged.canonical}`);
  console.log(`  format variants  ->    ${plan.counts.format_variant}`);
  console.log(`  malformed (reviewed)   ${plan.counts.malformed}`);
  console.log(`  NULL derived           ${plan.counts.null_derived}`);
  console.log(`  TOTAL CHANGES          ${plan.counts.total}`);
  console.log(`  left NULL              ${plan.counts.leftNull}`);
  console.log(`  left as-is (non-US /`);
  console.log(`    unreviewed malformed) ${plan.counts.unclassified}`);
  if (plan.leftNull.length) {
    console.log('\n  Left NULL:');
    for (const r of plan.leftNull) console.log(`    ${r.clinicId}: ${r.reason}`);
  }
  if (plan.unclassified.length) {
    console.log('\n  Left as-is:');
    for (const r of plan.unclassified) console.log(`    ${r.clinicId} '${r.value}': ${r.reason}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const isApply = argv.includes('--apply');
  const isRollback = argv.includes('--rollback');
  const planIdx = argv.indexOf('--plan');
  const planPath = planIdx >= 0 ? argv[planIdx + 1] : DEFAULT_PLAN;

  const pool = await db.getConnection();

  if (isRollback) {
    await rollback(pool);
    return;
  }

  const livePlan = await buildPlan(pool);

  if (!isApply) {
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify(livePlan, null, 2) + '\n');
    summarise(livePlan);
    console.log(`\nSIMULATION ONLY. Nothing written to Clinics.`);
    console.log(`Plan written to ${planPath}`);
    console.log(`Review it, then re-run with --apply.`);
    return;
  }

  if (!fs.existsSync(planPath)) {
    throw new Error(`No plan at ${planPath}. Run without --apply first and review the plan.`);
  }
  const savedPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  assertPlanStillHolds(savedPlan, livePlan);
  console.log(`Plan at ${planPath} still matches live rows (${livePlan.changes.length} changes).`);

  await ensureBackup(pool);
  await apply(pool, livePlan);
  summarise(livePlan);
  console.log(`\nRollback: node scripts/normalizeClinicStates.js --rollback`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { buildPlan, deriveFromSources, MALFORMED_DECISIONS, BACKUP_TABLE };
