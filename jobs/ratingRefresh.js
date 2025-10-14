const cron = require('node-cron');
const { sql, db } = require('../db');
const { batchFetchPlaceDetails } = require('../utils/googlePlaces');

/**
 * Scheduled job to refresh Google Places ratings for all clinics
 * Runs daily at 2 AM
 */
function initRatingRefreshJob() {
  // Schedule: Run every day at 2 AM (0 2 * * *)
  // Format: minute hour day month dayOfWeek
  const cronSchedule = '0 2 * * *';
  
  console.log('Initializing rating refresh cron job...');
  console.log(`Schedule: Daily at 2:00 AM (${cronSchedule})`);

  const job = cron.schedule(cronSchedule, async () => {
    console.log('\n=== Starting scheduled rating refresh ===');
    console.log(`Time: ${new Date().toISOString()}`);

    try {
      await refreshAllClinicRatings();
    } catch (error) {
      console.error('Error in scheduled rating refresh:', error);
      // Don't crash the app, just log the error
    }

    console.log('=== Scheduled rating refresh completed ===\n');
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'America/New_York' // Use environment timezone or default to EST
  });

  console.log('Rating refresh cron job initialized successfully');
  
  return job;
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

module.exports = {
  initRatingRefreshJob,
  refreshAllClinicRatings,
  manualRefresh
};

