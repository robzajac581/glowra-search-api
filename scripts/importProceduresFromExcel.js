#!/usr/bin/env node
/**
 * Import Procedures from Glowra workbook onto existing clinics (ClinicID only; ProviderID NULL).
 * Sheets: Procedures, Clinics, Google Places — same resolution as backfillProceduresFromExcel.js.
 *
 * Usage:
 *   node scripts/importProceduresFromExcel.js "/path/to/file.xlsx"
 *   node scripts/importProceduresFromExcel.js "/path/to/file.xlsx" --apply
 *   node scripts/importProceduresFromExcel.js "/path/to/file.xlsx" --apply --limit 50
 *
 * Optional: IMPORT_DISABLE_PROCEDURE_TRIGGERS=1 node ... --apply
 *   Disables ALL triggers on dbo.Procedures for the apply batch, then re-enables them.
 *   Use only if an INSTEAD OF / AFTER INSERT trigger is rewriting rows and causing bogus FK errors.
 *
 * Requires migrations/addClinicIdToProcedures.sql applied (Procedures.ClinicID NOT NULL).
 */

const fs = require('fs');
const XLSX = require('xlsx');
require('dotenv').config();
const { db, sql } = require('../db');
const { proceduresTableHasPriceUnitColumn } = require('../utils/procedurePriceUnitColumn');
const { loadProceduresClinicFkMeta } = require('../utils/proceduresClinicFkShape');

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

function excelUnitToPriceUnit(unit) {
  if (unit == null || String(unit).trim() === '') return null;
  let u = String(unit).trim().toLowerCase();
  if (!u.startsWith('/')) u = `/${u}`;
  return u;
}

function parseArgs(argv) {
  const file = argv.find((a) => !a.startsWith('--'));
  const apply = argv.includes('--apply');
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : null;
  return { file, apply, limit };
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
  const r = await pool.request().query('SELECT CategoryID, Category FROM Categories');
  const byNorm = new Map();
  const idByNorm = new Map();
  for (const row of r.recordset) {
    const n = normKey(row.Category);
    byNorm.set(n, row.Category);
    idByNorm.set(n, row.CategoryID);
  }
  return { byNorm, idByNorm };
}

function resolveExcelCategory(raw, byNorm, idByNorm) {
  const n = normKey(raw);
  if (!n) return { canon: null, categoryId: null };
  if (byNorm.has(n)) {
    return { canon: byNorm.get(n), categoryId: idByNorm.get(n) };
  }
  if (n === 'injectables' && byNorm.has(normKey('Injectibles'))) {
    return { canon: byNorm.get(normKey('Injectibles')), categoryId: idByNorm.get(normKey('Injectibles')) };
  }
  if (n === 'injectibles' && byNorm.has(normKey('Injectables'))) {
    return { canon: byNorm.get(normKey('Injectables')), categoryId: idByNorm.get(normKey('Injectables')) };
  }
  return { canon: null, categoryId: null };
}

/** Normalize ClinicID for Set lookups (consistent number type). */
function normalizeClinicId(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  const n = parseInt(String(v).trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function clinicIdFromRow(record) {
  if (!record) return null;
  const v = record.ClinicID ?? record.clinicId ?? record.CLINICID;
  return normalizeClinicId(v);
}

/**
 * If FK references a filtered unique index on dbo.Clinics, some Clinics rows are not referenceable.
 * filter_definition comes from sys.indexes (server metadata only).
 */
function fkReferencedClinicPredicateAnd(filterSql) {
  if (filterSql == null || String(filterSql).trim() === '') return '';
  return ` AND (${String(filterSql).trim()})`;
}

async function warnIfProceduresHasTriggers(pool) {
  const r = await pool.request().query(`
    SELECT name
    FROM sys.triggers
    WHERE parent_id = OBJECT_ID(N'dbo.Procedures')
      AND is_disabled = 0
    ORDER BY name
  `);
  if (r.recordset.length) {
    console.warn(
      '\nWarning: dbo.Procedures has active trigger(s):',
      r.recordset.map((x) => x.name).join(', '),
      '\nIf imports still fail with FK errors after filtered-index handling, inspect those triggers.'
    );
  }
}

async function loadValidClinicIds(pool, fkClinicFilterSql) {
  const extra = fkReferencedClinicPredicateAnd(fkClinicFilterSql);
  const r = await pool.request().query(`
    SELECT c.ClinicID
    FROM dbo.Clinics c
    WHERE c.ClinicID IS NOT NULL${extra}
  `);
  return new Set(r.recordset.map((row) => clinicIdFromRow(row)).filter((id) => id != null));
}

async function resolveClinicId(pool, { placeId, clinicName, city, state }, cache) {
  const key = `${placeId || ''}|${normKey(clinicName)}|${normKey(city)}|${normKey(state)}`;
  if (cache.has(key)) return cache.get(key);

  let resolved = null;
  if (placeId) {
    const r = await pool.request().input('pid', sql.NVarChar(500), placeId).query(`
      SELECT ClinicID FROM Clinics WHERE PlaceID = @pid
    `);
    if (r.recordset.length === 1) resolved = clinicIdFromRow(r.recordset[0]);
  }

  if (resolved == null) {
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
    if (r2.recordset.length === 1) resolved = clinicIdFromRow(r2.recordset[0]);
  }

  cache.set(key, resolved);
  return resolved;
}

async function clinicHasProcedure(
  pool,
  clinicId,
  procedureName,
  categoryId,
  cache,
  legacyLocationIdIsClinicId
) {
  const k = `${clinicId}|${normKey(procedureName)}|${categoryId}|${legacyLocationIdIsClinicId ? 'L' : 'N'}`;
  if (cache.has(k)) return cache.get(k);

  const clinicMatch = legacyLocationIdIsClinicId
    ? '(p.ClinicID = @clinicId OR p.LocationID = @clinicId)'
    : 'p.ClinicID = @clinicId';

  const r = await pool
    .request()
    .input('clinicId', sql.Int, clinicId)
    .input('procName', sql.NVarChar(255), String(procedureName || '').trim())
    .input('catId', sql.Int, categoryId)
    .query(`
      SELECT 1 AS ok FROM Procedures p
      WHERE ${clinicMatch}
        AND p.CategoryID = @catId
        AND LTRIM(RTRIM(p.ProcedureName)) = LTRIM(RTRIM(@procName))
    `);
  const exists = r.recordset.length > 0;
  cache.set(k, exists);
  return exists;
}

/**
 * Int used in dbo (ClinicID / ProcedureID). Validated before embedding in SQL to avoid any driver edge cases with @params in INSERT…SELECT.
 */
function assertSqlInt(name, v) {
  if (!Number.isInteger(v) || v < 1 || v > 2147483647) {
    throw new Error(`${name} must be a positive 32-bit int (got ${v})`);
  }
}

async function insertProcedureRow(
  transaction,
  row,
  hasPriceUnitCol,
  fkClinicFilterSql,
  procedureLocationIdSelectFragment
) {
  const allowedFragments = new Set(['c.ClinicID', 'c.LocationID', 'CAST(NULL AS INT)']);
  if (!allowedFragments.has(procedureLocationIdSelectFragment)) {
    throw new Error(`Invalid procedureLocationIdSelectFragment: ${procedureLocationIdSelectFragment}`);
  }
  const clinicId = normalizeClinicId(row.clinicId);
  if (clinicId == null) {
    throw new Error(`Invalid clinicId on procedure row: ${row.procedureName}`);
  }
  assertSqlInt('clinicId', clinicId);
  assertSqlInt('categoryId', row.categoryId);
  const fkPred = fkReferencedClinicPredicateAnd(fkClinicFilterSql);

  const maxR = await new sql.Request(transaction).query(`
    SELECT ISNULL(MAX(ProcedureID), 0) + 1 AS NextID FROM dbo.Procedures
  `);
  const procedureId = maxR.recordset[0].NextID;
  assertSqlInt('procedureId', procedureId);

  const req = new sql.Request(transaction);
  req.input('procedureID', sql.Int, procedureId);
  req.input('procedureName', sql.NVarChar(255), row.procedureName);
  req.input('categoryID', sql.Int, row.categoryId);
  req.input('averageCost', sql.Decimal(10, 2), row.averageCost ?? null);

  let result;
  if (hasPriceUnitCol) {
    req.input('priceUnit', sql.NVarChar(50), row.priceUnit ?? null);
    result = await req.query(`
      INSERT INTO dbo.Procedures (
        ProcedureID, ClinicID, ProviderID, ProcedureName, CategoryID,
        AverageCost, LocationID, PriceUnit
      )
      SELECT
        @procedureID,
        c.ClinicID,
        NULL,
        @procedureName,
        @categoryID,
        @averageCost,
        ${procedureLocationIdSelectFragment},
        @priceUnit
      FROM dbo.Clinics AS c WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
      WHERE c.ClinicID = ${clinicId}${fkPred}
    `);
  } else {
    result = await req.query(`
      INSERT INTO dbo.Procedures (
        ProcedureID, ClinicID, ProviderID, ProcedureName, CategoryID,
        AverageCost, LocationID
      )
      SELECT
        @procedureID,
        c.ClinicID,
        NULL,
        @procedureName,
        @categoryID,
        @averageCost,
        ${procedureLocationIdSelectFragment}
      FROM dbo.Clinics AS c WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
      WHERE c.ClinicID = ${clinicId}${fkPred}
    `);
  }

  const raw = result.rowsAffected;
  const inserted = Array.isArray(raw) ? raw.reduce((a, b) => a + b, 0) : raw || 0;
  if (inserted !== 1) {
    const extra =
      fkClinicFilterSql != null && String(fkClinicFilterSql).trim() !== ''
        ? ' (clinic row may exist but not satisfy FK referenced index filter)'
        : '';
    throw new Error(
      `Procedure insert affected ${inserted} row(s) (expected 1). ClinicID=${clinicId} not eligible for INSERT (no matching dbo.Clinics row for this FK)${extra}. procedure=${row.procedureName}`
    );
  }
}

async function run() {
  const argv = process.argv.slice(2);
  const { file, apply, limit } = parseArgs(argv);

  if (!file || !fs.existsSync(file)) {
    console.error(
      'Usage: node scripts/importProceduresFromExcel.js "<path.xlsx>" [--apply] [--limit N]'
    );
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

  const cats = await loadCategoryCanonicalByNorm(pool);
  const fkMeta = await loadProceduresClinicFkMeta(pool);
  const fkClinicFilterSql = fkMeta.filterSql;
  const procedureLocationIdSelectFragment = fkMeta.procedureLocationIdSelectFragment;
  if (fkMeta.summaryLines.length) {
    console.log('Detected Procedures → Clinics FK:');
    for (const line of fkMeta.summaryLines) console.log(`  ${line}`);
  } else {
    console.warn(
      'No enabled dbo.Procedures → dbo.Clinics FK in sys.foreign_keys (check schema/table names). Index filter skipped.'
    );
  }
  if (fkClinicFilterSql) {
    console.log('Only clinics matching the referenced index filter are eligible for import.');
  }
  await warnIfProceduresHasTriggers(pool);

  const validClinicIds = await loadValidClinicIds(pool, fkClinicFilterSql);
  const rowsToProcess = limit ? procRows.slice(0, limit) : procRows;
  console.log(
    `Loaded ${procRows.length} procedure row(s) from Excel${limit ? ` (processing first ${limit})` : ''}.`
  );
  console.log(
    `Clinic IDs eligible for import (FK-referenceable): ${validClinicIds.size}${
      fkClinicFilterSql ? '' : fkMeta.fkCount > 0 ? ' (no index filter on referenced key)' : ''
    }`
  );
  const nameOnlyClinicCache = new Map();
  const resolveClinicCache = new Map();
  const procedureExistsCache = new Map();
  const pendingInsertKeys = new Set();

  let plannedInserts = 0;
  let skippedDup = 0;
  let skippedNoClinic = 0;
  let skippedNoCategory = 0;
  let skippedClinicNotInDb = 0;
  const ambiguousClinic = [];
  let toInsert = [];

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    if (i > 0 && i % 500 === 0) {
      console.log(`  … processed ${i}/${rowsToProcess.length} spreadsheet rows`);
    }
    const clinicName = row.ClinicName;
    const procedureName = row.ProcedureName;
    if (procedureName == null || String(procedureName).trim() === '') {
      continue;
    }
    const glowCat = row.GlowraCategory != null && row.GlowraCategory !== '' ? row.GlowraCategory : row.Category;
    const unit = excelUnitToPriceUnit(row.Unit);
    const avgPrice = row.AvgPrice;
    const hasPrice = avgPrice != null && avgPrice !== '' && !Number.isNaN(parseFloat(avgPrice));
    const averageCost = hasPrice ? parseFloat(avgPrice) : null;

    const { canon: catCanon, categoryId } = resolveExcelCategory(glowCat, cats.byNorm, cats.idByNorm);
    if (!categoryId) {
      skippedNoCategory++;
      continue;
    }

    const nk = normKey(clinicName);
    const locs = nameToLocs.get(nk) || [];
    const clinicIds = new Set();

    if (locs.length === 0) {
      let nameRes = nameOnlyClinicCache.get(nk);
      if (nameRes === undefined) {
        const rName = await pool
          .request()
          .input('n', sql.NVarChar(255), String(clinicName || '').trim())
          .query(`
          SELECT ClinicID FROM Clinics
          WHERE LOWER(LTRIM(RTRIM(ClinicName))) = LOWER(LTRIM(RTRIM(@n)))
        `);
        if (rName.recordset.length === 1) {
          nameRes = { kind: 'one', id: clinicIdFromRow(rName.recordset[0]) };
        } else if (rName.recordset.length > 1) {
          nameRes = { kind: 'multi', count: rName.recordset.length };
        } else {
          nameRes = { kind: 'none' };
        }
        nameOnlyClinicCache.set(nk, nameRes);
      }
      if (nameRes.kind === 'one') {
        const cid = normalizeClinicId(nameRes.id);
        if (cid != null) clinicIds.add(cid);
      } else if (nameRes.kind === 'multi') {
        ambiguousClinic.push({ clinicName, reason: 'name-only-multiple', count: nameRes.count });
        continue;
      } else {
        skippedNoClinic++;
        continue;
      }
    } else {
      for (const loc of locs) {
        const tk = tripKey(clinicName, loc.city, loc.state);
        const pid = placeByTrip.get(tk) || null;
        const id = await resolveClinicId(
          pool,
          {
            placeId: pid,
            clinicName,
            city: loc.city,
            state: loc.state
          },
          resolveClinicCache
        );
        const cid = normalizeClinicId(id);
        if (cid != null) clinicIds.add(cid);
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

    const clinicId = normalizeClinicId([...clinicIds][0]);
    if (clinicId == null || !validClinicIds.has(clinicId)) {
      skippedClinicNotInDb++;
      continue;
    }

    const procTrim = String(procedureName || '').trim();
    const pendingKey = `${clinicId}|${normKey(procTrim)}|${categoryId}`;
    if (pendingInsertKeys.has(pendingKey)) {
      skippedDup++;
      continue;
    }
    const exists = await clinicHasProcedure(
      pool,
      clinicId,
      procedureName,
      categoryId,
      procedureExistsCache,
      fkMeta.duplicateMatchIncludeLocationIdEqClinicId
    );
    if (exists) {
      skippedDup++;
      continue;
    }

    pendingInsertKeys.add(pendingKey);
    toInsert.push({
      clinicId,
      procedureName: procTrim,
      categoryId,
      categoryLabel: catCanon,
      averageCost,
      priceUnit: unit
    });
    plannedInserts++;
  }

  console.log('\n--- Import summary ---');
  console.log({
    excelProcedureRows: rowsToProcess.length,
    plannedInserts,
    skippedDuplicate: skippedDup,
    skippedNoCategory: skippedNoCategory,
    skippedNoClinic: skippedNoClinic,
    skippedClinicNotInDb: skippedClinicNotInDb,
    ambiguousClinicCount: ambiguousClinic.length,
    mode: apply ? 'APPLY' : 'DRY-RUN'
  });

  if (ambiguousClinic.length) {
    console.log('\nAmbiguous clinic resolution:');
    console.log(ambiguousClinic.slice(0, 20));
    if (ambiguousClinic.length > 20) console.log(`... and ${ambiguousClinic.length - 20} more`);
  }

  if (!apply) {
    console.log('\nSample planned inserts (first 15):');
    console.table(
      toInsert.slice(0, 15).map((x) => ({
        clinicId: x.clinicId,
        procedure: x.procedureName,
        category: x.categoryLabel,
        avg: x.averageCost,
        unit: x.priceUnit
      }))
    );
    console.log('\nRe-run with --apply to INSERT rows.');
    await db.close();
    return;
  }

  const validAtApply = await loadValidClinicIds(pool, fkClinicFilterSql);
  const beforeApply = toInsert.length;
  const droppedIds = [];
  toInsert = toInsert.filter((r) => {
    const ok = validAtApply.has(r.clinicId);
    if (!ok) droppedIds.push(r.clinicId);
    return ok;
  });
  if (beforeApply !== toInsert.length) {
    console.log(
      `\nPre-apply: dropped ${beforeApply - toInsert.length} row(s) — clinicId not FK-referenceable (removed or failed Clinics predicate). Sample: ${[
        ...new Set(droppedIds)
      ]
        .slice(0, 15)
        .join(', ')}`
    );
  }
  if (toInsert.length === 0) {
    console.log('Nothing to insert after validation.');
    await db.close();
    return;
  }

  toInsert.sort((a, b) => {
    if (a.clinicId !== b.clinicId) return a.clinicId - b.clinicId;
    return String(a.procedureName).localeCompare(String(b.procedureName), undefined, { sensitivity: 'base' });
  });
  console.log(
    '\nApply order: sorted by clinicId, then procedure name (deterministic; helps diagnose trigger side effects).'
  );

  const disableTriggers = process.env.IMPORT_DISABLE_PROCEDURE_TRIGGERS === '1';
  if (disableTriggers) {
    console.warn(
      'IMPORT_DISABLE_PROCEDURE_TRIGGERS=1: disabling ALL triggers on dbo.Procedures for this APPLY; re-enabled in finally.'
    );
  }

  const transaction = new sql.Transaction(pool);
  let triggersWereDisabled = false;
  await transaction.begin();
  try {
    if (disableTriggers) {
      await new sql.Request(transaction).query('ALTER TABLE dbo.Procedures DISABLE TRIGGER ALL');
      triggersWereDisabled = true;
    }
    const hasPriceUnitCol = await proceduresTableHasPriceUnitColumn(transaction);
    for (let idx = 0; idx < toInsert.length; idx++) {
      const row = toInsert[idx];
      try {
        await insertProcedureRow(
          transaction,
          row,
          hasPriceUnitCol,
          fkClinicFilterSql,
          procedureLocationIdSelectFragment
        );
      } catch (err) {
        err.importInsertIndex = idx;
        err.importRowSnapshot = {
          clinicId: row.clinicId,
          procedureName: row.procedureName,
          categoryId: row.categoryId
        };
        throw err;
      }
    }
    await transaction.commit();
    console.log(`\nCommitted ${toInsert.length} INSERT(s).`);
  } catch (e) {
    await transaction.rollback();
    console.error('Rolled back:', e);
    process.exitCode = 1;
  } finally {
    if (triggersWereDisabled) {
      try {
        const p = await db.getConnection();
        await p.request().query('ALTER TABLE dbo.Procedures ENABLE TRIGGER ALL');
        console.log('Re-enabled all triggers on dbo.Procedures.');
      } catch (en) {
        console.error('Failed to re-enable dbo.Procedures triggers. Run manually:', en.message);
      }
    }
    await db.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
