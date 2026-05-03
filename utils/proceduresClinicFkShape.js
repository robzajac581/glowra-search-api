const sql = require('mssql');

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedMeta = null;
let cacheExpiresAt = 0;

function createRequest(poolOrTransaction) {
  if (poolOrTransaction && typeof poolOrTransaction.request === 'function') {
    return poolOrTransaction.request();
  }
  return new sql.Request(poolOrTransaction);
}

/**
 * Discover Procedures foreign keys affecting ClinicID / LocationID columns.
 *
 * Legacy DBs may have Procedures.LocationID → Clinics(ClinicID). Newer schema may add
 * Procedures.LocationID → Locations(LocationID). Both on the same column is contradictory
 * unless LocationID is nullable and set to NULL (clinic then comes from Procedures.ClinicID).
 *
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTransaction
 * @returns {Promise<{
 *   filterSql: string|null,
 *   summaryLines: string[],
 *   fkCount: number,
 *   parentColumnCount: number,
 *   procedureLocationIdSelectFragment: 'c.ClinicID' | 'c.LocationID' | 'CAST(NULL AS INT)',
 *   locationIdReferencesClinicId: boolean,
 *   locationIdUseNull: boolean,
 *   duplicateMatchIncludeLocationIdEqClinicId: boolean
 * }>}
 */
async function loadProceduresClinicFkMeta(poolOrTransaction) {
  const now = Date.now();
  if (cachedMeta != null && now < cacheExpiresAt) {
    return cachedMeta;
  }

  const request = createRequest(poolOrTransaction);

  const allFksR = await request.query(`
    SELECT
      fk.name AS fkName,
      OBJECT_NAME(fk.referenced_object_id) AS refTable,
      COL_NAME(fc.parent_object_id, fc.parent_column_id) AS parentCol,
      COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS refCol,
      fc.constraint_column_id AS ord
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
    WHERE fk.parent_object_id = OBJECT_ID(N'dbo.Procedures')
      AND fk.is_disabled = 0
    ORDER BY fk.name, fc.constraint_column_id
  `);

  const nullQ = await request.query(`
    SELECT IS_NULLABLE AS nullable
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo'
      AND TABLE_NAME = N'Procedures'
      AND COLUMN_NAME = N'LocationID'
  `);
  const locationIdNullable = nullQ.recordset[0]?.nullable === 'YES';

  const locIdToClinics = allFksR.recordset.some(
    (r) => r.parentCol === 'LocationID' && r.refTable === 'Clinics'
  );
  const locIdToLocations = allFksR.recordset.some(
    (r) => r.parentCol === 'LocationID' && r.refTable === 'Locations'
  );

  const allFkSummary = [];
  const byFk = new Map();
  for (const row of allFksR.recordset) {
    if (!byFk.has(row.fkName)) byFk.set(row.fkName, []);
    byFk.get(row.fkName).push(row);
  }
  for (const [name, rows] of byFk) {
    rows.sort((a, b) => a.ord - b.ord);
    const desc = rows.map((r) => `${r.parentCol}→${r.refTable}(${r.refCol})`).join(', ');
    allFkSummary.push(`${name}: ${desc}`);
  }

  const clinicFkR = await request.query(`
    SELECT
      fk.name AS fkName,
      fc.constraint_column_id AS ord,
      COL_NAME(fc.parent_object_id, fc.parent_column_id) AS parentCol,
      COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS refCol,
      i.name AS refIndexName,
      i.filter_definition AS filterDefinition
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fc
      ON fc.constraint_object_id = fk.object_id
    LEFT JOIN sys.indexes i
      ON i.object_id = fk.referenced_object_id
      AND i.index_id = fk.key_index_id
    WHERE fk.parent_object_id = OBJECT_ID(N'dbo.Procedures')
      AND fk.referenced_object_id = OBJECT_ID(N'dbo.Clinics')
      AND fk.is_disabled = 0
    ORDER BY fk.name, fc.constraint_column_id
  `);

  let summaryLines =
    allFkSummary.length > 0
      ? [`dbo.Procedures foreign keys: ${allFkSummary.join('; ')}`]
      : ['dbo.Procedures foreign keys: (none found)'];
  let parentColumnCount = 0;
  let procedureLocationIdSelectFragment = 'c.LocationID';
  let locationIdReferencesClinicId = false;
  let locationIdUseNull = false;
  let duplicateMatchIncludeLocationIdEqClinicId = false;

  if (locIdToClinics && locIdToLocations) {
    if (!locationIdNullable) {
      throw new Error(
        'dbo.Procedures.LocationID has foreign keys to both Clinics and Locations; the column must be ' +
        'NULLable to import (set LocationID to NULL and rely on Procedures.ClinicID). ' +
        'Or run a migration to drop the obsolete LocationID→Clinics constraint.'
      );
    }
    procedureLocationIdSelectFragment = 'CAST(NULL AS INT)';
    locationIdUseNull = true;
    duplicateMatchIncludeLocationIdEqClinicId = true;
    summaryLines.push(
      'Resolution: LocationID → Clinics AND Locations (conflict). Using NULL for LocationID; clinic ownership is Procedures.ClinicID.'
    );
  } else if (locIdToLocations && !locIdToClinics) {
    procedureLocationIdSelectFragment = 'c.LocationID';
    duplicateMatchIncludeLocationIdEqClinicId = false;
    summaryLines.push('Resolution: LocationID → Locations only; using Clinics.LocationID from the owning clinic row.');
  } else if (locIdToClinics && !locIdToLocations) {
    locationIdReferencesClinicId = true;
    procedureLocationIdSelectFragment = 'c.ClinicID';
    duplicateMatchIncludeLocationIdEqClinicId = true;
    summaryLines.push(
      'Resolution: LocationID → Clinics(ClinicID) only (legacy); using c.ClinicID for Procedures.LocationID.'
    );
  } else {
    summaryLines.push(
      'Resolution: no FK found on Procedures.LocationID; defaulting Procedures.LocationID from Clinics.LocationID.'
    );
  }

  if (clinicFkR.recordset.length === 0) {
    cachedMeta = {
      filterSql: null,
      summaryLines,
      fkCount: 0,
      parentColumnCount: 0,
      procedureLocationIdSelectFragment,
      locationIdReferencesClinicId,
      locationIdUseNull,
      duplicateMatchIncludeLocationIdEqClinicId
    };
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedMeta;
  }

  const byName = new Map();
  for (const row of clinicFkR.recordset) {
    if (!byName.has(row.fkName)) {
      const fd = row.filterDefinition;
      byName.set(row.fkName, {
        fkName: row.fkName,
        refIndexName: row.refIndexName,
        filterDefinition:
          fd != null && String(fd).trim() !== '' ? String(fd).trim() : null,
        columns: []
      });
    }
    byName.get(row.fkName).columns.push({
      parentCol: row.parentCol,
      refCol: row.refCol,
      ord: row.ord
    });
  }

  if (byName.size > 1) {
    throw new Error(
      `Multiple dbo.Procedures → dbo.Clinics foreign keys: ${[...byName.keys()].join(', ')}. ` +
        'Extend utils/proceduresClinicFkShape.js if both are required.'
    );
  }

  const fk = [...byName.values()][0];
  fk.columns.sort((a, b) => a.ord - b.ord);
  const parents = fk.columns.map((c) => c.parentCol);
  const refs = fk.columns.map((c) => c.refCol);
  const parentSet = new Set(parents);
  const refSet = new Set(refs);

  const okSingleClinicId = parents.length === 1 && parents[0] === 'ClinicID' && refs[0] === 'ClinicID';
  const okLegacyLocationId =
    parents.length === 1 && parents[0] === 'LocationID' && refs.length === 1 && refs[0] === 'ClinicID';
  const okPair =
    parents.length === 2 &&
    parentSet.has('ClinicID') &&
    parentSet.has('LocationID') &&
    refSet.has('ClinicID') &&
    refSet.has('LocationID');

  if (!okSingleClinicId && !okPair && !okLegacyLocationId) {
    throw new Error(
      `Unsupported dbo.Procedures → dbo.Clinics FK "${fk.fkName}": parent (${parents.join(
        ', '
      )}) → ref (${refs.join(', ')}). ` +
        'Supported: (ClinicID)→(ClinicID), (ClinicID,LocationID)→(ClinicID,LocationID), or legacy (LocationID)→(ClinicID).'
    );
  }

  filterSql = fk.filterDefinition;
  fkCount = 1;
  parentColumnCount = fk.columns.length;

  const refColsStr = refs.join(', ');
  const filterHint = fk.filterDefinition ? `; ref index filter: ${fk.filterDefinition}` : '';
  summaryLines.push(
    `Clinics FK ${fk.fkName}: (${parents.join(', ')}) → Clinics(${refColsStr})` +
      ` (referenced index: ${fk.refIndexName || 'n/a'})${filterHint}`
  );

  cachedMeta = {
    filterSql,
    summaryLines,
    fkCount,
    parentColumnCount,
    procedureLocationIdSelectFragment,
    locationIdReferencesClinicId,
    locationIdUseNull,
    duplicateMatchIncludeLocationIdEqClinicId
  };
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedMeta;
}

module.exports = {
  loadProceduresClinicFkMeta
};
