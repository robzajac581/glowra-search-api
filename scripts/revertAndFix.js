const fs = require('fs');
const { sql, db } = require('../db');

async function revertAndFix() {
  let pool;
  
  try {
    const data = JSON.parse(fs.readFileSync('./scripts/matches-to-revert.json', 'utf8'));
    const wrongMatches = data.definitelyWrong;
    
    console.log('=== REVERTING INCORRECT MATCHES ===\n');
    console.log(`Found ${wrongMatches.length} incorrect matches to fix\n`);
    
    pool = await db.getConnection();
    
    // Get max ClinicID for new records
    const maxIdResult = await pool.request().query('SELECT MAX(ClinicID) as MaxID FROM Clinics');
    let nextClinicId = (maxIdResult.recordset[0].MaxID || 0) + 1;
    
    console.log(`Will create new clinic IDs starting from: ${nextClinicId}\n`);
    console.log('='.repeat(80));
    
    let reverted = 0;
    let created = 0;
    
    // Process each wrong match
    for (const match of wrongMatches) {
      const excelRow = match.excelRow;
      const excelName = match.excelName;
      const wrongDbId = match.dbId;
      
      console.log(`\n❌ REVERTING: "${excelName}"`);
      console.log(`   Was incorrectly matched to: "${match.dbName}" (ID: ${wrongDbId})`);
      console.log(`   Distance: ${match.distance ? match.distance.toFixed(0) + 'km apart' : 'N/A'}`);
      
      // Step 1: Delete the incorrect GooglePlacesData record if it was inserted
      // (We'll check by PlaceID since that's unique to the Excel data)
      try {
        const deleteResult = await pool.request()
          .input('placeId', sql.NVarChar, excelRow.place_id)
          .input('clinicId', sql.Int, wrongDbId)
          .query(`
            DELETE FROM GooglePlacesData 
            WHERE PlaceID = @placeId AND ClinicID = @clinicId
          `);
        
        if (deleteResult.rowsAffected[0] > 0) {
          console.log(`   ✅ Removed incorrect GooglePlacesData from clinic ${wrongDbId}`);
          reverted++;
        }
      } catch (err) {
        console.log(`   ⚠️  Could not remove GooglePlacesData: ${err.message}`);
      }
      
      // Step 2: Create NEW clinic with correct data
      const newClinicId = nextClinicId++;
      
      console.log(`   ➕ Creating as NEW clinic (ID: ${newClinicId})`);
      console.log(`   Location: ${excelRow.city}, ${excelRow.state}`);
      
      try {
        // Insert new clinic
        await pool.request()
          .input('clinicId', sql.Int, newClinicId)
          .input('clinicName', sql.NVarChar, excelName)
          .input('address', sql.NVarChar, excelRow.full_address)
          .input('placeId', sql.NVarChar, excelRow.place_id)
          .input('rating', sql.Decimal(2, 1), parseFloat(excelRow.rating) || null)
          .input('reviewCount', sql.Int, parseInt(excelRow.reviews) || null)
          .input('latitude', sql.Decimal(10, 7), parseFloat(excelRow.latitude) || null)
          .input('longitude', sql.Decimal(11, 7), parseFloat(excelRow.longitude) || null)
          .input('phone', sql.NVarChar, excelRow.phone)
          .input('website', sql.NVarChar, excelRow.site)
          .query(`
            INSERT INTO Clinics (
              ClinicID, ClinicName, Address, PlaceID, GoogleRating, GoogleReviewCount,
              Latitude, Longitude, Phone, Website, LastRatingUpdate
            )
            VALUES (
              @clinicId, @clinicName, @address, @placeId, @rating, @reviewCount,
              @latitude, @longitude, @phone, @website, GETDATE()
            )
          `);
        
        // Insert GooglePlacesData
        await pool.request()
          .input('clinicId', sql.Int, newClinicId)
          .input('placeId', sql.NVarChar, excelRow.place_id)
          .input('googleId', sql.NVarChar, excelRow.google_id)
          .input('cid', sql.NVarChar, excelRow.cid ? String(excelRow.cid) : null)
          .input('businessName', sql.NVarChar, excelRow['business name'])
          .input('fullAddress', sql.NVarChar, excelRow.full_address)
          .input('street', sql.NVarChar, excelRow.street)
          .input('city', sql.NVarChar, excelRow.city)
          .input('postalCode', sql.NVarChar, excelRow.postal_code)
          .input('state', sql.NVarChar, excelRow.state)
          .input('country', sql.NVarChar, excelRow.country)
          .input('website', sql.NVarChar, excelRow.site)
          .input('email', sql.NVarChar, excelRow.email_1)
          .input('facebook', sql.NVarChar, excelRow.facebook)
          .input('instagram', sql.NVarChar, excelRow.instagram)
          .input('linkedin', sql.NVarChar, excelRow.linkedin)
          .input('twitter', sql.NVarChar, excelRow.twitter)
          .input('youtube', sql.NVarChar, excelRow.youtube)
          .input('workingHours', sql.NVarChar, excelRow.working_hours)
          .input('businessStatus', sql.NVarChar, excelRow.business_status)
          .input('verified', sql.Bit, excelRow.verified === true || excelRow.verified === 'TRUE' ? 1 : 0)
          .input('photo', sql.NVarChar, excelRow.photo)
          .input('logo', sql.NVarChar, excelRow.logo)
          .input('streetView', sql.NVarChar, excelRow.street_view)
          .input('description', sql.NVarChar, excelRow.description)
          .input('aboutJSON', sql.NVarChar, excelRow.about)
          .input('subtypes', sql.NVarChar, excelRow.subtypes)
          .input('category', sql.NVarChar, excelRow.category)
          .input('googleProfileLink', sql.NVarChar, excelRow['google profile link'])
          .input('reviewsLink', sql.NVarChar, excelRow.reviews_link)
          .input('bookingLink', sql.NVarChar, excelRow.booking_appointment_link)
          .input('menuLink', sql.NVarChar, excelRow.menu_link)
          .query(`
            INSERT INTO GooglePlacesData (
              ClinicID, PlaceID, GoogleID, CID, BusinessName,
              FullAddress, Street, City, PostalCode, State, Country,
              Website, Email, Facebook, Instagram, LinkedIn, Twitter, YouTube,
              WorkingHours, BusinessStatus, Verified,
              Photo, Logo, StreetView, Description, AboutJSON,
              Subtypes, Category, GoogleProfileLink, ReviewsLink,
              BookingAppointmentLink, MenuLink
            ) VALUES (
              @clinicId, @placeId, @googleId, @cid, @businessName,
              @fullAddress, @street, @city, @postalCode, @state, @country,
              @website, @email, @facebook, @instagram, @linkedin, @twitter, @youtube,
              @workingHours, @businessStatus, @verified,
              @photo, @logo, @streetView, @description, @aboutJSON,
              @subtypes, @category, @googleProfileLink, @reviewsLink,
              @bookingLink, @menuLink
            )
          `);
        
        console.log(`   ✅ Created as clinic ID ${newClinicId}`);
        created++;
        
      } catch (err) {
        console.error(`   ❌ Error creating clinic: ${err.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 REVERSION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Incorrect matches reverted: ${reverted}`);
    console.log(`New clinics created: ${created}`);
    console.log(`\nOriginal clinics (${wrongMatches.map(m => m.dbId).join(', ')}) are now restored to their correct state`);
    console.log(`New separate clinics created with IDs: ${Array.from({length: created}, (_, i) => nextClinicId - created + i).join(', ')}`);
    
  } catch (error) {
    console.error('\n❌ Reversion failed:', error);
    throw error;
  } finally {
    if (pool) {
      await db.close();
    }
  }
}

revertAndFix();

