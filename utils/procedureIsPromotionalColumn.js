const sql = require('mssql');

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Whether Procedures / DraftProcedures carry IsPromotional
 * (migration addProceduresIsPromotional.sql).
 *
 * Same shape as utils/procedurePriceUnitColumn.js, for the same reason: the
 * code deploys before the migration runs, and an endpoint that 500s because a
 * column is missing is a worse outcome than one that reports "not assessed".
 * Until the column exists, reads substitute CAST(NULL AS BIT) -- which is
 * exactly the right answer, because an unmigrated database genuinely has not
 * assessed anything -- and writes skip the column.
 *
 * Cached ~5 minutes per table so running the migration heals without a
 * redeploy; a restart is also fine.
 */
const caches = new Map();

function createRequest(poolOrTransaction) {
  if (poolOrTransaction && typeof poolOrTransaction.request === 'function') {
    return poolOrTransaction.request();
  }
  return new sql.Request(poolOrTransaction);
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTransaction
 * @param {'Procedures'|'DraftProcedures'} tableName
 * @returns {Promise<boolean>}
 */
async function tableHasIsPromotionalColumn(poolOrTransaction, tableName = 'Procedures') {
  const now = Date.now();
  const cached = caches.get(tableName);
  if (cached && now < cached.expiresAt) {
    return cached.exists;
  }

  let exists = false;
  try {
    const request = createRequest(poolOrTransaction);
    request.input('tableName', sql.NVarChar(128), tableName);
    const result = await request.query(`
      SELECT 1 AS ok
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName AND COLUMN_NAME = 'IsPromotional'
    `);
    exists = result.recordset.length > 0;
  } catch {
    exists = false;
  }

  caches.set(tableName, { exists, expiresAt: now + CACHE_TTL_MS });
  return exists;
}

/** Convenience wrapper for the live Procedures table. */
function proceduresTableHasIsPromotionalColumn(poolOrTransaction) {
  return tableHasIsPromotionalColumn(poolOrTransaction, 'Procedures');
}

/** Convenience wrapper for DraftProcedures. */
function draftProceduresTableHasIsPromotionalColumn(poolOrTransaction) {
  return tableHasIsPromotionalColumn(poolOrTransaction, 'DraftProcedures');
}

/**
 * SELECT fragment for use inside a `FROM Procedures p` subquery / join.
 *
 * The CAST(NULL AS BIT) fallback is deliberate: it keeps the column present in
 * the result set (so downstream mapping code needs no branch) while reporting
 * "not assessed", which is the truth on an unmigrated database.
 *
 * @param {boolean} hasColumn
 * @param {string} [alias='p']
 */
function innerProcedureIsPromotionalSelectSql(hasColumn, alias = 'p') {
  return hasColumn
    ? `${alias}.IsPromotional`
    : 'CAST(NULL AS BIT) AS IsPromotional';
}

/** Reset the cache. Tests only. */
function _resetIsPromotionalColumnCache() {
  caches.clear();
}

module.exports = {
  tableHasIsPromotionalColumn,
  proceduresTableHasIsPromotionalColumn,
  draftProceduresTableHasIsPromotionalColumn,
  innerProcedureIsPromotionalSelectSql,
  _resetIsPromotionalColumnCache
};
