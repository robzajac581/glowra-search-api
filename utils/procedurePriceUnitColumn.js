const sql = require('mssql');

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedExists = null;
let cacheExpiresAt = 0;

function createRequest(poolOrTransaction) {
  if (poolOrTransaction && typeof poolOrTransaction.request === 'function') {
    return poolOrTransaction.request();
  }
  return new sql.Request(poolOrTransaction);
}

/**
 * Whether dbo.Procedures has PriceUnit (migration addProceduresPriceUnit.sql).
 * Cached ~5 minutes so adding the column heals without redeploy; restart is still fine.
 *
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTransaction
 * @returns {Promise<boolean>}
 */
async function proceduresTableHasPriceUnitColumn(poolOrTransaction) {
  const now = Date.now();
  if (cachedExists !== null && now < cacheExpiresAt) {
    return cachedExists;
  }
  try {
    const request = createRequest(poolOrTransaction);
    const result = await request.query(`
      SELECT 1 AS ok
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Procedures' AND COLUMN_NAME = 'PriceUnit'
    `);
    cachedExists = result.recordset.length > 0;
  } catch {
    cachedExists = false;
  }
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedExists;
}

/** Use inside a FROM Procedures p subquery / join */
function innerProcedurePriceUnitSelectSql(hasColumn) {
  return hasColumn
    ? 'p.PriceUnit'
    : 'CAST(NULL AS NVARCHAR(50)) AS PriceUnit';
}

module.exports = {
  proceduresTableHasPriceUnitColumn,
  innerProcedurePriceUnitSelectSql
};
