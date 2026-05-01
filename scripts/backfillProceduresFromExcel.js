#!/usr/bin/env node
/**
 * Backfill dbo.Procedures.PriceUnit (and optionally AverageCost) from a Glowra import workbook
 * (same shape as bulk import: sheets Clinics, Procedures, Google Places).
 *
 * Procedures sheet columns expected:
 *   ClinicName, ProcedureName, GlowraCategory, MinPrice, MaxPrice, Unit, AvgPrice
 *
 * Matching:
 *   1) Clinics.PlaceID = Google Places.place_id (keyed by ClinicName+City+State)
 *   2) Else Clinics by ClinicName + City + State (from Clinics sheet row(s) with that name)
 *
 * Procedure row: exact trim on ProcedureName, GlowraCategory resolved to dbo.Categories.Category.
 *
 * Usage:
 *   node scripts/backfillProceduresFromExcel.js "/path/to/New_Clinics_Only V15 (1).xlsx" --dry-run
 *   node scripts/backfillProceduresFromExcel.js "/path/to/file.xlsx" --apply
 *   node scripts/backfillProceduresFromExcel.js "/path/to/file.xlsx" --apply --update-prices
 *
 * Options:
 *   --dry-run          Print planned updates only (default if neither --apply nor --dry-run)
 *   --apply            Execute UPDATEs
 *   --update-prices    Set AverageCost from AvgPrice when a match is found
 *   --limit N          Process only first N procedure rows (testing)
 */

const fs = require('fs');
const XLSX = require('xlsx');
require('dotenv').config();
const { db, sql } = require('../db');

function normKey(s) {
  if (s == null || s === '') return '';
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tripKey(name, city, state) {
  return `${normKey(name)}|${normKey(city)}|${normKey(state)}`;
}

/** Map spreadsheet unit (e.g. "treatment", "/unit") to API PriceUnit string */
function excelUnitToPriceUnit(unit) {
  if (unit == null || String(unit).trim() === '') return null;
  let u = String(unit).trim().toLowerCase();
  if (!u.startsWith('/')) u = `/${u}`;
  return u;
}

function parseArgs(argv) {
  const file = argv.find((a) => !a.startsWith('--'));
  const apply = argv.includes('--apply') && !argv.includes('--dry-run');
  const updatePrices = argv.includes('--update-prices');
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : null;
  return { file, apply, updatePrices, limit };
}

function buildPlaceIdByTrip(workbook) {
  const sh = workbook.Sheets['Google Places'];
  if (!sh) return new Map();
  const rows = XLSX.utils.sheet_to_json(sh, { defval: '' });
  const map = new Map();
  for (const r of rows) {
    const pid = r.place_id || r.placeid || r.PlaceID;
    if (!pid) continue;
    const k = tripKey(r.ClinicName, r.City, r.State);
    if (!map.has(k)) map.set(k, String(pid).trim());
  }
  return map;
}

/** For each clinic name, list of { city, state } from Clinics sheet */
function buildNameToLocations(workbook) {
  const sh = workbook.Sheets.Clinics;
  if (!sh) return new Map();
  const rows = XLSX.utils.sheet_to_json(sh, { defval: '' });
  const byName = new Map();
  for (const r of rows) {
    const n = normKey(r.ClinicName);
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push({
      city: r.City != null ? String(r.City) : '',
      state: r.State != null ? String(r.State) : ''
    });
  }
  return byName;
}

async function loadCategoryCanonicalByNorm(pool) {
  const r = await pool.request().query('SELECT Category FROM Categories');
  const m = new Map();
  for (const row of r.recordset) {
    m.set(normKey(row.Category), row.Category);
  }
  return m;
}

function resolveExcelCategory(raw, canonicalByNorm) {
  const n = normKey(raw);
  if (canonicalByNorm.has(n)) return canonicalByNorm.get(n);
  if (n === 'injectables' && canonicalByNorm.has(normKey('Injectibles')))
    return canonicalByNorm.get(normKey('Injectibles'));
  if (n === 'injectibles' && canonicalByNorm.has(normKey('Injectables')))
    return canonicalByNorm.get(normKey('Injectables'));
  return null;
}

async function resolveClinicId(pool, { placeId, clinicName, city, state }) {
  if (placeId) {
    const r = await pool.request().input('pid', sql.NVarChar(500), placeId).query(`
      SELECT ClinicID FROM Clinics WHERE PlaceID = @pid
    `);
    if (r.recordset.length === 1) return r.recordset[0].ClinicID;
  }

  const r2 = await pool
    .request()
    .input('n', sql.NVarChar(255), String(clinicName || '').trim())
    .input('city', sql.NVarChar(100), String(city || '').trim())
    .input('state', sql.NVarChar(100), String(state || '').trim())
    .query(`
      SELECT ClinicID FROM Clinics
      WHERE LOWER(LTRIM(RTRIM(ClinicName))) = LOWER(LTRIM(RTRIM(@n)))
        AND LOWER(LTRIM(RTRIM(ISNULL(City, '')))) = LOWER(LTRIM(RTRIM(@city)))
        AND LOWER(LTRIM(RTRIM(ISNULL(State, '')))) = LOWER(LTRIM(RTRIM(@state)))
    `);
  if (r2.recordset.length === 1) return r2.recordset[0].ClinicID;
  return null;
}

async function findProcedureIds(pool, clinicId, procedureName, categoryCanonical) {
  const r = await pool
    .request()
    .input('clinicId', sql.Int, clinicId)
    .input('procName', sql.NVarChar(255), String(procedureName || '').trim())
    .input('cat', sql.NVarChar(255), categoryCanonical)
    .query(`
      SELECT p.ProcedureID
      FROM Procedures p
      INNER JOIN Providers pr ON pr.ProviderID = p.ProviderID
      INNER JOIN Categories c ON c.CategoryID = p.CategoryID
      WHERE pr.ClinicID = @clinicId
        AND LTRIM(RTRIM(p.ProcedureName)) = LTRIM(RTRIM(@procName))
        AND c.Category = @cat
    `);
  return r.recordset.map((x) => x.ProcedureID);
}

async function run() {
  const argv = process.argv.slice(2);
  const { file, apply, updatePrices, limit } = parseArgs(argv);

  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node scripts/backfillProceduresFromExcel.js "<path.xlsx>" [--apply] [--dry-run] [--update-prices] [--limit N]');
    process.exit(1);
  }

  const workbook = XLSX.readFile(file);
  if (!workbook.SheetNames.includes('Procedures')) {
    console.error('Workbook missing "Procedures" sheet.');
    process.exit(1);
  }

  const placeByTrip = buildPlaceIdByTrip(workbook);
  const nameToLocs = buildNameToLocations(workbook);
  const procRows = XLSX.utils.sheet_to_json(workbook.Sheets.Procedures, { defval: '' });

  const pool = await db.getConnection();
  if (!pool) {
    console.error('Database connection failed');
    process.exit(1);
  }

  const categoryByNorm = await loadCategoryCanonicalByNorm(pool);

  let planned = 0;
  let updated = 0;
  let skippedNoClinic = 0;
  let skippedNoCategory = 0;
  let skippedNoProcedure = 0;
  let skippedNoUnitNoPrice = 0;
  const ambiguousClinic = [];

  const queue = [];

  const rowsToProcess = limit ? procRows.slice(0, limit) : procRows;

  for (const row of rowsToProcess) {
    const clinicName = row.ClinicName;
    const procedureName = row.ProcedureName;
    const glowCat = row.GlowraCategory != null && row.GlowraCategory !== '' ? row.GlowraCategory : row.Category;
    const unit = excelUnitToPriceUnit(row.Unit);
    const avgPrice = row.AvgPrice;
    const hasPrice =
      avgPrice != null &&
      avgPrice !== '' &&
      !Number.isNaN(parseFloat(avgPrice));

    if (!unit && !updatePrices) {
      skippedNoUnitNoPrice++;
      continue;
    }
    if (!unit && updatePrices && !hasPrice) {
      skippedNoUnitNoPrice++;
      continue;
    }

    const catCanon = resolveExcelCategory(glowCat, categoryByNorm);
    if (!catCanon) {
      skippedNoCategory++;
      continue;
    }

    const nk = normKey(clinicName);
    const locs = nameToLocs.get(nk) || [];
    const candidates = [];

    for (const loc of locs) {
      const tk = tripKey(clinicName, loc.city, loc.state);
      const pid = placeByTrip.get(tk) || null;
      candidates.push({ placeId: pid, city: loc.city, state: loc.state });
    }

    const clinicIds = new Set();

    if (candidates.length === 0) {
      const rName = await pool
        .request()
        .input('n', sql.NVarChar(255), String(clinicName || '').trim())
        .query(`
          SELECT ClinicID FROM Clinics
          WHERE LOWER(LTRIM(RTRIM(ClinicName))) = LOWER(LTRIM(RTRIM(@n)))
        `);
      if (rName.recordset.length === 1) {
        clinicIds.add(rName.recordset[0].ClinicID);
      } else if (rName.recordset.length > 1) {
        ambiguousClinic.push({ clinicName, reason: 'name-only-multiple', count: rName.recordset.length });
        continue;
      } else {
        skippedNoClinic++;
        continue;
      }
    } else {
      for (const c of candidates) {
        const id = await resolveClinicId(pool, {
          placeId: c.placeId,
          clinicName,
          city: c.city,
          state: c.state
        });
        if (id != null) clinicIds.add(id);
      }
    }

    if (clinicIds.size === 0) {
      skippedNoClinic++;
      continue;
    }
    if (clinicIds.size > 1) {
      ambiguousClinic.push({ clinicName, clinicIds: [...clinicIds] });
      continue;
    }

    const clinicId = [...clinicIds][0];
    const procIds = await findProcedureIds(pool, clinicId, procedureName, catCanon);
    if (procIds.length === 0) {
      skippedNoProcedure++;
      continue;
    }

    const priceUnitSql = unit;
    const avgVal = hasPrice ? parseFloat(avgPrice) : null;

    for (const procedureId of procIds) {
      queue.push({ procedureId, priceUnitSql, avgVal, clinicName, procedureName, catCanon });
      planned++;
    }
  }

  console.log('\n--- Summary (before writes) ---');
  console.log({
    excelProcedureRows: rowsToProcess.length,
    plannedRowUpdates: planned,
    skippedNoUnitNoPrice: skippedNoUnitNoPrice,
    skippedNoCategory,
    skippedNoProcedure,
    skippedNoClinic,
    ambiguousClinicCount: ambiguousClinic.length,
    updatePrices,
    mode: apply ? 'APPLY' : 'DRY-RUN'
  });

  if (ambiguousClinic.length) {
    console.log('\nAmbiguous clinic resolution (same name, multiple DB clinics matched):');
    console.log(ambiguousClinic.slice(0, 15));
    if (ambiguousClinic.length > 15) console.log(`... and ${ambiguousClinic.length - 15} more`);
  }

  if (!apply) {
    console.log('\nSample queue (first 12):');
    console.table(queue.slice(0, 12).map((q) => ({
      procedureId: q.procedureId,
      clinic: q.clinicName,
      proc: q.procedureName,
      category: q.catCanon,
      priceUnit: q.priceUnitSql,
      avg: q.avgVal
    })));
    console.log('\nRe-run with --apply to execute UPDATEs.');
    await pool.close();
    return;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const item of queue) {
      const req = new sql.Request(transaction);
      req.input('procedureId', sql.Int, item.procedureId);
      if (item.priceUnitSql) {
        req.input('priceUnit', sql.NVarChar(50), item.priceUnitSql);
      }
      if (updatePrices && item.avgVal != null && !Number.isNaN(item.avgVal)) {
        req.input('avg', sql.Decimal(10, 2), item.avgVal);
      }

      if (item.priceUnitSql && updatePrices && item.avgVal != null && !Number.isNaN(item.avgVal)) {
        await req.query(`
          UPDATE Procedures
          SET PriceUnit = @priceUnit, AverageCost = @avg
          WHERE ProcedureID = @procedureId
        `);
      } else if (item.priceUnitSql) {
        await req.query(`
          UPDATE Procedures
          SET PriceUnit = @priceUnit
          WHERE ProcedureID = @procedureId
        `);
      } else if (updatePrices && item.avgVal != null && !Number.isNaN(item.avgVal)) {
        await req.query(`
          UPDATE Procedures
          SET AverageCost = @avg
          WHERE ProcedureID = @procedureId
        `);
      }
      updated++;
    }
    await transaction.commit();
    console.log(`\nCommitted ${updated} procedure UPDATE(s).`);
  } catch (e) {
    await transaction.rollback();
    console.error('Rolled back:', e);
    process.exitCode = 1;
  } finally {
    await pool.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
