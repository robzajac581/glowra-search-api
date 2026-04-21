const { db, sql } = require('../db');
const clinicMergeService = require('../clinic-management/services/clinicMergeService');

function parseArgs(argv) {
  return {
    execute: argv.includes('--execute'),
    placeId: readArgValue(argv, '--placeId'),
    mergedBy: readArgValue(argv, '--mergedBy') || 'dedup-script',
    source: readArgValue(argv, '--source') || 'dedup-script'
  };
}

function readArgValue(argv, key) {
  const idx = argv.indexOf(key);
  if (idx === -1 || idx + 1 >= argv.length) {
    return null;
  }
  return argv[idx + 1];
}

async function loadDuplicateGroups(placeIdFilter = null) {
  const pool = await db.getConnection();
  const request = pool.request();

  let whereClause = `
    WHERE PlaceID IS NOT NULL
      AND LTRIM(RTRIM(PlaceID)) <> ''
  `;
  if (placeIdFilter) {
    request.input('placeId', sql.NVarChar, placeIdFilter);
    whereClause += ' AND PlaceID = @placeId';
  }

  const groupsResult = await request.query(`
    SELECT PlaceID, COUNT(*) AS ClinicCount
    FROM Clinics
    ${whereClause}
    GROUP BY PlaceID
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, PlaceID ASC
  `);

  const groups = [];
  for (const row of groupsResult.recordset) {
    const detailsRequest = pool.request();
    detailsRequest.input('placeId', sql.NVarChar, row.PlaceID);
    const detailsResult = await detailsRequest.query(`
      SELECT ClinicID, ClinicName, Address, City, State, Website, Phone
      FROM Clinics
      WHERE PlaceID = @placeId
      ORDER BY ClinicID ASC
    `);
    groups.push({
      placeId: row.PlaceID,
      clinics: detailsResult.recordset
    });
  }

  return groups;
}

async function assertDedupInfrastructureReady() {
  const pool = await db.getConnection();
  const result = await pool.request().query(`
    SELECT OBJECT_ID('ClinicMergeLog', 'U') AS ClinicMergeLogObjectId
  `);

  const clinicMergeLogExists = !!result.recordset[0]?.ClinicMergeLogObjectId;
  if (!clinicMergeLogExists) {
    throw new Error(
      "Dedup infrastructure missing: table 'ClinicMergeLog' was not found. " +
      "Run migration first: node scripts/runMigration.js migrations/addClinicDedupInfrastructure.sql"
    );
  }
}

function printDryRun(groups) {
  if (groups.length === 0) {
    console.log('No duplicate PlaceID groups found.');
    return;
  }

  console.log(`Found ${groups.length} duplicate PlaceID group(s).\n`);
  groups.forEach((group, index) => {
    const canonical = group.clinics[0];
    const duplicates = group.clinics.slice(1);
    console.log(`${index + 1}. PlaceID: ${group.placeId}`);
    console.log(`   Canonical: ${canonical.ClinicID} - ${canonical.ClinicName}`);
    duplicates.forEach((clinic) => {
      console.log(`   Merge: ${clinic.ClinicID} - ${clinic.ClinicName}`);
    });
    console.log('');
  });
  console.log('Dry run complete. Re-run with --execute to apply merges.');
}

async function executeMerges(groups, mergedBy, source) {
  let successCount = 0;
  let failureCount = 0;

  for (const group of groups) {
    const canonical = group.clinics[0];
    const duplicates = group.clinics.slice(1);

    for (const duplicate of duplicates) {
      try {
        const result = await clinicMergeService.mergeClinics({
          canonicalClinicId: canonical.ClinicID,
          duplicateClinicId: duplicate.ClinicID,
          mergedBy,
          reason: 'PlaceID exact match',
          notes: `Automated merge for PlaceID ${group.placeId}`,
          source
        });

        successCount += 1;
        console.log(
          `Merged duplicate ${duplicate.ClinicID} into ${canonical.ClinicID} (DeletedClinicID ${result.deletedClinicId})`
        );
      } catch (error) {
        failureCount += 1;
        console.error(
          `Failed merging duplicate ${duplicate.ClinicID} into ${canonical.ClinicID}: ${error.message}`
        );
      }
    }
  }

  console.log('\nMerge run complete.');
  console.log(`Successful merges: ${successCount}`);
  console.log(`Failed merges: ${failureCount}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('Scanning for duplicate clinics by PlaceID...');
  const groups = await loadDuplicateGroups(options.placeId);

  if (!options.execute) {
    printDryRun(groups);
    return;
  }

  await assertDedupInfrastructureReady();

  if (groups.length === 0) {
    console.log('No duplicate PlaceID groups found. Nothing to merge.');
    return;
  }

  console.log(`Executing merges for ${groups.length} duplicate group(s)...\n`);
  await executeMerges(groups, options.mergedBy, options.source);
}

main()
  .catch((error) => {
    console.error('mergeDuplicateClinicsByPlaceId script failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await db.close();
  });
