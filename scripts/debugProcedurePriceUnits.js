/**
 * Debug: PriceUnit on live Procedures vs drafts / API shape.
 * Usage: node scripts/debugProcedurePriceUnits.js [clinicId]
 *
 * Requires .env DB_* (same as the API).
 */
require('dotenv').config();
const { db, sql } = require('../db');

async function main() {
  const clinicId = process.argv[2] ? parseInt(process.argv[2], 10) : null;

  const pool = await db.getConnection();
  if (!pool) {
    console.error('No database connection');
    process.exit(1);
  }

  console.log('--- 1) Column exists on Procedures? ---');
  const col = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Procedures' AND COLUMN_NAME = 'PriceUnit'
  `);
  console.log(col.recordset.length ? col.recordset : '(no PriceUnit column — run migration)');

  console.log('\n--- 2) Live Procedures: how many rows have a non-empty PriceUnit? ---');
  const counts = await pool.request().query(`
    SELECT
      COUNT(*) AS total_procedures,
      SUM(CASE WHEN PriceUnit IS NOT NULL AND LTRIM(RTRIM(PriceUnit)) <> '' THEN 1 ELSE 0 END) AS with_unit
    FROM Procedures
  `);
  console.table(counts.recordset);

  console.log('\n--- 3) Sample live procedures WITH a unit (up to 8) ---');
  const sample = await pool.request().query(`
    SELECT TOP 8 ProcedureID, ProviderID, ProcedureName, AverageCost, PriceUnit
    FROM Procedures
    WHERE PriceUnit IS NOT NULL AND LTRIM(RTRIM(PriceUnit)) <> ''
    ORDER BY ProcedureID DESC
  `);
  console.table(sample.recordset);

  console.log('\n--- 4) DraftProcedures: rows with non-empty PriceUnit (up to 8) ---');
  let drafts;
  try {
    drafts = await pool.request().query(`
      SELECT TOP 8 DraftProcedureID, DraftID, ProcedureName, AverageCost, PriceUnit
      FROM DraftProcedures
      WHERE PriceUnit IS NOT NULL AND LTRIM(RTRIM(PriceUnit)) <> ''
      ORDER BY DraftProcedureID DESC
    `);
    console.table(drafts.recordset);
  } catch (e) {
    console.log('DraftProcedures query failed:', e.message);
  }

  if (clinicId && !Number.isNaN(clinicId)) {
    console.log(`\n--- 5) Procedures for clinicId=${clinicId} (dedupe same as API) ---`);
    const byClinic = await pool.request().input('clinicId', sql.Int, clinicId).query(`
      SELECT
        ProcedureID,
        ProcedureName,
        AverageCost,
        PriceUnit,
        Category
      FROM (
        SELECT
          p.ProcedureID,
          p.ProcedureName,
          p.AverageCost,
          p.PriceUnit,
          c.Category,
          c.CategoryID,
          ROW_NUMBER() OVER (PARTITION BY p.ProcedureName, c.Category ORDER BY p.ProcedureID) AS RowNum
        FROM Procedures p
        JOIN Categories c ON p.CategoryID = c.CategoryID
        JOIN Providers pr ON p.ProviderID = pr.ProviderID
        WHERE pr.ClinicID = @clinicId
      ) AS RankedProcedures
      WHERE RowNum = 1
      ORDER BY Category, ProcedureName
    `);
    console.table(byClinic.recordset);
  } else {
    console.log('\n--- 5) Skip per-clinic sample (pass clinicId as argv) ---');
    console.log('    Example: node scripts/debugProcedurePriceUnits.js 42');
  }

  console.log('\n--- Next: curl API (replace URL + clinic id) ---');
  console.log(
    '      curl -s "http://localhost:3001/api/clinics/CLINIC_ID/procedures?flat=true" | head -c 2000'
  );
  console.log(
    '      curl -s "http://localhost:3001/api/clinics/search-index" | head -c 500'
  );
  console.log('    Expect priceUnit only when DB value is non-empty; omitted when NULL/blank.\n');

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
