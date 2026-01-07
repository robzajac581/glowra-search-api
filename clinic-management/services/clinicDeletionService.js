/**
 * Clinic Deletion Service
 * Handles soft deletion, restoration, and permanent deletion of clinics
 */

const { db, sql } = require('../../db');

class ClinicDeletionService {
  /**
   * Soft delete a clinic by moving it to DeletedClinics table
   * @param {number} clinicId - Clinic ID to delete
   * @param {string} deletedBy - Admin email who deleted
   * @returns {Promise<Object>} Deletion result
   */
  async deleteClinic(clinicId, deletedBy) {
    const pool = await db.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // First, verify clinic exists
      const checkRequest = new sql.Request(transaction);
      checkRequest.input('clinicId', sql.Int, clinicId);
      const clinicCheck = await checkRequest.query(`
        SELECT 
          ClinicID, ClinicName, Address, Latitude, Longitude, PlaceID,
          GoogleRating, GoogleReviewCount, Phone, Website, LocationID,
          Providers, GoogleReviewsJSON, LastRatingUpdate
        FROM Clinics
        WHERE ClinicID = @clinicId
      `);

      if (clinicCheck.recordset.length === 0) {
        throw new Error('Clinic not found');
      }

      const clinic = clinicCheck.recordset[0];

      // Copy clinic to DeletedClinics
      const deleteRequest = new sql.Request(transaction);
      deleteRequest.input('originalClinicID', sql.Int, clinic.ClinicID);
      deleteRequest.input('clinicName', sql.NVarChar, clinic.ClinicName);
      deleteRequest.input('address', sql.NVarChar, clinic.Address);
      deleteRequest.input('latitude', sql.Decimal(10, 7), clinic.Latitude);
      deleteRequest.input('longitude', sql.Decimal(11, 7), clinic.Longitude);
      deleteRequest.input('placeID', sql.NVarChar, clinic.PlaceID);
      deleteRequest.input('googleRating', sql.Decimal(2, 1), clinic.GoogleRating);
      deleteRequest.input('googleReviewCount', sql.Int, clinic.GoogleReviewCount);
      deleteRequest.input('phone', sql.NVarChar, clinic.Phone);
      deleteRequest.input('website', sql.NVarChar, clinic.Website);
      deleteRequest.input('locationID', sql.Int, clinic.LocationID);
      deleteRequest.input('providers', sql.NVarChar(1000), clinic.Providers);
      deleteRequest.input('googleReviewsJSON', sql.NVarChar(sql.MAX), clinic.GoogleReviewsJSON);
      deleteRequest.input('lastRatingUpdate', sql.DateTime, clinic.LastRatingUpdate);
      deleteRequest.input('deletedBy', sql.NVarChar, deletedBy);

      const deletedResult = await deleteRequest.query(`
        INSERT INTO DeletedClinics (
          OriginalClinicID, ClinicName, Address, Latitude, Longitude, PlaceID,
          GoogleRating, GoogleReviewCount, Phone, Website, LocationID,
          Providers, GoogleReviewsJSON, LastRatingUpdate, DeletedBy
        )
        OUTPUT INSERTED.DeletedClinicID, INSERTED.DeletedAt
        VALUES (
          @originalClinicID, @clinicName, @address, @latitude, @longitude, @placeID,
          @googleRating, @googleReviewCount, @phone, @website, @locationID,
          @providers, @googleReviewsJSON, @lastRatingUpdate, @deletedBy
        )
      `);

      const deletedClinicId = deletedResult.recordset[0].DeletedClinicID;

      // Copy GooglePlacesData to DeletedGooglePlacesData
      const googleDataRequest = new sql.Request(transaction);
      googleDataRequest.input('clinicId', sql.Int, clinicId);
      const googleData = await googleDataRequest.query(`
        SELECT * FROM GooglePlacesData WHERE ClinicID = @clinicId
      `);

      if (googleData.recordset.length > 0) {
        const googleRecord = googleData.recordset[0];
        const insertGoogleRequest = new sql.Request(transaction);
        insertGoogleRequest.input('deletedClinicID', sql.Int, deletedClinicId);
        insertGoogleRequest.input('originalClinicID', sql.Int, clinicId);
        insertGoogleRequest.input('placeID', sql.NVarChar, googleRecord.PlaceID);
        insertGoogleRequest.input('googleID', sql.NVarChar, googleRecord.GoogleID);
        insertGoogleRequest.input('cid', sql.BigInt, googleRecord.CID);
        insertGoogleRequest.input('businessName', sql.NVarChar(500), googleRecord.BusinessName);
        insertGoogleRequest.input('fullAddress', sql.NVarChar(500), googleRecord.FullAddress);
        insertGoogleRequest.input('street', sql.NVarChar(500), googleRecord.Street);
        insertGoogleRequest.input('city', sql.NVarChar(100), googleRecord.City);
        insertGoogleRequest.input('postalCode', sql.NVarChar(20), googleRecord.PostalCode);
        insertGoogleRequest.input('state', sql.NVarChar(100), googleRecord.State);
        insertGoogleRequest.input('country', sql.NVarChar(100), googleRecord.Country);
        insertGoogleRequest.input('website', sql.NVarChar(500), googleRecord.Website);
        insertGoogleRequest.input('email', sql.NVarChar(255), googleRecord.Email);
        insertGoogleRequest.input('facebook', sql.NVarChar(500), googleRecord.Facebook);
        insertGoogleRequest.input('instagram', sql.NVarChar(500), googleRecord.Instagram);
        insertGoogleRequest.input('linkedIn', sql.NVarChar(500), googleRecord.LinkedIn);
        insertGoogleRequest.input('twitter', sql.NVarChar(500), googleRecord.Twitter);
        insertGoogleRequest.input('youTube', sql.NVarChar(500), googleRecord.YouTube);
        insertGoogleRequest.input('workingHours', sql.NVarChar(sql.MAX), googleRecord.WorkingHours);
        insertGoogleRequest.input('businessStatus', sql.NVarChar(50), googleRecord.BusinessStatus);
        insertGoogleRequest.input('verified', sql.Bit, googleRecord.Verified);
        insertGoogleRequest.input('photo', sql.NVarChar(1000), googleRecord.Photo);
        insertGoogleRequest.input('logo', sql.NVarChar(1000), googleRecord.Logo);
        insertGoogleRequest.input('streetView', sql.NVarChar(1000), googleRecord.StreetView);
        insertGoogleRequest.input('description', sql.NVarChar(sql.MAX), googleRecord.Description);
        insertGoogleRequest.input('aboutJSON', sql.NVarChar(sql.MAX), googleRecord.AboutJSON);
        insertGoogleRequest.input('subtypes', sql.NVarChar(500), googleRecord.Subtypes);
        insertGoogleRequest.input('category', sql.NVarChar(200), googleRecord.Category);
        insertGoogleRequest.input('googleProfileLink', sql.NVarChar(1000), googleRecord.GoogleProfileLink);
        insertGoogleRequest.input('reviewsLink', sql.NVarChar(1000), googleRecord.ReviewsLink);
        insertGoogleRequest.input('bookingAppointmentLink', sql.NVarChar(1000), googleRecord.BookingAppointmentLink);
        insertGoogleRequest.input('menuLink', sql.NVarChar(1000), googleRecord.MenuLink);
        insertGoogleRequest.input('lastUpdated', sql.DateTime, googleRecord.LastUpdated);

        await insertGoogleRequest.query(`
          INSERT INTO DeletedGooglePlacesData (
            DeletedClinicID, OriginalClinicID, PlaceID, GoogleID, CID, BusinessName,
            FullAddress, Street, City, PostalCode, State, Country,
            Website, Email, Facebook, Instagram, LinkedIn, Twitter, YouTube,
            WorkingHours, BusinessStatus, Verified,
            Photo, Logo, StreetView,
            Description, AboutJSON, Subtypes, Category,
            GoogleProfileLink, ReviewsLink, BookingAppointmentLink, MenuLink,
            LastUpdated
          )
          VALUES (
            @deletedClinicID, @originalClinicID, @placeID, @googleID, @cid, @businessName,
            @fullAddress, @street, @city, @postalCode, @state, @country,
            @website, @email, @facebook, @instagram, @linkedIn, @twitter, @youTube,
            @workingHours, @businessStatus, @verified,
            @photo, @logo, @streetView,
            @description, @aboutJSON, @subtypes, @category,
            @googleProfileLink, @reviewsLink, @bookingAppointmentLink, @menuLink,
            @lastUpdated
          )
        `);
      }

      // Copy ClinicPhotos to DeletedClinicPhotos
      const photosRequest = new sql.Request(transaction);
      photosRequest.input('clinicId', sql.Int, clinicId);
      const photos = await photosRequest.query(`
        SELECT * FROM ClinicPhotos WHERE ClinicID = @clinicId
      `);

      for (const photo of photos.recordset) {
        const insertPhotoRequest = new sql.Request(transaction);
        insertPhotoRequest.input('deletedClinicID', sql.Int, deletedClinicId);
        insertPhotoRequest.input('originalClinicID', sql.Int, clinicId);
        insertPhotoRequest.input('photoReference', sql.NVarChar(1000), photo.PhotoReference);
        insertPhotoRequest.input('photoURL', sql.NVarChar(2000), photo.PhotoURL);
        insertPhotoRequest.input('width', sql.Int, photo.Width);
        insertPhotoRequest.input('height', sql.Int, photo.Height);
        insertPhotoRequest.input('attributionText', sql.NVarChar(500), photo.AttributionText);
        insertPhotoRequest.input('attributionURL', sql.NVarChar(1000), photo.AttributionURL);
        insertPhotoRequest.input('isPrimary', sql.Bit, photo.IsPrimary);
        insertPhotoRequest.input('displayOrder', sql.Int, photo.DisplayOrder);
        insertPhotoRequest.input('lastUpdated', sql.DateTime, photo.LastUpdated);

        await insertPhotoRequest.query(`
          INSERT INTO DeletedClinicPhotos (
            DeletedClinicID, OriginalClinicID, PhotoReference, PhotoURL, Width, Height,
            AttributionText, AttributionURL, IsPrimary, DisplayOrder, LastUpdated
          )
          VALUES (
            @deletedClinicID, @originalClinicID, @photoReference, @photoURL, @width, @height,
            @attributionText, @attributionURL, @isPrimary, @displayOrder, @lastUpdated
          )
        `);
      }

      // Handle foreign key constraints - set ClinicDrafts.DuplicateClinicID to NULL
      const updateDraftsRequest = new sql.Request(transaction);
      updateDraftsRequest.input('clinicId', sql.Int, clinicId);
      await updateDraftsRequest.query(`
        UPDATE ClinicDrafts
        SET DuplicateClinicID = NULL
        WHERE DuplicateClinicID = @clinicId
      `);

      // Delete from original tables (GooglePlacesData has no CASCADE, ClinicPhotos has CASCADE)
      const deleteGoogleRequest = new sql.Request(transaction);
      deleteGoogleRequest.input('clinicId', sql.Int, clinicId);
      await deleteGoogleRequest.query(`
        DELETE FROM GooglePlacesData WHERE ClinicID = @clinicId
      `);

      // ClinicPhotos will be deleted automatically due to CASCADE, but we've already copied them

      // Finally, delete the clinic
      const deleteClinicRequest = new sql.Request(transaction);
      deleteClinicRequest.input('clinicId', sql.Int, clinicId);
      await deleteClinicRequest.query(`
        DELETE FROM Clinics WHERE ClinicID = @clinicId
      `);

      await transaction.commit();

      return {
        success: true,
        deletedClinicId,
        deletedAt: deletedResult.recordset[0].DeletedAt,
        clinicName: clinic.ClinicName
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Restore a deleted clinic
   * @param {number} deletedClinicId - Deleted clinic ID
   * @returns {Promise<Object>} Restored clinic data
   */
  async restoreClinic(deletedClinicId) {
    const pool = await db.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Get deleted clinic data
      const getDeletedRequest = new sql.Request(transaction);
      getDeletedRequest.input('deletedClinicID', sql.Int, deletedClinicId);
      const deletedClinic = await getDeletedRequest.query(`
        SELECT * FROM DeletedClinics WHERE DeletedClinicID = @deletedClinicID
      `);

      if (deletedClinic.recordset.length === 0) {
        throw new Error('Deleted clinic not found');
      }

      const deleted = deletedClinic.recordset[0];

      // Check if original ClinicID is available
      const checkOriginalRequest = new sql.Request(transaction);
      checkOriginalRequest.input('originalClinicID', sql.Int, deleted.OriginalClinicID);
      const originalCheck = await checkOriginalRequest.query(`
        SELECT ClinicID FROM Clinics WHERE ClinicID = @originalClinicID
      `);

      // Get next available ClinicID
      const maxIdRequest = new sql.Request(transaction);
      const maxIdResult = await maxIdRequest.query(`
        SELECT ISNULL(MAX(ClinicID), 0) + 1 AS NextID FROM Clinics
      `);
      const newClinicId = originalCheck.recordset.length === 0 
        ? deleted.OriginalClinicID 
        : maxIdResult.recordset[0].NextID;

      // Restore clinic
      const restoreRequest = new sql.Request(transaction);
      restoreRequest.input('clinicID', sql.Int, newClinicId);
      restoreRequest.input('clinicName', sql.NVarChar, deleted.ClinicName);
      restoreRequest.input('address', sql.NVarChar, deleted.Address);
      restoreRequest.input('latitude', sql.Decimal(10, 7), deleted.Latitude);
      restoreRequest.input('longitude', sql.Decimal(11, 7), deleted.Longitude);
      restoreRequest.input('placeID', sql.NVarChar, deleted.PlaceID);
      restoreRequest.input('googleRating', sql.Decimal(2, 1), deleted.GoogleRating);
      restoreRequest.input('googleReviewCount', sql.Int, deleted.GoogleReviewCount);
      restoreRequest.input('phone', sql.NVarChar, deleted.Phone);
      restoreRequest.input('website', sql.NVarChar, deleted.Website);
      restoreRequest.input('locationID', sql.Int, deleted.LocationID);
      restoreRequest.input('providers', sql.NVarChar(1000), deleted.Providers);
      restoreRequest.input('googleReviewsJSON', sql.NVarChar(sql.MAX), deleted.GoogleReviewsJSON);
      restoreRequest.input('lastRatingUpdate', sql.DateTime, deleted.LastRatingUpdate);

      await restoreRequest.query(`
        INSERT INTO Clinics (
          ClinicID, ClinicName, Address, Latitude, Longitude, PlaceID,
          GoogleRating, GoogleReviewCount, Phone, Website, LocationID,
          Providers, GoogleReviewsJSON, LastRatingUpdate
        )
        VALUES (
          @clinicID, @clinicName, @address, @latitude, @longitude, @placeID,
          @googleRating, @googleReviewCount, @phone, @website, @locationID,
          @providers, @googleReviewsJSON, @lastRatingUpdate
        )
      `);

      // Restore GooglePlacesData
      const getGoogleRequest = new sql.Request(transaction);
      getGoogleRequest.input('deletedClinicID', sql.Int, deletedClinicId);
      const googleData = await getGoogleRequest.query(`
        SELECT * FROM DeletedGooglePlacesData WHERE DeletedClinicID = @deletedClinicID
      `);

      if (googleData.recordset.length > 0) {
        const google = googleData.recordset[0];
        const restoreGoogleRequest = new sql.Request(transaction);
        restoreGoogleRequest.input('clinicID', sql.Int, newClinicId);
        restoreGoogleRequest.input('placeID', sql.NVarChar, google.PlaceID);
        restoreGoogleRequest.input('googleID', sql.NVarChar, google.GoogleID);
        restoreGoogleRequest.input('cid', sql.BigInt, google.CID);
        restoreGoogleRequest.input('businessName', sql.NVarChar(500), google.BusinessName);
        restoreGoogleRequest.input('fullAddress', sql.NVarChar(500), google.FullAddress);
        restoreGoogleRequest.input('street', sql.NVarChar(500), google.Street);
        restoreGoogleRequest.input('city', sql.NVarChar(100), google.City);
        restoreGoogleRequest.input('postalCode', sql.NVarChar(20), google.PostalCode);
        restoreGoogleRequest.input('state', sql.NVarChar(100), google.State);
        restoreGoogleRequest.input('country', sql.NVarChar(100), google.Country);
        restoreGoogleRequest.input('website', sql.NVarChar(500), google.Website);
        restoreGoogleRequest.input('email', sql.NVarChar(255), google.Email);
        restoreGoogleRequest.input('facebook', sql.NVarChar(500), google.Facebook);
        restoreGoogleRequest.input('instagram', sql.NVarChar(500), google.Instagram);
        restoreGoogleRequest.input('linkedIn', sql.NVarChar(500), google.LinkedIn);
        restoreGoogleRequest.input('twitter', sql.NVarChar(500), google.Twitter);
        restoreGoogleRequest.input('youTube', sql.NVarChar(500), google.YouTube);
        restoreGoogleRequest.input('workingHours', sql.NVarChar(sql.MAX), google.WorkingHours);
        restoreGoogleRequest.input('businessStatus', sql.NVarChar(50), google.BusinessStatus);
        restoreGoogleRequest.input('verified', sql.Bit, google.Verified);
        restoreGoogleRequest.input('photo', sql.NVarChar(1000), google.Photo);
        restoreGoogleRequest.input('logo', sql.NVarChar(1000), google.Logo);
        restoreGoogleRequest.input('streetView', sql.NVarChar(1000), google.StreetView);
        restoreGoogleRequest.input('description', sql.NVarChar(sql.MAX), google.Description);
        restoreGoogleRequest.input('aboutJSON', sql.NVarChar(sql.MAX), google.AboutJSON);
        restoreGoogleRequest.input('subtypes', sql.NVarChar(500), google.Subtypes);
        restoreGoogleRequest.input('category', sql.NVarChar(200), google.Category);
        restoreGoogleRequest.input('googleProfileLink', sql.NVarChar(1000), google.GoogleProfileLink);
        restoreGoogleRequest.input('reviewsLink', sql.NVarChar(1000), google.ReviewsLink);
        restoreGoogleRequest.input('bookingAppointmentLink', sql.NVarChar(1000), google.BookingAppointmentLink);
        restoreGoogleRequest.input('menuLink', sql.NVarChar(1000), google.MenuLink);
        restoreGoogleRequest.input('lastUpdated', sql.DateTime, google.LastUpdated);

        await restoreGoogleRequest.query(`
          INSERT INTO GooglePlacesData (
            ClinicID, PlaceID, GoogleID, CID, BusinessName,
            FullAddress, Street, City, PostalCode, State, Country,
            Website, Email, Facebook, Instagram, LinkedIn, Twitter, YouTube,
            WorkingHours, BusinessStatus, Verified,
            Photo, Logo, StreetView,
            Description, AboutJSON, Subtypes, Category,
            GoogleProfileLink, ReviewsLink, BookingAppointmentLink, MenuLink,
            LastUpdated
          )
          VALUES (
            @clinicID, @placeID, @googleID, @cid, @businessName,
            @fullAddress, @street, @city, @postalCode, @state, @country,
            @website, @email, @facebook, @instagram, @linkedIn, @twitter, @youTube,
            @workingHours, @businessStatus, @verified,
            @photo, @logo, @streetView,
            @description, @aboutJSON, @subtypes, @category,
            @googleProfileLink, @reviewsLink, @bookingAppointmentLink, @menuLink,
            @lastUpdated
          )
        `);
      }

      // Restore ClinicPhotos
      const getPhotosRequest = new sql.Request(transaction);
      getPhotosRequest.input('deletedClinicID', sql.Int, deletedClinicId);
      const photos = await getPhotosRequest.query(`
        SELECT * FROM DeletedClinicPhotos WHERE DeletedClinicID = @deletedClinicID
      `);

      for (const photo of photos.recordset) {
        const restorePhotoRequest = new sql.Request(transaction);
        restorePhotoRequest.input('clinicID', sql.Int, newClinicId);
        restorePhotoRequest.input('photoReference', sql.NVarChar(1000), photo.PhotoReference);
        restorePhotoRequest.input('photoURL', sql.NVarChar(2000), photo.PhotoURL);
        restorePhotoRequest.input('width', sql.Int, photo.Width);
        restorePhotoRequest.input('height', sql.Int, photo.Height);
        restorePhotoRequest.input('attributionText', sql.NVarChar(500), photo.AttributionText);
        restorePhotoRequest.input('attributionURL', sql.NVarChar(1000), photo.AttributionURL);
        restorePhotoRequest.input('isPrimary', sql.Bit, photo.IsPrimary);
        restorePhotoRequest.input('displayOrder', sql.Int, photo.DisplayOrder);
        restorePhotoRequest.input('lastUpdated', sql.DateTime, photo.LastUpdated);

        await restorePhotoRequest.query(`
          INSERT INTO ClinicPhotos (
            ClinicID, PhotoReference, PhotoURL, Width, Height,
            AttributionText, AttributionURL, IsPrimary, DisplayOrder, LastUpdated
          )
          VALUES (
            @clinicID, @photoReference, @photoURL, @width, @height,
            @attributionText, @attributionURL, @isPrimary, @displayOrder, @lastUpdated
          )
        `);
      }

      // Delete from Deleted* tables (cascade will handle related records)
      const deleteDeletedRequest = new sql.Request(transaction);
      deleteDeletedRequest.input('deletedClinicID', sql.Int, deletedClinicId);
      await deleteDeletedRequest.query(`
        DELETE FROM DeletedClinics WHERE DeletedClinicID = @deletedClinicID
      `);

      await transaction.commit();

      return {
        success: true,
        clinicId: newClinicId,
        clinicName: deleted.ClinicName,
        restoredAt: new Date()
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Get list of deleted clinics with pagination and search
   * @param {Object} filters - Filter options
   * @param {number} filters.page - Page number (default: 1)
   * @param {number} filters.limit - Results per page (default: 20)
   * @param {string} filters.search - Search term
   * @returns {Promise<Object>} Paginated list of deleted clinics
   */
  async getDeletedClinics(filters = {}) {
    const pool = await db.getConnection();
    const { page = 1, limit = 20, search } = filters;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    const request = pool.request();
    request.input('limit', sql.Int, limitNum);
    request.input('offset', sql.Int, offset);

    let whereClause = '';
    if (search && search.trim()) {
      request.input('searchTerm', sql.NVarChar, `%${search.trim()}%`);
      whereClause = `
        WHERE 
          ClinicName LIKE @searchTerm
          OR Address LIKE @searchTerm
          OR DeletedBy LIKE @searchTerm
      `;
    }

    // Get deleted clinics with pagination
    const clinicsResult = await request.query(`
      SELECT 
        DeletedClinicID as id,
        OriginalClinicID as originalClinicId,
        ClinicName as clinicName,
        Address as address,
        Phone as phone,
        Website as website,
        GoogleRating as rating,
        GoogleReviewCount as reviewCount,
        DeletedAt as deletedAt,
        DeletedBy as deletedBy
      FROM DeletedClinics
      ${whereClause}
      ORDER BY DeletedAt DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    // Get total count
    const countRequest = pool.request();
    if (search && search.trim()) {
      countRequest.input('searchTerm', sql.NVarChar, `%${search.trim()}%`);
    }
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM DeletedClinics
      ${whereClause}
    `);

    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limitNum);

    return {
      clinics: clinicsResult.recordset,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    };
  }

  /**
   * Permanently delete clinics older than 30 days
   * Called by scheduled job
   * @returns {Promise<Object>} Deletion summary
   */
  async permanentlyDeleteOldClinics() {
    const pool = await db.getConnection();
    
    try {
      // Find clinics older than 30 days
      const findRequest = pool.request();
      const oldClinics = await findRequest.query(`
        SELECT DeletedClinicID, ClinicName, DeletedAt
        FROM DeletedClinics
        WHERE DeletedAt < DATEADD(day, -30, GETDATE())
      `);

      const count = oldClinics.recordset.length;

      if (count === 0) {
        return {
          deleted: 0,
          message: 'No clinics to permanently delete'
        };
      }

      // Delete old clinics (cascade will handle related records)
      const deleteRequest = pool.request();
      const deleteResult = await deleteRequest.query(`
        DELETE FROM DeletedClinics
        WHERE DeletedAt < DATEADD(day, -30, GETDATE())
      `);

      return {
        deleted: deleteResult.rowsAffected[0],
        message: `Permanently deleted ${deleteResult.rowsAffected[0]} clinic(s)`
      };
    } catch (error) {
      console.error('Error permanently deleting old clinics:', error);
      throw error;
    }
  }
}

module.exports = new ClinicDeletionService();

