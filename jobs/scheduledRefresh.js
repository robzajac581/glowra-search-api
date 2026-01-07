const cron = require('node-cron');
const { sql, db } = require('../db');
const { batchFetchPlaceDetails, fetchPlacePhotos } = require('../utils/googlePlaces');
const clinicDeletionService = require('../clinic-management/services/clinicDeletionService');

// Configuration for refresh intervals (in days)
const PHOTO_REFRESH_INTERVAL_DAYS = 14; // Bi-weekly
const RATING_REFRESH_INTERVAL_DAYS = 1; // Daily

/**
 * Scheduled job to refresh Google Places ratings and photos for all clinics
 * - Ratings: Daily at 2 AM
 * - Photos: Bi-weekly (1st & 15th of month) at 2 AM
 * - Deleted clinics cleanup: Daily at 3 AM
 * 
 * IMPORTANT: This also runs a startup check to catch missed jobs!
 * Since in-process cron jobs don't persist state across restarts,
 * we check the database on startup to see if any refresh is overdue.
 */
function initRatingRefreshJob() {
  // Schedule: Run every day at 2 AM (0 2 * * *)
  // Format: minute hour day month dayOfWeek
  const cronSchedule = '0 2 * * *';
  
  console.log('Initializing rating and photo refresh cron job...');
  console.log(`Schedule: Daily at 2:00 AM (${cronSchedule})`);
  console.log('  - Ratings: Daily');
  console.log('  - Photos: Bi-weekly (1st & 15th of month)');
  
  // Initialize deleted clinics cleanup job (runs at 3 AM)
  initDeletedClinicsCleanupJob();

  // Run startup check for overdue jobs (delayed to allow DB connection to establish)
  setTimeout(() => {
    checkAndRunOverdueJobs().catch(error => {
      console.error('Error in startup overdue job check:', error);
    });
  }, 10000); // 10 second delay after startup

  const job = cron.schedule(cronSchedule, async () => {
    console.log('\n=== Starting scheduled rating refresh ===');
    console.log(`Time: ${new Date().toISOString()}`);

    try {
      // Always refresh ratings
      await refreshAllClinicRatings();
      
      // Refresh photos bi-weekly on the 1st and 15th of each month
      // Google photo references expire after ~30-60 days, so bi-weekly keeps them fresh
      const today = new Date();
      if (today.getDate() === 1 || today.getDate() === 15) {
        console.log('\n🖼️  Bi-weekly photo refresh starting...');
        await refreshAllClinicPhotos();
      }
    } catch (error) {
      console.error('Error in scheduled refresh:', error);
      // Don't crash the app, just log the error
    }

    console.log('=== Scheduled refresh completed ===\n');
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'America/New_York' // Use environment timezone or default to EST
  });

  console.log('Rating refresh cron job initialized successfully');
  
  return job;
}

/**
 * Check if any refresh jobs are overdue and run them
 * This handles the case where the server was down during scheduled times
 * or was redeployed and missed scheduled jobs
 */
async function checkAndRunOverdueJobs() {
  console.log('\n=== Checking for overdue refresh jobs ===');
  
  let pool;
  try {
    pool = await db.getConnection();
    
    // Check when photos were last updated
    const photoResult = await pool.request().query(`
      SELECT TOP 1 LastUpdated 
      FROM ClinicPhotos 
      ORDER BY LastUpdated DESC
    `);
    
    const lastPhotoUpdate = photoResult.recordset[0]?.LastUpdated;
    const now = new Date();
    
    console.log(`Last photo update: ${lastPhotoUpdate ? lastPhotoUpdate.toISOString() : 'Never'}`);
    
    // Check if photo refresh is overdue (more than PHOTO_REFRESH_INTERVAL_DAYS days old)
    if (!lastPhotoUpdate) {
      console.log('🖼️  No photos found - running initial photo fetch...');
      await refreshAllClinicPhotos();
    } else {
      const daysSincePhotoUpdate = (now - new Date(lastPhotoUpdate)) / (1000 * 60 * 60 * 24);
      console.log(`Days since last photo update: ${daysSincePhotoUpdate.toFixed(1)}`);
      
      if (daysSincePhotoUpdate > PHOTO_REFRESH_INTERVAL_DAYS) {
        console.log(`🖼️  Photo refresh overdue (>${PHOTO_REFRESH_INTERVAL_DAYS} days) - running now...`);
        await refreshAllClinicPhotos();
      } else {
        console.log(`✓ Photos are fresh (last updated ${daysSincePhotoUpdate.toFixed(1)} days ago)`);
      }
    }
    
    // Check when ratings were last updated
    const ratingResult = await pool.request().query(`
      SELECT TOP 1 LastRatingUpdate 
      FROM Clinics 
      WHERE LastRatingUpdate IS NOT NULL
      ORDER BY LastRatingUpdate DESC
    `);
    
    const lastRatingUpdate = ratingResult.recordset[0]?.LastRatingUpdate;
    console.log(`Last rating update: ${lastRatingUpdate ? lastRatingUpdate.toISOString() : 'Never'}`);
    
    // Check if rating refresh is overdue (more than 2 days old - gives some buffer)
    if (!lastRatingUpdate) {
      console.log('⭐ No ratings found - running initial rating fetch...');
      await refreshAllClinicRatings();
    } else {
      const daysSinceRatingUpdate = (now - new Date(lastRatingUpdate)) / (1000 * 60 * 60 * 24);
      console.log(`Days since last rating update: ${daysSinceRatingUpdate.toFixed(1)}`);
      
      if (daysSinceRatingUpdate > 2) { // 2 days buffer for ratings
        console.log(`⭐ Rating refresh overdue (>2 days) - running now...`);
        await refreshAllClinicRatings();
      } else {
        console.log(`✓ Ratings are fresh (last updated ${daysSinceRatingUpdate.toFixed(1)} days ago)`);
      }
    }
    
    console.log('=== Overdue job check completed ===\n');
    
  } catch (error) {
    console.error('Error checking for overdue jobs:', error);
    throw error;
  }
}

/**
 * Main function to refresh ratings for all clinics
 */
async function refreshAllClinicRatings() {
  let pool;
  
  try {
    pool = await db.getConnection();
    
    // Get all clinics with PlaceIDs
    const result = await pool.request().query(`
      SELECT ClinicID, ClinicName, PlaceID, LastRatingUpdate
      FROM Clinics
      WHERE PlaceID IS NOT NULL
      ORDER BY LastRatingUpdate ASC NULLS FIRST;
    `);

    const clinics = result.recordset;
    
    if (clinics.length === 0) {
      console.log('No clinics with PlaceIDs found');
      return {
        total: 0,
        updated: 0,
        failed: 0
      };
    }

    console.log(`Found ${clinics.length} clinic(s) with PlaceIDs to refresh`);

    // Extract place IDs
    const placeIds = clinics.map(c => c.PlaceID);

    // Batch fetch with rate limiting
    // Process 10 at a time with 500ms delay to avoid rate limits
    console.log('Fetching data from Google Places API...');
    const results = await batchFetchPlaceDetails(placeIds, 10, 500);

    // Track statistics
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    // Update database with results
    console.log('Updating database...');
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const clinic = clinics[i];

      if (result.data && !result.error) {
        try {
          const reviewsJSON = JSON.stringify(result.data.reviews);
          
          const updateRequest = pool.request();
          updateRequest.input('clinicId', sql.Int, clinic.ClinicID);
          updateRequest.input('rating', sql.Decimal(2, 1), result.data.rating);
          updateRequest.input('reviewCount', sql.Int, result.data.reviewCount);
          updateRequest.input('reviewsJSON', sql.NVarChar(sql.MAX), reviewsJSON);
          updateRequest.input('lastUpdate', sql.DateTime, new Date());

          await updateRequest.query(`
            UPDATE Clinics 
            SET GoogleRating = @rating,
                GoogleReviewCount = @reviewCount,
                GoogleReviewsJSON = @reviewsJSON,
                LastRatingUpdate = @lastUpdate
            WHERE ClinicID = @clinicId;
          `);

          successCount++;
          console.log(`✓ Updated clinic ${clinic.ClinicID} (${clinic.ClinicName}): ${result.data.rating} stars, ${result.data.reviewCount} reviews`);
        } catch (dbError) {
          failCount++;
          console.error(`✗ Database error for clinic ${clinic.ClinicID}:`, dbError.message);
        }
      } else {
        // API fetch failed
        if (result.error && result.error.includes('NOT_FOUND')) {
          skippedCount++;
          console.log(`⊘ Skipped clinic ${clinic.ClinicID} (${clinic.ClinicName}): Place not found`);
        } else {
          failCount++;
          console.error(`✗ API error for clinic ${clinic.ClinicID} (${clinic.ClinicName}):`, result.error);
        }
      }
    }

    const summary = {
      total: clinics.length,
      updated: successCount,
      failed: failCount,
      skipped: skippedCount
    };

    console.log('\n--- Refresh Summary ---');
    console.log(`Total clinics: ${summary.total}`);
    console.log(`Successfully updated: ${summary.updated}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Skipped: ${summary.skipped}`);
    console.log('----------------------\n');

    return summary;
  } catch (error) {
    console.error('Fatal error in refreshAllClinicRatings:', error);
    throw error;
  }
}

/**
 * Manual trigger function (useful for testing or manual runs)
 */
async function manualRefresh() {
  console.log('Manual rating refresh triggered');
  try {
    const result = await refreshAllClinicRatings();
    return result;
  } catch (error) {
    console.error('Manual refresh failed:', error);
    throw error;
  }
}

/**
 * Refresh photos for all clinics with PlaceIDs
 * Fetches fresh photo references from Google Places API to prevent expiration
 * Google photo references can expire after ~30-60 days, so we refresh bi-weekly
 */
async function refreshAllClinicPhotos() {
  let pool;
  
  try {
    pool = await db.getConnection();
    
    // Get all clinics with PlaceIDs
    const result = await pool.request().query(`
      SELECT ClinicID, ClinicName, PlaceID
      FROM Clinics
      WHERE PlaceID IS NOT NULL
      ORDER BY ClinicID ASC;
    `);

    const clinics = result.recordset;
    
    if (clinics.length === 0) {
      console.log('   No clinics with PlaceIDs found');
      return { total: 0, updated: 0, failed: 0 };
    }

    console.log(`   Found ${clinics.length} clinic(s) to refresh photos for`);

    let successCount = 0;
    let failCount = 0;
    let totalPhotosStored = 0;

    // Process each clinic
    for (const clinic of clinics) {
      try {
        // Fetch photos from Google Places API
        const photos = await fetchPlacePhotos(clinic.PlaceID);
        
        if (!photos || photos.length === 0) {
          console.log(`   ⊘ No photos available for ${clinic.ClinicName}`);
          continue;
        }
        
        // Delete existing photos for this clinic
        await pool.request()
          .input('clinicId', sql.Int, clinic.ClinicID)
          .query('DELETE FROM ClinicPhotos WHERE ClinicID = @clinicId');
        
        // Insert new photos (limit to 20 per clinic)
        const photosToStore = photos.slice(0, 20);
        
        for (let i = 0; i < photosToStore.length; i++) {
          const photo = photosToStore[i];
          
          // Extract attribution text from HTML attributions array
          const attributionText = photo.attributions && photo.attributions.length > 0 
            ? photo.attributions.join('; ').replace(/<[^>]*>/g, '') // Strip HTML tags
            : null;
          
          await pool.request()
            .input('clinicId', sql.Int, clinic.ClinicID)
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
        }
        
        successCount++;
        totalPhotosStored += photosToStore.length;
        console.log(`   ✓ Refreshed ${photosToStore.length} photos for ${clinic.ClinicName}`);
        
        // Rate limiting delay (200ms between clinics to avoid API rate limits)
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        failCount++;
        console.error(`   ✗ Error refreshing photos for ${clinic.ClinicName}:`, error.message);
      }
    }

    const summary = {
      total: clinics.length,
      updated: successCount,
      failed: failCount,
      totalPhotos: totalPhotosStored
    };

    console.log('\n--- Photo Refresh Summary ---');
    console.log(`Total clinics: ${summary.total}`);
    console.log(`Successfully updated: ${summary.updated}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Total photos stored: ${summary.totalPhotos}`);
    console.log('----------------------------\n');

    return summary;
    
  } catch (error) {
    console.error('Fatal error in refreshAllClinicPhotos:', error);
    throw error;
  }
}

/**
 * Initialize scheduled job to permanently delete clinics older than 30 days
 * Runs daily at 3 AM
 */
function initDeletedClinicsCleanupJob() {
  // Schedule: Run every day at 3 AM (0 3 * * *)
  const cronSchedule = '0 3 * * *';
  
  console.log('Initializing deleted clinics cleanup cron job...');
  console.log(`Schedule: Daily at 3:00 AM (${cronSchedule})`);
  console.log('  - Permanently deletes clinics deleted more than 30 days ago');
  
  const job = cron.schedule(cronSchedule, async () => {
    console.log('\n=== Starting deleted clinics cleanup ===');
    console.log(`Time: ${new Date().toISOString()}`);
    
    try {
      const result = await clinicDeletionService.permanentlyDeleteOldClinics();
      console.log(`✓ ${result.message}`);
      console.log('=== Deleted clinics cleanup completed ===\n');
    } catch (error) {
      console.error('Error in deleted clinics cleanup:', error);
      // Don't crash the app, just log the error
    }
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'America/New_York'
  });
  
  console.log('Deleted clinics cleanup cron job initialized successfully');
  
  return job;
}

module.exports = {
  initRatingRefreshJob,
  refreshAllClinicRatings,
  refreshAllClinicPhotos,
  checkAndRunOverdueJobs,
  manualRefresh,
  initDeletedClinicsCleanupJob
};

