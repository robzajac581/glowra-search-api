/**
 * Clean junk values out of Procedures.PriceUnit / DraftProcedures.PriceUnit.
 *
 * GLO-69. The write paths accepted free text for the price unit, so the column
 * holds two kinds of bad value:
 *
 *   1. Real units that were simply missing from the enum (/procedure, /package,
 *      /cycle, /thread, /graft). These are NOT junk -- GLO-69 added them to the
 *      enum, so they need no data change and this script leaves them alone.
 *   2. Junk, where a price leaked into the unit column: '/650', '/6.25',
 *      '/2 vials', '/6-session pkg', '/10-30 vials'. ~47 rows.
 *
 * Nulling a junk unit is only safe when the leaked number is already recorded
 * in the row's own price columns -- then the unit is pure duplication and
 * dropping it loses nothing. If the number does NOT appear in AverageCost,
 * PriceMin or PriceMax, the row's price may itself be wrong or missing, and
 * silently nulling the unit would destroy the only surviving copy of that
 * number. Those rows are reported for manual review instead of being changed.
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply.
 *
 * Usage:
 *   node scripts/cleanPriceUnitJunk.js                   # report only
 *   node scripts/cleanPriceUnitJunk.js --csv out.csv     # report + CSV
 *   node scripts/cleanPriceUnitJunk.js --apply           # null the safe rows
 *   node scripts/cleanPriceUnitJunk.js --apply --include-unmatched
 *                                                        # also null rows whose
 *                                                        # number is unaccounted for
 *   node scripts/cleanPriceUnitJunk.js --drafts          # DraftProcedures too
 *
 * Makes no external API calls.
 */

const fs = require('fs');
const { db, sql } = require('../db');
const {
  normalizePriceUnit,
  toCanonicalPriceUnit,
  REJECT_PRICE_LEAK
} = require('../utils/priceUnitNormalizer');
const { proceduresTableHasPriceUnitColumn } = require('../utils/procedurePriceUnitColumn');

function parseArgs(argv) {
  const csvIdx = argv.indexOf('--csv');
  return {
    apply: argv.includes('--apply'),
    includeUnmatched: argv.includes('--include-unmatched'),
    drafts: argv.includes('--drafts'),
    csv: csvIdx >= 0 && argv[csvIdx + 1] ? argv[csvIdx + 1] : null
  };
}

/** Every number appearing in a junk unit string, e.g. '/10-30 vials' -> [10, 30]. */
function numbersIn(text) {
  const matches = String(text).match(/\d+(?:\.\d+)?/g) || [];
  return matches.map(Number).filter((n) => !Number.isNaN(n));
}

/**
 * Whether the numbers in the junk unit are already accounted for by the row's
 * price columns, making the unit safe to drop.
 */
function numbersAccountedFor(unit, row) {
  const nums = numbersIn(unit);
  if (nums.length === 0) return true; // no number to lose, e.g. '/banana'

  const prices = [row.AverageCost, row.PriceMin, row.PriceMax]
    .filter((v) => v != null)
    .map(Number)
    .filter((n) => !Number.isNaN(n));

  // Half a cent: enough to absorb float noise from parsing DECIMAL(10,2), but
  // tighter than a cent, so 6.25 and 6.26 are correctly treated as different
  // prices rather than a match.
  return nums.every((n) => prices.some((p) => Math.abs(p - n) < 0.005));
}

function classify(row) {
  const raw = row.PriceUnit;
  const result = normalizePriceUnit(raw);

  if (result.ok) {
    const canonical = toCanonicalPriceUnit(raw);
    // Already canonical (including the five units GLO-69 added) -- or an
    // accepted alias that would be rewritten to its canonical spelling.
    const needsRewrite = canonical !== '' && canonical !== String(raw).trim();
    return {
      action: needsRewrite ? 'rewrite' : 'keep',
      newValue: needsRewrite ? canonical : raw,
      note: needsRewrite ? `alias -> ${canonical}` : 'already canonical'
    };
  }

  const accounted = numbersAccountedFor(raw, row);
  if (result.reason === REJECT_PRICE_LEAK && !accounted) {
    return {
      action: 'review',
      newValue: null,
      note: 'price leak whose number is NOT in AverageCost/PriceMin/PriceMax -- may be the only copy'
    };
  }

  return {
    action: 'null',
    newValue: null,
    note: result.reason === REJECT_PRICE_LEAK ? 'price leak, number already in price columns' : 'unrecognised unit'
  };
}

async function loadRows(pool, table) {
  const priceCols =
    table === 'Procedures'
      ? 'p.AverageCost, CAST(NULL AS DECIMAL(10,2)) AS PriceMin, CAST(NULL AS DECIMAL(10,2)) AS PriceMax'
      : 'p.AverageCost, p.PriceMin, p.PriceMax';
  const idCol = table === 'Procedures' ? 'p.ProcedureID' : 'p.DraftProcedureID';

  const result = await pool.request().query(`
    SELECT ${idCol} AS ID, p.ProcedureName, p.PriceUnit, ${priceCols}
    FROM ${table} p
    WHERE p.PriceUnit IS NOT NULL AND LTRIM(RTRIM(p.PriceUnit)) <> ''
  `);
  return result.recordset;
}

async function run() {
  const { apply, includeUnmatched, drafts, csv } = parseArgs(process.argv.slice(2));
  const pool = await db.getPool();

  const tables = ['Procedures'];
  if (drafts) tables.push('DraftProcedures');

  if (!(await proceduresTableHasPriceUnitColumn(pool))) {
    console.log('Procedures.PriceUnit does not exist on this database -- nothing to do.');
    return;
  }

  const csvLines = ['table,id,procedureName,priceUnit,action,newValue,note'];
  let totals = { keep: 0, rewrite: 0, null: 0, review: 0 };

  for (const table of tables) {
    const rows = await loadRows(pool, table);
    const byAction = { keep: [], rewrite: [], null: [], review: [] };

    for (const row of rows) {
      const verdict = classify(row);
      byAction[verdict.action].push({ row, verdict });
      totals[verdict.action] += 1;
      if (verdict.action !== 'keep') {
        csvLines.push(
          [table, row.ID, JSON.stringify(row.ProcedureName || ''), JSON.stringify(row.PriceUnit),
           verdict.action, JSON.stringify(verdict.newValue), JSON.stringify(verdict.note)].join(',')
        );
      }
    }

    console.log(`\n=== ${table}: ${rows.length} rows with a non-blank PriceUnit ===`);
    console.log(`  keep (already canonical): ${byAction.keep.length}`);
    console.log(`  rewrite (alias):          ${byAction.rewrite.length}`);
    console.log(`  null (junk, safe):        ${byAction.null.length}`);
    console.log(`  review (junk, unsafe):    ${byAction.review.length}`);

    for (const action of ['rewrite', 'null', 'review']) {
      if (!byAction[action].length) continue;
      console.log(`\n  -- ${action} --`);
      for (const { row, verdict } of byAction[action]) {
        console.log(
          `  [${row.ID}] ${String(row.ProcedureName || '').slice(0, 40).padEnd(40)} ` +
          `${JSON.stringify(row.PriceUnit).padEnd(18)} -> ${JSON.stringify(verdict.newValue).padEnd(12)} ` +
          `avg=${row.AverageCost ?? '-'} min=${row.PriceMin ?? '-'} max=${row.PriceMax ?? '-'}  ${verdict.note}`
        );
      }
    }

    if (!apply) continue;

    const toChange = [
      ...byAction.rewrite,
      ...byAction.null,
      ...(includeUnmatched ? byAction.review : [])
    ];

    if (!toChange.length) {
      console.log(`\n  nothing to apply for ${table}`);
      continue;
    }

    const idCol = table === 'Procedures' ? 'ProcedureID' : 'DraftProcedureID';
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const { row, verdict } of toChange) {
        await transaction
          .request()
          .input('id', sql.Int, row.ID)
          .input('unit', sql.NVarChar(50), verdict.newValue)
          .query(`UPDATE ${table} SET PriceUnit = @unit WHERE ${idCol} = @id`);
      }
      await transaction.commit();
      console.log(`\n  APPLIED: ${toChange.length} rows updated in ${table}`);
    } catch (error) {
      await transaction.rollback();
      console.error(`\n  ROLLED BACK ${table}:`, error.message);
      throw error;
    }
  }

  if (csv) {
    fs.writeFileSync(csv, csvLines.join('\n'));
    console.log(`\nCSV written to ${csv}`);
  }

  console.log('\n=== totals ===');
  console.log(totals);
  if (!apply) {
    console.log('\nDRY RUN -- nothing was written. Re-run with --apply to change data.');
    if (totals.review > 0) {
      console.log(
        `${totals.review} row(s) need a human decision first: the leaked number is not in the price\n` +
        'columns, so nulling the unit would lose it. Review the list above (or the CSV), fix the\n' +
        'price columns, then re-run. --include-unmatched nulls them anyway if you accept that.'
      );
    }
  }
}

// Exported so test/ can exercise the classification without a database.
module.exports = { classify, numbersIn, numbersAccountedFor };

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Failed:', error);
      process.exit(1);
    });
}
