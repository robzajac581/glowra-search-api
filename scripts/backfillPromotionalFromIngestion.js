#!/usr/bin/env node
/**
 * GLO-72 — backfill Procedures.IsPromotional for ClinicIDs 623-629 ONLY.
 *
 * ## Why the scope is hard-coded and not a parameter
 *
 * ClinicIDs 623-629 are the seven clinics pushed on 2026-10-02 from extraction
 * data. For every one of their procedures there is a source URL and a verified
 * verbatim evidence quote that the extractor judged the promotional wording
 * from. Those assessments are reproduced in
 * scripts/data/glo72PromotionalAssessments.json, quote included, so the claim
 * this script writes into production can be audited without the ingestion
 * database.
 *
 * Every other clinic -- roughly 444 of them -- was loaded before the extractor
 * existed. There is no source page, no quote, and nothing to derive a
 * promotional signal from. Their rows must stay NULL. Writing 0 ("standard
 * rate") for them would publish a false claim on a price-comparison
 * marketplace, which is worse than publishing no claim at all, because a badge
 * that says "standard rate" is believed while a missing badge is merely
 * uninformative.
 *
 * So the clinic range is a constant in this file, asserted against the data
 * file, and re-asserted in the WHERE clause of every UPDATE. There is
 * deliberately no --clinic-id flag: widening this is not a matter of passing a
 * different argument, it needs a re-crawl, and that is separate work.
 *
 * ## Matching
 *
 * Rows are matched on (ClinicID, ProcedureName). stages/push.js sends
 * extracted_procedures.raw_name truncated to 255 chars as ProcedureName, and
 * within these seven clinics raw_name is unique per clinic (verified: zero
 * duplicate names across all 253 rows), so the match is 1:1. A name that does
 * not match anything in prod is reported, not guessed at.
 *
 * ## Cost and load
 *
 * Azure SQL Basic, 5 DTU. This reads one narrow row set per clinic (ClinicID,
 * ProcedureID, ProcedureName) and issues one parameterised UPDATE per matched
 * procedure inside a transaction per clinic. No joins, no table scans, no
 * Google Places, no model calls. Expected cost: $0.00.
 *
 * ## Usage
 *
 *   node scripts/backfillPromotionalFromIngestion.js            # dry run (default)
 *   node scripts/backfillPromotionalFromIngestion.js --apply    # write
 *
 * Dry run is the default deliberately: .env points at production.
 *
 * ## Reversal
 *
 *   UPDATE Procedures SET IsPromotional = NULL WHERE ClinicID BETWEEN 623 AND 629;
 *
 * which restores the pre-backfill state exactly, because every row in that
 * range was NULL before this script ran (the column is added with no default).
 */

const path = require('path');
const { sql, db } = require('../db');

/** The only clinics this script may ever touch. Not configurable — see header. */
const MIN_CLINIC_ID = 623;
const MAX_CLINIC_ID = 629;

const DATA_FILE = path.join(__dirname, 'data', 'glo72PromotionalAssessments.json');

/**
 * The query that produced the data file, kept here so it can be regenerated:
 *
 *   sqlite3 -json glowra-ingestion/data/ingestion.db "
 *     SELECT pc.clinic_id AS clinicId,
 *            substr(e.raw_name,1,255) AS procedureName,
 *            CASE WHEN e.is_promotional = 1 THEN 1 ELSE 0 END AS isPromotional,
 *            e.evidence_quote AS evidenceQuote,
 *            e.source_url AS sourceUrl
 *     FROM pushed_clinics pc
 *     JOIN extracted_procedures e ON e.place_id = pc.place_id
 *     WHERE pc.clinic_id BETWEEN 623 AND 629
 *       AND e.quote_verified = 1
 *       AND (e.price_unit IS NULL OR e.price_unit <> '/month')
 *     ORDER BY pc.clinic_id, e.raw_name;"
 *
 * The quote_verified and /month predicates mirror stages/push.js exactly, so
 * the set here is the set that was pushed — no more, no less.
 */

function loadAssessments() {
  const data = require(DATA_FILE);
  const rows = data.rows || [];

  // Fail closed rather than trusting the file's own _scope string.
  const outOfScope = rows.filter(
    (r) => !Number.isInteger(r.clinicId) || r.clinicId < MIN_CLINIC_ID || r.clinicId > MAX_CLINIC_ID
  );
  if (outOfScope.length) {
    throw new Error(
      `Data file contains ${outOfScope.length} row(s) outside ClinicIDs ${MIN_CLINIC_ID}-${MAX_CLINIC_ID} ` +
        `(first: clinic ${outOfScope[0].clinicId}). Refusing to run.`
    );
  }
  if (!rows.length) {
    throw new Error(`No rows in ${DATA_FILE}`);
  }
  return rows;
}

/**
 * Fallback match key.
 *
 * Exact ProcedureName matching leaves four clinic-628 rows unmatched, all of
 * them CO2 laser procedures: the extractor captured the page's typographic
 * "CO₂" (U+2082 SUBSCRIPT TWO) while prod stored "CO2". Something on the push
 * path flattened the subscript; prod is the flattened side, so the assessment
 * has to reach across that one transformation.
 *
 * The normalisation is deliberately narrow -- subscript and superscript digits
 * to ASCII, whitespace collapsed, case folded -- rather than a fuzzy match.
 * A loose match here would attach an evidence-backed claim to the wrong
 * procedure, which is the failure this whole ticket exists to prevent. Any row
 * that still does not match is reported and left NULL, never guessed at.
 */
const SUB_SUP_DIGITS = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'
};

function fallbackKey(name) {
  return String(name)
    .replace(/[₀-₉⁰-⁹]/g, (ch) => SUB_SUP_DIGITS[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Group assessments by clinic, keyed by exact ProcedureName, with a fallback index. */
function byClinic(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.clinicId)) {
      map.set(row.clinicId, { exact: new Map(), fallback: new Map() });
    }
    const entry = map.get(row.clinicId);
    entry.exact.set(row.procedureName, row);

    // Only index a fallback key that is unambiguous within the clinic. If two
    // different procedure names collapse to the same key, neither is matched
    // by fallback -- an ambiguous match is not a match.
    const key = fallbackKey(row.procedureName);
    if (entry.fallback.has(key)) {
      entry.fallback.set(key, null);
    } else {
      entry.fallback.set(key, row);
    }
  }
  return map;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = loadAssessments();
  const grouped = byClinic(rows);

  console.log(
    `GLO-72 backfill — ${rows.length} assessments across ClinicIDs ` +
      `${MIN_CLINIC_ID}-${MAX_CLINIC_ID} (${rows.filter((r) => r.isPromotional).length} promotional).`
  );
  console.log(apply ? 'MODE: APPLY (writing to the configured database)\n' : 'MODE: DRY RUN (no writes)\n');

  const pool = await db.getConnection();

  const {
    proceduresTableHasIsPromotionalColumn
  } = require('../utils/procedureIsPromotionalColumn');
  if (!(await proceduresTableHasIsPromotionalColumn(pool))) {
    console.error(
      'Procedures.IsPromotional does not exist on this database.\n' +
        'Run migrations/addProceduresIsPromotional.sql first.'
    );
    process.exitCode = 1;
    return;
  }

  const totals = { matched: 0, unmatched: 0, updatedTrue: 0, updatedFalse: 0, extraInProd: 0 };

  for (const [clinicId, assessments] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    // Narrow read: three columns, one clinic, indexed on ClinicID.
    const existing = await pool
      .request()
      .input('clinicId', sql.Int, clinicId)
      .query(
        `SELECT ProcedureID, ProcedureName
           FROM Procedures
          WHERE ClinicID = @clinicId`
      );

    const prodRows = existing.recordset;
    const { exact, fallback } = assessments;

    const toUpdate = [];
    const extra = [];
    const usedAssessments = new Set();
    const fallbackMatches = [];

    for (const r of prodRows) {
      let assessment = exact.get(r.ProcedureName);
      let viaFallback = false;

      if (!assessment) {
        const candidate = fallback.get(fallbackKey(r.ProcedureName));
        // null means the key was ambiguous within this clinic.
        if (candidate) {
          assessment = candidate;
          viaFallback = true;
        }
      }

      if (!assessment) {
        extra.push(r);
        continue;
      }

      usedAssessments.add(assessment.procedureName);
      if (viaFallback) {
        fallbackMatches.push({ prod: r.ProcedureName, assessed: assessment.procedureName });
      }
      toUpdate.push({
        procedureId: r.ProcedureID,
        procedureName: r.ProcedureName,
        isPromotional: assessment.isPromotional
      });
    }

    const unmatched = [...exact.keys()].filter((n) => !usedAssessments.has(n));

    totals.matched += toUpdate.length;
    totals.unmatched += unmatched.length;
    totals.extraInProd += extra.length;
    totals.updatedTrue += toUpdate.filter((r) => r.isPromotional).length;
    totals.updatedFalse += toUpdate.filter((r) => !r.isPromotional).length;

    console.log(
      `Clinic ${clinicId}: ${prodRows.length} procedures in prod, ` +
        `${exact.size} assessed, ${toUpdate.length} matched ` +
        `(${toUpdate.filter((r) => r.isPromotional).length} promotional)`
    );
    for (const m of fallbackMatches) {
      console.log(
        `  ~ matched after normalising sub/superscript digits: ` +
          `prod ${JSON.stringify(m.prod)} <- assessed ${JSON.stringify(m.assessed)}`
      );
    }
    for (const name of unmatched) {
      console.log(`  ! assessed but not found in prod: ${JSON.stringify(name)}`);
    }
    for (const r of extra) {
      // Left NULL on purpose: a prod row with no assessment is unassessed.
      console.log(`  - in prod but not assessed, left NULL: ${JSON.stringify(r.ProcedureName)}`);
    }
    for (const r of toUpdate.filter((x) => x.isPromotional)) {
      console.log(`  * promotional: ${JSON.stringify(r.procedureName)}`);
    }

    if (!apply || !toUpdate.length) continue;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const r of toUpdate) {
        await new sql.Request(transaction)
          .input('procedureId', sql.Int, r.procedureId)
          .input('clinicId', sql.Int, clinicId)
          .input('isPromotional', sql.Bit, r.isPromotional)
          // ClinicID is re-asserted here, and the literal range is re-asserted
          // again, so even a corrupted ProcedureID cannot write outside scope.
          .query(
            `UPDATE Procedures
                SET IsPromotional = @isPromotional
              WHERE ProcedureID = @procedureId
                AND ClinicID = @clinicId
                AND ClinicID BETWEEN ${MIN_CLINIC_ID} AND ${MAX_CLINIC_ID}`
          );
      }
      await transaction.commit();
      console.log(`  committed ${toUpdate.length} updates for clinic ${clinicId}`);
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  console.log('\n--- Summary ---');
  console.log(totals);
  console.log(
    apply
      ? '\nApplied. Everything outside 623-629 is untouched and still NULL.'
      : '\nDry run only. Re-run with --apply to write.'
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.close();
    } catch {
      /* ignore */
    }
  });
