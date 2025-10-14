const fs = require('fs');
const { sql, db } = require('../db');

async function consolidateData() {
  let pool;
  
  try {
    console.log('Reading matching report...');
    const report = JSON.parse(fs.readFileSync('./scripts/matching-report.json', 'utf8'));
    
    console.log('Connecting to database...');
    pool = await db.getConnection();
    
    let updated = 0;
    let created = 0;
    let skipped = 0;
    
    console.log('\n' + '='.repeat(80));
    console.log('PROCESSING MATCHES');
    console.log('='.repeat(80) + '\n');
    
    // Process matches - update existing clinics
    for (const match of report.matches) {
      const excelRow = match.excelRow;
      const excelName = match.excelName;
      let bestMatch = match.bestMatch;
      
      // Apply business logic to improve match selection
      // If confidence is low but there's a better alternative with similar name and same location, use that
      if (bestMatch.confidence < 60 && match.alternativeMatches.length > 0) {
        for (const alt of match.alternativeMatches) {
          // Check if alternative has better location match (same city) and good name match
          const altLocation = extractLocation(alt.dbClinic.Address);
          const excelCity = excelRow.city?.toLowerCase();
          const excelState = excelRow.state?.toLowerCase();
          
          if (alt.nameScore >= 80 && 
              excelCity && altLocation.city && 
              excelCity.includes(altLocation.city)) {
            console.log(`🔄 Switching match for "${excelName}"`);
            console.log(`   From: ${bestMatch.dbClinic.ClinicName} (${bestMatch.confidence}%)`);
            console.log(`   To: ${alt.dbClinic.ClinicName} (better location match)`);
            bestMatch = alt;
            break;
          }
        }
      }
      
      // Special case adjustments based on reviewing the output
      const clinicId = bestMatch.dbClinic.ClinicID;
      
      // Skip very low confidence matches that seem wrong
      if (bestMatch.confidence < 40 && bestMatch.nameScore < 85) {
        console.log(`⚠️  SKIP: "${excelName}" → "${bestMatch.dbClinic.ClinicName}"`);
        console.log(`   Confidence too low (${bestMatch.confidence}%), will create as new clinic\n`);
        
        // Add to noMatches for creation
        report.noMatches.push({
          excelRow,
          excelName,
          excelAddress: excelRow.full_address,
          city: excelRow.city,
          state: excelRow.state
        });
        skipped++;
        continue;
      }
      
      console.log(`✅ UPDATE: "${excelName}" → Clinic ID ${clinicId}`);
      console.log(`   DB Name: ${bestMatch.dbClinic.ClinicName}`);
      console.log(`   Confidence: ${bestMatch.confidence}%\n`);
      
      try {
        // Update Clinics table (Excel data as source of truth)
        await pool.request()
          .input('clinicId', sql.Int, clinicId)
          .input('placeId', sql.NVarChar, excelRow.place_id)
          .input('rating', sql.Decimal(2, 1), parseFloat(excelRow.rating) || null)
          .input('reviewCount', sql.Int, parseInt(excelRow.reviews) || null)
          .input('latitude', sql.Decimal(10, 7), parseFloat(excelRow.latitude) || null)
          .input('longitude', sql.Decimal(11, 7), parseFloat(excelRow.longitude) || null)
          .input('phone', sql.NVarChar, excelRow.phone)
          .input('address', sql.NVarChar, excelRow.full_address || bestMatch.dbClinic.Address)
          .input('website', sql.NVarChar, excelRow.site || bestMatch.dbClinic.Website)
          .query(`
            UPDATE Clinics 
            SET PlaceID = @placeId,
                GoogleRating = @rating,
                GoogleReviewCount = @reviewCount,
                Latitude = @latitude,
                Longitude = @longitude,
                Phone = @phone,
                Address = @address,
                Website = @website,
                LastRatingUpdate = GETDATE()
            WHERE ClinicID = @clinicId
          `);
        
        // Insert or update GooglePlacesData
        await pool.request()
          .input('clinicId', sql.Int, clinicId)
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
            IF EXISTS (SELECT 1 FROM GooglePlacesData WHERE ClinicID = @clinicId)
            BEGIN
              UPDATE GooglePlacesData 
              SET PlaceID = @placeId,
                  GoogleID = @googleId,
                  CID = @cid,
                  BusinessName = @businessName,
                  FullAddress = @fullAddress,
                  Street = @street,
                  City = @city,
                  PostalCode = @postalCode,
                  State = @state,
                  Country = @country,
                  Website = @website,
                  Email = @email,
                  Facebook = @facebook,
                  Instagram = @instagram,
                  LinkedIn = @linkedin,
                  Twitter = @twitter,
                  YouTube = @youtube,
                  WorkingHours = @workingHours,
                  BusinessStatus = @businessStatus,
                  Verified = @verified,
                  Photo = @photo,
                  Logo = @logo,
                  StreetView = @streetView,
                  Description = @description,
                  AboutJSON = @aboutJSON,
                  Subtypes = @subtypes,
                  Category = @category,
                  GoogleProfileLink = @googleProfileLink,
                  ReviewsLink = @reviewsLink,
                  BookingAppointmentLink = @bookingLink,
                  MenuLink = @menuLink,
                  LastUpdated = GETDATE()
              WHERE ClinicID = @clinicId
            END
            ELSE
            BEGIN
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
            END
          `);
        
        updated++;
        
      } catch (err) {
        console.error(`   ❌ Error updating clinic ID ${clinicId}:`, err.message);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('CREATING NEW CLINICS');
    console.log('='.repeat(80) + '\n');
    
    // Get max ClinicID for manual ID assignment
    const maxIdResult = await pool.request().query('SELECT MAX(ClinicID) as MaxID FROM Clinics');
    let nextClinicId = (maxIdResult.recordset[0].MaxID || 0) + 1;
    console.log(`Starting with ClinicID: ${nextClinicId}\n`);
    
    // Process non-matches - create new clinics
    for (const noMatch of report.noMatches) {
      const excelRow = noMatch.excelRow;
      const excelName = noMatch.excelName;
      
      // Skip undefined/empty rows
      if (!excelName || excelName === 'undefined') {
        console.log(`⚠️  SKIP: Empty or undefined clinic name\n`);
        continue;
      }
      
      console.log(`➕ CREATE: "${excelName}"`);
      console.log(`   Location: ${noMatch.city}, ${noMatch.state}\n`);
      
      try {
        // Insert new clinic with manual ClinicID
        const newClinicId = nextClinicId++;
        
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
        console.log(`   ✅ Created Clinic ID: ${newClinicId}`);
        
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
        
        created++;
        
      } catch (err) {
        console.error(`   ❌ Error creating clinic "${excelName}":`, err.message);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 CONSOLIDATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Clinics updated: ${updated}`);
    console.log(`Clinics created: ${created}`);
    console.log(`Skipped (low confidence): ${skipped}`);
    console.log(`Total processed: ${updated + created + skipped}`);
    
  } catch (error) {
    console.error('\n❌ Consolidation failed:', error);
    throw error;
  } finally {
    if (pool) {
      await db.close();
    }
  }
}

// Helper function (same as in analyzeUnmatched.js)
function extractLocation(address) {
  if (!address) return { city: '', state: '' };
  
  const parts = address.split(',').map(p => p.trim());
  
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const secondLastPart = parts[parts.length - 2];
    
    const stateMatch = lastPart.match(/\b([A-Z]{2})\b/) || 
                       secondLastPart.match(/\b([A-Z]{2})\b/);
    const state = stateMatch ? stateMatch[1] : '';
    
    const city = secondLastPart.replace(/\b[A-Z]{2}\b/, '').trim();
    
    return { city: city.toLowerCase(), state: state.toLowerCase() };
  }
  
  return { city: '', state: '' };
}

consolidateData();

