const XLSX = require('xlsx');
const { sql, db } = require('../db'); // Your existing db connection

async function importGoogleData(excelFilePath) {
  let pool;
  
  try {
    // Read Excel file
    console.log('Reading Excel file...');
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    
    console.log(`Found ${data.length} clinics to import`);
    
    pool = await db.getConnection();
    
    let matched = 0;
    let unmatched = 0;
    let updated = 0;
    
    for (const row of data) {
      try {
        // Find matching clinic by name or address
        const clinicResult = await pool.request()
          .input('businessName', sql.NVarChar, row['business name'])
          .input('address', sql.NVarChar, row['Provided Address'])
          .query(`
            SELECT TOP 1 ClinicID, ClinicName 
            FROM Clinics 
            WHERE ClinicName LIKE '%' + @businessName + '%'
               OR Address LIKE '%' + @address + '%'
          `);
        
        if (clinicResult.recordset.length === 0) {
          console.log(`❌ No match found for: ${row['business name']}`);
          unmatched++;
          continue;
        }
        
        const clinicId = clinicResult.recordset[0].ClinicID;
        matched++;
        
        // Update Clinics table with essential data
        await pool.request()
          .input('clinicId', sql.Int, clinicId)
          .input('placeId', sql.NVarChar, row.place_id)
          .input('rating', sql.Decimal(2, 1), parseFloat(row.rating) || null)
          .input('reviewCount', sql.Int, parseInt(row.reviews) || null)
          .input('latitude', sql.Decimal(10, 7), parseFloat(row.latitude) || null)
          .input('longitude', sql.Decimal(11, 7), parseFloat(row.longitude) || null)
          .input('phone', sql.NVarChar, row.phone)
          .query(`
            UPDATE Clinics 
            SET PlaceID = @placeId,
                GoogleRating = @rating,
                GoogleReviewCount = @reviewCount,
                Latitude = @latitude,
                Longitude = @longitude,
                Phone = @phone,
                LastRatingUpdate = GETDATE()
            WHERE ClinicID = @clinicId
          `);
        
        // Insert or update GooglePlacesData
        await pool.request()
          .input('clinicId', sql.Int, clinicId)
          .input('placeId', sql.NVarChar, row.place_id)
          .input('googleId', sql.NVarChar, row.google_id)
          .input('cid', sql.NVarChar, row.cid ? String(row.cid) : null)
          .input('businessName', sql.NVarChar, row['business name'])
          .input('fullAddress', sql.NVarChar, row.full_address)
          .input('street', sql.NVarChar, row.street)
          .input('city', sql.NVarChar, row.city)
          .input('postalCode', sql.NVarChar, row.postal_code)
          .input('state', sql.NVarChar, row.state)
          .input('country', sql.NVarChar, row.country)
          .input('website', sql.NVarChar, row.site)
          .input('email', sql.NVarChar, row.email_1)
          .input('facebook', sql.NVarChar, row.facebook)
          .input('instagram', sql.NVarChar, row.instagram)
          .input('linkedin', sql.NVarChar, row.linkedin)
          .input('twitter', sql.NVarChar, row.twitter)
          .input('youtube', sql.NVarChar, row.youtube)
          .input('workingHours', sql.NVarChar, row.working_hours)
          .input('businessStatus', sql.NVarChar, row.business_status)
          .input('verified', sql.Bit, row.verified === 'TRUE' ? 1 : 0)
          .input('photo', sql.NVarChar, row.photo)
          .input('logo', sql.NVarChar, row.logo)
          .input('streetView', sql.NVarChar, row.street_view)
          .input('description', sql.NVarChar, row.description)
          .input('aboutJSON', sql.NVarChar, row.about)
          .input('subtypes', sql.NVarChar, row.subtypes)
          .input('category', sql.NVarChar, row.category)
          .input('googleProfileLink', sql.NVarChar, row['google profile link'])
          .input('reviewsLink', sql.NVarChar, row.reviews_link)
          .input('bookingLink', sql.NVarChar, row.booking_appointment_link)
          .input('menuLink', sql.NVarChar, row.menu_link)
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
        console.log(`✅ Updated: ${row['business name']} (ID: ${clinicId})`);
        
      } catch (err) {
        console.error(`Error processing ${row['business name']}:`, err.message);
      }
    }
    
    console.log('\n=== Import Summary ===');
    console.log(`Total rows: ${data.length}`);
    console.log(`Matched & updated: ${updated}`);
    console.log(`Unmatched: ${unmatched}`);
    
  } catch (error) {
    console.error('Import failed:', error);
  } finally {
    if (pool) await pool.close();
  }
}

// Usage
const excelPath = process.argv[2] || './scripts/data/google_places_data.xlsx';
importGoogleData(excelPath);