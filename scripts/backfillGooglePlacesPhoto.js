/**
 * Backfill GooglePlacesData.Photo from ClinicPhotos Table
 * 
 * This script finds clinics with photos in ClinicPhotos table but missing
 * or NULL Photo in GooglePlacesData, and backfills the Photo field.
 * 
 * Usage:
 *   node scripts/backfillGooglePlacesPhoto.js
 *   node scripts/backfillGooglePlacesPhoto.js --clinic-id=30  (for single clinic)
 */

const { sql, db } = require('../db');

/**
 * Backfill photo for a single clinic
 */
async function backfillPhotoForClinic(pool, clinicId, clinicName, placeId, photoURL) {
  try {
    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);
    request.input('photoURL', sql.NVarChar(1000), photoURL);
    request.input('placeId', sql.NVarChar(255), placeId);

    // Check if GooglePlacesData entry exists
    const checkResult = await request.query(`
      SELECT ClinicID FROM GooglePlacesData WHERE ClinicID = @clinicId
    `);

    if (checkResult.recordset.length === 0) {
      // Create new GooglePlacesData entry with only ClinicID, PlaceID, and Photo
      await request.query(`
        INSERT INTO GooglePlacesData (ClinicID, PlaceID, Photo, LastUpdated)
        VALUES (@clinicId, @placeId, @photoURL, GETDATE())
      `);
      return { success: true, action: 'created' };
    } else {
      // Update existing entry with Photo
      // First check if Photo is NULL or empty
      const checkPhotoResult = await request.query(`
        SELECT Photo FROM GooglePlacesData WHERE ClinicID = @clinicId
      `);
      
      const currentPhoto = checkPhotoResult.recordset[0]?.Photo;
      
      if (currentPhoto && currentPhoto.trim() !== '') {
        return { success: true, action: 'skipped' }; // Photo already exists
      }
      
      // Update the Photo field
      await request.query(`
        UPDATE GooglePlacesData 
        SET Photo = @photoURL, LastUpdated = GETDATE()
        WHERE ClinicID = @clinicId
      `);
      
      return { success: true, action: 'updated' };
    }
  } catch (error) {
    console.error(`   ❌ Error backfilling photo for ${clinicName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main execution
 */
async function main() {
  let pool;
  
  try {
    console.log('='.repeat(70));
    console.log('🔄 BACKFILL GOOGLEPLACESDATA.PHOTO FROM CLINICPHOTOS');
    console.log('='.repeat(70));
    console.log('');

    // Parse command line arguments
    const args = process.argv.slice(2);
    const clinicIdArg = args.find(arg => arg.startsWith('--clinic-id='));
    const specificClinicId = clinicIdArg ? parseInt(clinicIdArg.split('=')[1]) : null;

    // Connect to database
    pool = await db.getConnection();
    console.log('✓ Connected to database\n');

    // Find clinics with ClinicPhotos but missing/null GooglePlacesData.Photo
    // Get the primary photo (or first photo) for each clinic
    let query = `
      WITH ClinicPrimaryPhotos AS (
        SELECT 
          ClinicID,
          PhotoURL,
          ROW_NUMBER() OVER (PARTITION BY ClinicID ORDER BY IsPrimary DESC, DisplayOrder ASC) as RowNum
        FROM ClinicPhotos
      )
      SELECT DISTINCT
        c.ClinicID,
        c.ClinicName,
        c.PlaceID,
        cpp.PhotoURL
      FROM Clinics c
      INNER JOIN ClinicPrimaryPhotos cpp ON c.ClinicID = cpp.ClinicID AND cpp.RowNum = 1
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      WHERE 
        (g.ClinicID IS NULL OR g.Photo IS NULL OR g.Photo = '')
        AND c.PlaceID IS NOT NULL
    `;

    if (specificClinicId) {
      query += ` AND c.ClinicID = ${specificClinicId}`;
    }

    query += ' ORDER BY c.ClinicID';

    const result = await pool.request().query(query);
    const clinics = result.recordset;

    console.log(`Found ${clinics.length} clinic(s) to process\n`);

    if (clinics.length === 0) {
      console.log('No clinics found that need photo backfill. Exiting.');
      return;
    }

    // Process each clinic
    const stats = {
      total: clinics.length,
      successful: 0,
      failed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (const clinic of clinics) {
      console.log(`\n📸 Processing: ${clinic.ClinicName} (ID: ${clinic.ClinicID})`);
      console.log(`   PlaceID: ${clinic.PlaceID}`);
      console.log(`   PhotoURL: ${clinic.PhotoURL ? 'Found' : 'Missing'}`);

      if (!clinic.PhotoURL) {
        console.log(`   ⚠️  No photo URL found, skipping`);
        stats.failed++;
        stats.errors.push({
          clinicId: clinic.ClinicID,
          clinicName: clinic.ClinicName,
          error: 'No photo URL in ClinicPhotos'
        });
        continue;
      }

      const result = await backfillPhotoForClinic(
        pool,
        clinic.ClinicID,
        clinic.ClinicName,
        clinic.PlaceID,
        clinic.PhotoURL
      );

      if (result.success) {
        stats.successful++;
        if (result.action === 'created') {
          stats.created++;
          console.log(`   ✅ Created GooglePlacesData entry and set Photo`);
        } else if (result.action === 'updated') {
          stats.updated++;
          console.log(`   ✅ Updated GooglePlacesData.Photo`);
        } else {
          stats.skipped++;
          console.log(`   ⚠️  Photo already exists, skipped`);
        }
      } else {
        stats.failed++;
        stats.errors.push({
          clinicId: clinic.ClinicID,
          clinicName: clinic.ClinicName,
          error: result.error
        });
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total clinics processed: ${stats.total}`);
    console.log(`✅ Successful: ${stats.successful}`);
    console.log(`   - Created: ${stats.created}`);
    console.log(`   - Updated: ${stats.updated}`);
    console.log(`   - Skipped: ${stats.skipped}`);
    console.log(`❌ Failed: ${stats.failed}`);

    if (stats.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      stats.errors.forEach(err => {
        console.log(`   - ${err.clinicName} (ID: ${err.clinicId}): ${err.error}`);
      });
    }

    console.log('\n✅ Script completed successfully!');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { backfillPhotoForClinic };

