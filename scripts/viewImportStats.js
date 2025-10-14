const { db } = require('../db');

async function viewImportStats() {
  let pool;
  
  try {
    pool = await db.getConnection();
    
    // Overall stats
    console.log('=== IMPORT STATISTICS ===\n');
    
    const overallStats = await pool.request().query(`
      SELECT 
        COUNT(*) as TotalClinics,
        SUM(CASE WHEN PlaceID IS NOT NULL THEN 1 ELSE 0 END) as WithGoogleData,
        SUM(CASE WHEN PlaceID IS NULL THEN 1 ELSE 0 END) as WithoutGoogleData,
        AVG(CASE WHEN GoogleRating > 0 THEN GoogleRating ELSE NULL END) as AvgRating,
        SUM(GoogleReviewCount) as TotalReviews
      FROM Clinics
    `);
    
    const stats = overallStats.recordset[0];
    console.log(`Total Clinics: ${stats.TotalClinics}`);
    console.log(`With Google Data: ${stats.WithGoogleData} (${Math.round(stats.WithGoogleData / stats.TotalClinics * 100)}%)`);
    console.log(`Without Google Data: ${stats.WithoutGoogleData} (${Math.round(stats.WithoutGoogleData / stats.TotalClinics * 100)}%)`);
    console.log(`Average Rating: ${stats.AvgRating ? stats.AvgRating.toFixed(2) : 'N/A'}★`);
    console.log(`Total Reviews: ${stats.TotalReviews || 0}`);
    
    // Top rated clinics
    console.log('\n=== TOP 10 RATED CLINICS ===\n');
    
    const topRated = await pool.request().query(`
      SELECT TOP 10
        ClinicName,
        GoogleRating,
        GoogleReviewCount,
        Phone
      FROM Clinics
      WHERE GoogleRating IS NOT NULL
      ORDER BY GoogleRating DESC, GoogleReviewCount DESC
    `);
    
    topRated.recordset.forEach((clinic, index) => {
      console.log(`${index + 1}. ${clinic.ClinicName}`);
      console.log(`   Rating: ${clinic.GoogleRating}★ (${clinic.GoogleReviewCount} reviews)`);
      console.log(`   Phone: ${clinic.Phone || 'N/A'}\n`);
    });
    
    // Most reviewed
    console.log('=== MOST REVIEWED CLINICS ===\n');
    
    const mostReviewed = await pool.request().query(`
      SELECT TOP 10
        ClinicName,
        GoogleRating,
        GoogleReviewCount,
        PlaceID
      FROM Clinics
      WHERE GoogleReviewCount IS NOT NULL
      ORDER BY GoogleReviewCount DESC
    `);
    
    mostReviewed.recordset.forEach((clinic, index) => {
      console.log(`${index + 1}. ${clinic.ClinicName}`);
      console.log(`   ${clinic.GoogleReviewCount} reviews | ${clinic.GoogleRating}★\n`);
    });
    
    // Google Places Data table stats
    console.log('=== GOOGLE PLACES DATA TABLE ===\n');
    
    const googleDataStats = await pool.request().query(`
      SELECT COUNT(*) as TotalRecords FROM GooglePlacesData
    `);
    
    console.log(`Total GooglePlacesData records: ${googleDataStats.recordset[0].TotalRecords}`);
    
    // Sample rich data
    console.log('\n=== SAMPLE RICH DATA (Top Clinic) ===\n');
    
    const sampleData = await pool.request().query(`
      SELECT TOP 1
        c.ClinicName,
        g.Website,
        g.Instagram,
        g.Facebook,
        g.WorkingHours,
        g.Description
      FROM Clinics c
      JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      ORDER BY c.GoogleReviewCount DESC
    `);
    
    if (sampleData.recordset.length > 0) {
      const sample = sampleData.recordset[0];
      console.log(`Clinic: ${sample.ClinicName}`);
      console.log(`Website: ${sample.Website || 'N/A'}`);
      console.log(`Instagram: ${sample.Instagram || 'N/A'}`);
      console.log(`Facebook: ${sample.Facebook || 'N/A'}`);
      console.log(`Working Hours: ${sample.WorkingHours ? JSON.parse(sample.WorkingHours).Monday : 'N/A'}`);
      console.log(`Description: ${sample.Description ? sample.Description.substring(0, 100) + '...' : 'N/A'}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (pool) {
      await db.close();
    }
  }
}

viewImportStats();

