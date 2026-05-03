/**
 * One-time purge: delete Providers rows that have no usable image data.
 * Procedures stay on the clinic (ClinicID); they are not deleted.
 *
 * "Has image" (default): non-empty PhotoData OR non-empty PhotoURL that is not the placeholder.
 * Strict mode (--strict): only non-empty PhotoData counts (matches API hasPhoto / HasPhotoData).
 *
 * Usage:
 *   node scripts/purgeProvidersWithoutImages.js              # dry run — counts + sample IDs only
 *   node scripts/purgeProvidersWithoutImages.js --execute    # perform DELETE (after reviewing output)
 *   node scripts/purgeProvidersWithoutImages.js --execute --strict
 *
 * Requires .env DB_* variables (see db.js).
 */

const { sql, db } = require('../db');

const PLACEHOLDER_PHOTO_URL = '/img/doctor/placeholder.png';

function parseArgs(argv) {
  const execute = argv.includes('--execute');
  const strict = argv.includes('--strict');
  return { execute, strict };
}

function hasImagePredicateSql(strict) {
  if (strict) {
    return `(
      pr.PhotoData IS NOT NULL
      AND DATALENGTH(pr.PhotoData) > 0
    )`;
  }
  return `(
    (pr.PhotoData IS NOT NULL AND DATALENGTH(pr.PhotoData) > 0)
    OR (
      pr.PhotoURL IS NOT NULL
      AND LTRIM(RTRIM(pr.PhotoURL)) <> N''
      AND pr.PhotoURL <> N'${PLACEHOLDER_PHOTO_URL.replace(/'/g, "''")}'
    )
  )`;
}

async function purgeProvidersWithoutImages() {
  const { execute, strict } = parseArgs(process.argv.slice(2));
  let pool;

  try {
    pool = await db.getConnection();
    const predicate = hasImagePredicateSql(strict);

    const countRes = await pool.request().query(`
      SELECT COUNT(*) AS Cnt
      FROM Providers pr
      WHERE NOT (${predicate})
    `);

    const targetCount = countRes.recordset[0].Cnt;

    const sampleRes = await pool.request().query(`
      SELECT TOP 25
        pr.ProviderID,
        pr.ClinicID,
        pr.ProviderName,
        CASE WHEN pr.PhotoData IS NOT NULL AND DATALENGTH(pr.PhotoData) > 0 THEN 1 ELSE 0 END AS HasPhotoDataBytes,
        pr.PhotoURL
      FROM Providers pr
      WHERE NOT (${predicate})
      ORDER BY pr.ProviderID
    `);

    console.log('Providers without image data (purge targets)');
    console.log(`  Mode: ${strict ? 'strict (PhotoData only)' : 'default (PhotoData or non-placeholder PhotoURL)'}`);
    console.log(`  Count: ${targetCount}`);
    console.log(`  Sample (up to 25):\n${JSON.stringify(sampleRes.recordset, null, 2)}`);

    if (!execute) {
      console.log('\nDry run only. Re-run with --execute to delete these provider rows only (procedures unchanged).');
      return;
    }

    const tran = new sql.Transaction(pool);
    await tran.begin();

    try {
      const deleteProviders = new sql.Request(tran);
      const provResult = await deleteProviders.query(`
        DELETE FROM pr
        FROM Providers AS pr
        WHERE NOT (${predicate})
      `);

      await tran.commit();

      const provRows = provResult.rowsAffected.reduce((a, b) => a + b, 0);
      console.log(`\nDone. Deleted providers rows (sum of batch counts): ${provRows}`);
    } catch (err) {
      await tran.rollback();
      throw err;
    }
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  purgeProvidersWithoutImages()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('purgeProvidersWithoutImages failed:', err);
      process.exit(1);
    });
}

module.exports = { purgeProvidersWithoutImages };
