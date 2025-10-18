/**
 * Fetch and Store Clinic Photos from Google Places API
 * 
 * This script fetches photos for all clinics with PlaceIDs and stores them in the ClinicPhotos table.
 * It's designed to be run once initially and then updated daily via the cron job.
 * 
 * Usage:
 *   node scripts/fetchClinicPhotos.js
 *   node scripts/fetchClinicPhotos.js --clinic-id=5  (for single clinic)
 *   node scripts/fetchClinicPhotos.js --limit=20     (limit photos per clinic)
 */

const { sql, db } = require('../db');
const { fetchPlacePhotos } = require('../utils/googlePlaces');

// Configuration
const MAX_PHOTOS_PER_CLINIC = process.env.MAX_PHOTOS_PER_CLINIC || 20;
const DELAY_BETWEEN_REQUESTS = 200; // ms to avoid rate limiting

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch and store photos for a single clinic
 */
async function fetchPhotosForClinic(pool, clinicId, clinicName, placeId, maxPhotos = MAX_PHOTOS_PER_CLINIC) {
  try {
    console.log(`\n📸 Fetching photos for: ${clinicName} (ID: ${clinicId})`);
    console.log(`   PlaceID: ${placeId}`);
    
    // Fetch photos from Google Places API
    const photos = await fetchPlacePhotos(placeId);
    
    if (!photos || photos.length === 0) {
      console.log(`   ⚠️  No photos available`);
      return { success: false, photoCount: 0 };
    }
    
    console.log(`   ✓ Found ${photos.length} photos from Google`);
    
    // Limit to max photos per clinic
    const photosToStore = photos.slice(0, maxPhotos);
    
    // Delete existing photos for this clinic
    await pool.request()
      .input('clinicId', sql.Int, clinicId)
      .query('DELETE FROM ClinicPhotos WHERE ClinicID = @clinicId');
    
    // Insert new photos
    let insertedCount = 0;
    for (let i = 0; i < photosToStore.length; i++) {
      const photo = photosToStore[i];
      
      // Extract attribution text from HTML attributions array
      const attributionText = photo.attributions && photo.attributions.length > 0 
        ? photo.attributions.join('; ').replace(/<[^>]*>/g, '') // Strip HTML tags
        : null;
      
      await pool.request()
        .input('clinicId', sql.Int, clinicId)
        .input('photoReference', sql.NVarChar(1000), photo.reference)
        .input('photoURL', sql.NVarChar(2000), photo.urls.large)
        .input('width', sql.Int, photo.width)
        .input('height', sql.Int, photo.height)
        .input('attributionText', sql.NVarChar(500), attributionText)
        .input('isPrimary', sql.Bit, photo.isPrimary ? 1 : 0)
        .input('displayOrder', sql.Int, i)
        .query(`
          INSERT INTO ClinicPhotos (
            ClinicID, PhotoReference, PhotoURL, Width, Height, 
            AttributionText, IsPrimary, DisplayOrder, LastUpdated
          ) VALUES (
            @clinicId, @photoReference, @photoURL, @width, @height,
            @attributionText, @isPrimary, @displayOrder, GETDATE()
          )
        `);
      
      insertedCount++;
    }
    
    console.log(`   ✅ Stored ${insertedCount} photos in database`);
    
    return { success: true, photoCount: insertedCount };
    
  } catch (error) {
    console.error(`   ❌ Error fetching photos for ${clinicName}:`, error.message);
    return { success: false, photoCount: 0, error: error.message };
  }
}

/**
 * Main execution
 */
async function main() {
  let pool;
  
  try {
    console.log('='.repeat(70));
    console.log('🏥 CLINIC PHOTOS FETCH & STORAGE SCRIPT');
    console.log('='.repeat(70));
    console.log(`Max photos per clinic: ${MAX_PHOTOS_PER_CLINIC}`);
    console.log(`Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms`);
    console.log('');
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const clinicIdArg = args.find(arg => arg.startsWith('--clinic-id='));
    const limitArg = args.find(arg => arg.startsWith('--limit='));
    
    const specificClinicId = clinicIdArg ? parseInt(clinicIdArg.split('=')[1]) : null;
    const photoLimit = limitArg ? parseInt(limitArg.split('=')[1]) : MAX_PHOTOS_PER_CLINIC;
    
    // Connect to database
    pool = await db.getConnection();
    console.log('✓ Connected to database\n');
    
    // Get clinics with PlaceIDs
    let clinicsQuery = `
      SELECT ClinicID, ClinicName, PlaceID 
      FROM Clinics 
      WHERE PlaceID IS NOT NULL
    `;
    
    if (specificClinicId) {
      clinicsQuery += ` AND ClinicID = ${specificClinicId}`;
    }
    
    clinicsQuery += ' ORDER BY ClinicID';
    
    const result = await pool.request().query(clinicsQuery);
    const clinics = result.recordset;
    
    console.log(`Found ${clinics.length} clinic(s) to process\n`);
    
    if (clinics.length === 0) {
      console.log('No clinics with PlaceIDs found. Exiting.');
      return;
    }
    
    // Process each clinic
    const stats = {
      total: clinics.length,
      successful: 0,
      failed: 0,
      totalPhotos: 0,
      errors: []
    };
    
    for (const clinic of clinics) {
      const result = await fetchPhotosForClinic(
        pool, 
        clinic.ClinicID, 
        clinic.ClinicName, 
        clinic.PlaceID,
        photoLimit
      );
      
      if (result.success) {
        stats.successful++;
        stats.totalPhotos += result.photoCount;
      } else {
        stats.failed++;
        stats.errors.push({
          clinicId: clinic.ClinicID,
          clinicName: clinic.ClinicName,
          error: result.error
        });
      }
      
      // Delay to avoid rate limiting
      if (clinics.indexOf(clinic) < clinics.length - 1) {
        await sleep(DELAY_BETWEEN_REQUESTS);
      }
    }
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total clinics processed: ${stats.total}`);
    console.log(`✅ Successful: ${stats.successful}`);
    console.log(`❌ Failed: ${stats.failed}`);
    console.log(`📸 Total photos stored: ${stats.totalPhotos}`);
    console.log(`📈 Average photos per clinic: ${(stats.totalPhotos / stats.successful || 0).toFixed(1)}`);
    
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

module.exports = { fetchPhotosForClinic };

