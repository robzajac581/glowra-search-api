const { db, sql } = require('../../db');
const draftService = require('./draftService');
const { normalizeCategory } = require('../../utils/categoryNormalizer');
const { fetchGooglePlaceDetails, fetchPlacePhotos } = require('../../utils/googlePlaces');

/**
 * Service to convert approved drafts into actual Clinics, Providers, and Procedures
 */
class ClinicCreationService {
  /**
   * Create clinic from approved draft
   * @param {number} draftId - Draft ID to approve
   * @param {Object} options - Approval options
   * @param {string} options.reviewedBy - User who approved
   * @param {string} options.photoSource - 'user' | 'google' | 'both'
   * @param {string} options.ratingSource - 'google' | 'manual'
   * @param {number} options.manualRating - Manual rating (if ratingSource is 'manual')
   * @param {number} options.manualReviewCount - Manual review count (if ratingSource is 'manual')
   * @returns {Promise<Object>} Created clinic data
   */
  async createClinicFromDraft(draftId, options = {}) {
    const {
      reviewedBy = null,
      photoSource = 'user',
      ratingSource = 'google',
      manualRating = null,
      manualReviewCount = null
    } = typeof options === 'string' ? { reviewedBy: options } : options;

    const draft = await draftService.getDraftById(draftId);
    if (!draft) {
      throw new Error('Draft not found');
    }

    // Validate draft has all required fields
    const validation = await draftService.validateForApproval(draftId);
    if (!validation.isValid) {
      throw new Error(`Draft missing required fields: ${validation.errors.join(', ')}`);
    }

    const pool = await db.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Check if this is an update to existing clinic (merge scenario)
      // Note: draft is now normalized to camelCase by draftService.getDraftById
      if (draft.duplicateClinicId) {
        const result = await this.updateExistingClinic(draft, transaction, reviewedBy, { photoSource, ratingSource, manualRating, manualReviewCount });
        await transaction.commit();
        return result;
      }

      // Fetch Google data if needed for ratings
      // Note: draft is now normalized to camelCase by draftService.getDraftById
      let googleRating = null;
      let googleReviewCount = null;
      let googleReviews = null;
      
      if (ratingSource === 'google' && draft.placeId) {
        try {
          const googleData = await fetchGooglePlaceDetails(draft.placeId, false);
          if (googleData) {
            googleRating = googleData.rating;
            googleReviewCount = googleData.reviewCount;
            googleReviews = googleData.reviews;
          }
        } catch (error) {
          console.warn('Failed to fetch Google rating, using draft values:', error.message);
          googleRating = draft.googleRating;
          googleReviewCount = draft.googleReviewCount;
        }
      } else if (ratingSource === 'manual') {
        googleRating = manualRating;
        googleReviewCount = manualReviewCount;
      }

      // Create new clinic
      // Note: ClinicID is NOT an IDENTITY column, so we need to manually get the next ID
      const maxIdRequest = new sql.Request(transaction);
      const maxIdResult = await maxIdRequest.query(`
        SELECT ISNULL(MAX(ClinicID), 0) + 1 AS NextID FROM Clinics
      `);
      const clinicId = maxIdResult.recordset[0].NextID;

      const clinicRequest = new sql.Request(transaction);
      clinicRequest.input('clinicID', sql.Int, clinicId);
      clinicRequest.input('clinicName', sql.NVarChar, draft.clinicName);
      clinicRequest.input('address', sql.NVarChar, draft.address);
      clinicRequest.input('phone', sql.NVarChar, draft.phone || null);
      clinicRequest.input('website', sql.NVarChar, draft.website || null);
      clinicRequest.input('latitude', sql.Decimal(10, 7), draft.latitude || null);
      clinicRequest.input('longitude', sql.Decimal(11, 7), draft.longitude || null);
      clinicRequest.input('placeID', sql.NVarChar, draft.placeId || null);
      clinicRequest.input('googleRating', sql.Decimal(2, 1), googleRating);
      clinicRequest.input('googleReviewCount', sql.Int, googleReviewCount);
      clinicRequest.input('googleReviewsJSON', sql.NVarChar(sql.MAX), googleReviews ? JSON.stringify(googleReviews) : null);

      await clinicRequest.query(`
        INSERT INTO Clinics (
          ClinicID, ClinicName, Address, Phone, Website,
          Latitude, Longitude, PlaceID, GoogleRating, GoogleReviewCount,
          GoogleReviewsJSON, LastRatingUpdate
        )
        VALUES (
          @clinicID, @clinicName, @address, @phone, @website,
          @latitude, @longitude, @placeID, @googleRating, @googleReviewCount,
          @googleReviewsJSON, GETDATE()
        )
      `);

      // Get or create LocationID
      const locationId = await this.getOrCreateLocation(draft.city, draft.state, transaction);

      // Update clinic with LocationID
      await transaction.request()
        .input('clinicID', sql.Int, clinicId)
        .input('locationID', sql.Int, locationId)
        .query('UPDATE Clinics SET LocationID = @locationID WHERE ClinicID = @clinicID');

      // Create GooglePlacesData entry
      await this.createGooglePlacesData(clinicId, draft, transaction);

      // Handle photos based on photoSource
      await this.handlePhotos(clinicId, draft, photoSource, transaction);

      // Create providers and store their IDs
      // Note: draft.providers is now normalized to camelCase
      const providerMap = new Map(); // Maps provider name to provider ID
      if (draft.providers && draft.providers.length > 0) {
        for (const providerData of draft.providers) {
          const providerId = await this.createProvider(clinicId, providerData, transaction);
          providerMap.set(providerData.providerName, providerId);
        }
      }

      // Create procedures
      // Note: draft.procedures is now normalized to camelCase
      if (draft.procedures && draft.procedures.length > 0) {
        for (const procedureData of draft.procedures) {
          // Get provider ID
          let providerId = procedureData.providerName 
            ? providerMap.get(procedureData.providerName) 
            : null;
          
          // If no provider specified, use first provider
          if (!providerId && providerMap.size > 0) {
            providerId = Array.from(providerMap.values())[0];
          }
          
          await this.createProcedure(providerId, procedureData, transaction);
        }
      }

      // Update draft status
      await draftService.updateStatus(draftId, 'approved', reviewedBy);

      await transaction.commit();

      return {
        clinicId,
        clinicName: draft.clinicName,
        status: 'approved'
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Handle photos based on photoSource option
   * @param {number} clinicId - Clinic ID
   * @param {Object} draft - Draft object with photos (now normalized to camelCase)
   * @param {string} photoSource - 'user' | 'google' | 'both'
   * @param {Object} transaction - SQL transaction
   */
  async handlePhotos(clinicId, draft, photoSource, transaction) {
    // Note: draft.photos is now normalized to camelCase
    const userPhotos = draft.photos ? draft.photos.filter(p => p.source !== 'google') : [];
    let displayOrder = 0;

    // Add user photos first if using 'user' or 'both'
    if ((photoSource === 'user' || photoSource === 'both') && userPhotos.length > 0) {
      for (const photo of userPhotos) {
        const request = new sql.Request(transaction);
        request.input('clinicId', sql.Int, clinicId);
        request.input('photoURL', sql.NVarChar(2000), photo.photoUrl);
        request.input('isPrimary', sql.Bit, displayOrder === 0 ? 1 : 0);
        request.input('displayOrder', sql.Int, displayOrder);
        request.input('photoType', sql.NVarChar(50), photo.photoType || 'clinic');

        await request.query(`
          INSERT INTO ClinicPhotos (ClinicID, PhotoURL, IsPrimary, DisplayOrder, LastUpdated)
          VALUES (@clinicId, @photoURL, @isPrimary, @displayOrder, GETDATE())
        `);
        
        displayOrder++;
      }
    }

    // Add Google photos if using 'google' or 'both'
    if ((photoSource === 'google' || photoSource === 'both') && draft.placeId) {
      try {
        const googlePhotos = await fetchPlacePhotos(draft.placeId);
        
        // Limit Google photos based on source
        const maxGooglePhotos = photoSource === 'both' ? 5 : 10;
        const photosToAdd = googlePhotos.slice(0, maxGooglePhotos);

        for (const photo of photosToAdd) {
          const request = new sql.Request(transaction);
          request.input('clinicId', sql.Int, clinicId);
          request.input('photoReference', sql.NVarChar(1000), photo.reference);
          request.input('photoURL', sql.NVarChar(2000), photo.urls?.large || photo.url);
          request.input('width', sql.Int, photo.width);
          request.input('height', sql.Int, photo.height);
          request.input('isPrimary', sql.Bit, displayOrder === 0 ? 1 : 0);
          request.input('displayOrder', sql.Int, displayOrder);

          await request.query(`
            INSERT INTO ClinicPhotos (ClinicID, PhotoReference, PhotoURL, Width, Height, IsPrimary, DisplayOrder, LastUpdated)
            VALUES (@clinicId, @photoReference, @photoURL, @width, @height, @isPrimary, @displayOrder, GETDATE())
          `);
          
          displayOrder++;
        }
      } catch (error) {
        console.warn('Failed to fetch Google photos:', error.message);
        // Continue without Google photos
      }
    }

    // Update GooglePlacesData.Photo with primary photo URL
    if (displayOrder > 0) {
      const primaryPhotoResult = await transaction.request()
        .input('clinicId', sql.Int, clinicId)
        .query(`
          SELECT TOP 1 PhotoURL FROM ClinicPhotos 
          WHERE ClinicID = @clinicId 
          ORDER BY IsPrimary DESC, DisplayOrder ASC
        `);

      if (primaryPhotoResult.recordset.length > 0) {
        await transaction.request()
          .input('clinicId', sql.Int, clinicId)
          .input('photoURL', sql.NVarChar(2000), primaryPhotoResult.recordset[0].PhotoURL)
          .query(`
            UPDATE GooglePlacesData SET Photo = @photoURL WHERE ClinicID = @clinicId
          `);
      }
    }
  }

  /**
   * Update existing clinic (for merge scenarios)
   * Note: draft is now normalized to camelCase by draftService.getDraftById
   */
  async updateExistingClinic(draft, transaction, reviewedBy) {
    const clinicId = draft.duplicateClinicId;
    const request = new sql.Request(transaction);

    // Update clinic fields (using camelCase from normalized draft)
    const updates = [];
    if (draft.phone) {
      updates.push('Phone = @phone');
      request.input('phone', sql.NVarChar, draft.phone);
    }
    if (draft.website) {
      updates.push('Website = @website');
      request.input('website', sql.NVarChar, draft.website);
    }
    if (draft.address) {
      updates.push('Address = @address');
      request.input('address', sql.NVarChar, draft.address);
    }
    if (draft.placeId) {
      updates.push('PlaceID = @placeID');
      request.input('placeID', sql.NVarChar, draft.placeId);
    }
    if (draft.latitude) {
      updates.push('Latitude = @latitude');
      request.input('latitude', sql.Decimal(10, 7), draft.latitude);
    }
    if (draft.longitude) {
      updates.push('Longitude = @longitude');
      request.input('longitude', sql.Decimal(11, 7), draft.longitude);
    }

    if (updates.length > 0) {
      request.input('clinicID', sql.Int, clinicId);
      await request.query(`
        UPDATE Clinics
        SET ${updates.join(', ')}
        WHERE ClinicID = @clinicID
      `);
    }

    // Add new providers if they don't exist (using camelCase from normalized draft)
    if (draft.providers && draft.providers.length > 0) {
      for (const providerData of draft.providers) {
        // Check if provider already exists
        const existingProvider = await transaction.request()
          .input('clinicID', sql.Int, clinicId)
          .input('providerName', sql.NVarChar, providerData.providerName)
          .query(`
            SELECT ProviderID FROM Providers
            WHERE ClinicID = @clinicID AND ProviderName = @providerName
          `);

        if (existingProvider.recordset.length === 0) {
          await this.createProvider(clinicId, providerData, transaction);
        }
      }
    }

    // Add new procedures (using camelCase from normalized draft)
    if (draft.procedures && draft.procedures.length > 0) {
      // Get existing providers for this clinic
      const existingProviders = await transaction.request()
        .input('clinicID', sql.Int, clinicId)
        .query('SELECT ProviderID, ProviderName FROM Providers WHERE ClinicID = @clinicID');

      const providerMap = new Map();
      existingProviders.recordset.forEach(p => providerMap.set(p.ProviderName, p.ProviderID));

      for (const procedureData of draft.procedures) {
        const providerId = procedureData.providerName 
          ? providerMap.get(procedureData.providerName) 
          : (existingProviders.recordset[0]?.ProviderID || null);

        if (providerId) {
          await this.createProcedure(providerId, procedureData, transaction);
        }
      }
    }

    // Update draft status
    await draftService.updateStatus(draft.draftId, 'merged', reviewedBy);

    return {
      clinicId,
      clinicName: draft.clinicName,
      status: 'merged'
    };
  }

  /**
   * Get or create location
   */
  async getOrCreateLocation(city, state, transaction) {
    // Try to find existing location
    const findRequest = new sql.Request(transaction);
    findRequest.input('city', sql.NVarChar, city);
    findRequest.input('state', sql.NVarChar, state);

    const findResult = await findRequest.query(`
      SELECT TOP 1 LocationID
      FROM Locations
      WHERE City = @city AND State = @state
    `);

    if (findResult.recordset.length > 0) {
      return findResult.recordset[0].LocationID;
    }

    // Create new location
    const createRequest = new sql.Request(transaction);
    createRequest.input('city', sql.NVarChar, city);
    createRequest.input('state', sql.NVarChar, state);

    const createResult = await createRequest.query(`
      INSERT INTO Locations (City, State)
      OUTPUT INSERTED.LocationID
      VALUES (@city, @state)
    `);

    return createResult.recordset[0].LocationID;
  }

  /**
   * Create provider
   * Accepts both camelCase (from normalized draft) and PascalCase (for backward compatibility)
   */
  async createProvider(clinicId, providerData, transaction) {
    const request = new sql.Request(transaction);
    request.input('clinicID', sql.Int, clinicId);
    // Support both camelCase and PascalCase for backward compatibility
    request.input('providerName', sql.NVarChar, providerData.providerName || providerData.ProviderName);
    request.input('photoURL', sql.NVarChar, providerData.photoUrl || providerData.PhotoURL || null);

    const result = await request.query(`
      INSERT INTO Providers (ClinicID, ProviderName, PhotoURL)
      OUTPUT INSERTED.ProviderID
      VALUES (@clinicID, @providerName, @photoURL)
    `);

    return result.recordset[0].ProviderID;
  }

  /**
   * Create procedure
   * Note: ProcedureID is NOT an IDENTITY column, so we need to manually get the next ID
   * Accepts both camelCase (from normalized draft) and PascalCase (for backward compatibility)
   * @param {number} providerId - Provider ID
   * @param {Object} procedureData - Procedure data
   * @param {Object} transaction - SQL transaction
   */
  async createProcedure(providerId, procedureData, transaction) {
    if (!providerId) {
      throw new Error('ProviderID is required to create procedure');
    }

    // Support both camelCase and PascalCase for backward compatibility
    const category = procedureData.category || procedureData.Category;
    const procedureName = procedureData.procedureName || procedureData.ProcedureName;
    const averageCost = procedureData.averageCost || procedureData.AverageCost;

    // Get or create CategoryID
    const categoryId = await this.getOrCreateCategory(category, transaction);

    // ProcedureID is NOT an IDENTITY column, so we need to manually get the next ID
    const maxIdRequest = new sql.Request(transaction);
    const maxIdResult = await maxIdRequest.query(`
      SELECT ISNULL(MAX(ProcedureID), 0) + 1 AS NextID FROM Procedures
    `);
    const procedureId = maxIdResult.recordset[0].NextID;

    const request = new sql.Request(transaction);
    request.input('procedureID', sql.Int, procedureId);
    request.input('providerID', sql.Int, providerId);
    request.input('procedureName', sql.NVarChar, procedureName);
    request.input('categoryID', sql.Int, categoryId);
    request.input('averageCost', sql.Decimal(10, 2), averageCost || null);
    request.input('locationID', sql.Int, null); // Can be set later if needed

    await request.query(`
      INSERT INTO Procedures (
        ProcedureID, ProviderID, ProcedureName, CategoryID,
        AverageCost, LocationID
      )
      VALUES (
        @procedureID, @providerID, @procedureName, @categoryID,
        @averageCost, @locationID
      )
    `);
  }

  /**
   * Get or create category
   * Note: CategoryID may NOT be an IDENTITY column, so we handle both cases
   */
  async getOrCreateCategory(categoryName, transaction) {
    const findRequest = new sql.Request(transaction);
    findRequest.input('category', sql.NVarChar, categoryName);

    const findResult = await findRequest.query(`
      SELECT TOP 1 CategoryID
      FROM Categories
      WHERE Category = @category
    `);

    if (findResult.recordset.length > 0) {
      return findResult.recordset[0].CategoryID;
    }

    // CategoryID may not be an IDENTITY column, so we manually get the next ID
    const maxIdRequest = new sql.Request(transaction);
    const maxIdResult = await maxIdRequest.query(`
      SELECT ISNULL(MAX(CategoryID), 0) + 1 AS NextID FROM Categories
    `);
    const nextCategoryId = maxIdResult.recordset[0].NextID;

    // Create new category with manually generated ID
    const createRequest = new sql.Request(transaction);
    createRequest.input('categoryId', sql.Int, nextCategoryId);
    createRequest.input('category', sql.NVarChar, categoryName);

    await createRequest.query(`
      INSERT INTO Categories (CategoryID, Category)
      VALUES (@categoryId, @category)
    `);

    return nextCategoryId;
  }

  /**
   * Create GooglePlacesData entry
   * Note: draft is now normalized to camelCase by draftService.getDraftById
   */
  async createGooglePlacesData(clinicId, draft, transaction) {
    const request = new sql.Request(transaction);
    request.input('clinicID', sql.Int, clinicId);
    request.input('placeID', sql.NVarChar, draft.placeId);
    request.input('businessName', sql.NVarChar, draft.clinicName);
    request.input('fullAddress', sql.NVarChar, draft.address);
    request.input('city', sql.NVarChar, draft.city);
    request.input('state', sql.NVarChar, draft.state);
    request.input('website', sql.NVarChar, draft.website || null);
    request.input('email', sql.NVarChar, draft.email || null);
    request.input('category', sql.NVarChar, normalizeCategory(draft.category));

    await request.query(`
      INSERT INTO GooglePlacesData (
        ClinicID, PlaceID, BusinessName, FullAddress,
        City, State, Website, Email, Category
      )
      VALUES (
        @clinicID, @placeID, @businessName, @fullAddress,
        @city, @state, @website, @email, @category
      )
    `);
  }
}

module.exports = new ClinicCreationService();

