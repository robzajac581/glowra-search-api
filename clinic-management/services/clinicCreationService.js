const { db, sql } = require('../../db');
const draftService = require('./draftService');
const { normalizeCategory } = require('../../utils/categoryNormalizer');

/**
 * Service to convert approved drafts into actual Clinics, Providers, and Procedures
 */
class ClinicCreationService {
  /**
   * Create clinic from approved draft
   * @param {number} draftId - Draft ID to approve
   * @param {string} reviewedBy - User who approved
   * @returns {Promise<Object>} Created clinic data
   */
  async createClinicFromDraft(draftId, reviewedBy = null) {
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
      if (draft.DuplicateClinicID) {
        return await this.updateExistingClinic(draft, transaction, reviewedBy);
      }

      // Create new clinic
      const clinicRequest = new sql.Request(transaction);
      clinicRequest.input('clinicName', sql.NVarChar, draft.ClinicName);
      clinicRequest.input('address', sql.NVarChar, draft.Address);
      clinicRequest.input('phone', sql.NVarChar, draft.Phone);
      clinicRequest.input('website', sql.NVarChar, draft.Website);
      clinicRequest.input('latitude', sql.Decimal(10, 7), draft.Latitude || null);
      clinicRequest.input('longitude', sql.Decimal(11, 7), draft.Longitude || null);
      clinicRequest.input('placeID', sql.NVarChar, draft.PlaceID);

      const clinicResult = await clinicRequest.query(`
        INSERT INTO Clinics (
          ClinicName, Address, Phone, Website,
          Latitude, Longitude, PlaceID, LastRatingUpdate
        )
        OUTPUT INSERTED.ClinicID
        VALUES (
          @clinicName, @address, @phone, @website,
          @latitude, @longitude, @placeID, GETDATE()
        )
      `);

      const clinicId = clinicResult.recordset[0].ClinicID;

      // Get or create LocationID
      const locationId = await this.getOrCreateLocation(draft.City, draft.State, transaction);

      // Update clinic with LocationID
      await transaction.request()
        .input('clinicID', sql.Int, clinicId)
        .input('locationID', sql.Int, locationId)
        .query('UPDATE Clinics SET LocationID = @locationID WHERE ClinicID = @clinicID');

      // Create GooglePlacesData entry
      await this.createGooglePlacesData(clinicId, draft, transaction);

      // Create providers
      const providerMap = new Map();
      if (draft.providers && draft.providers.length > 0) {
        for (const providerData of draft.providers) {
          const providerId = await this.createProvider(clinicId, providerData, transaction);
          providerMap.set(providerData.ProviderName, providerId);
        }
      }

      // Create procedures
      if (draft.procedures && draft.procedures.length > 0) {
        for (const procedureData of draft.procedures) {
          const providerId = procedureData.ProviderName 
            ? providerMap.get(procedureData.ProviderName) 
            : null;
          
          // If no provider specified, use first provider or create placeholder
          const finalProviderId = providerId || (providerMap.size > 0 ? Array.from(providerMap.values())[0] : null);
          
          await this.createProcedure(finalProviderId, procedureData, transaction);
        }
      }

      // Update draft status
      await draftService.updateStatus(draftId, 'approved', reviewedBy);

      await transaction.commit();

      return {
        clinicId,
        clinicName: draft.ClinicName,
        status: 'approved'
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Update existing clinic (for merge scenarios)
   */
  async updateExistingClinic(draft, transaction, reviewedBy) {
    const clinicId = draft.DuplicateClinicID;
    const request = new sql.Request(transaction);

    // Update clinic fields
    const updates = [];
    if (draft.Phone) {
      updates.push('Phone = @phone');
      request.input('phone', sql.NVarChar, draft.Phone);
    }
    if (draft.Website) {
      updates.push('Website = @website');
      request.input('website', sql.NVarChar, draft.Website);
    }
    if (draft.Address) {
      updates.push('Address = @address');
      request.input('address', sql.NVarChar, draft.Address);
    }
    if (draft.PlaceID) {
      updates.push('PlaceID = @placeID');
      request.input('placeID', sql.NVarChar, draft.PlaceID);
    }
    if (draft.Latitude) {
      updates.push('Latitude = @latitude');
      request.input('latitude', sql.Decimal(10, 7), draft.Latitude);
    }
    if (draft.Longitude) {
      updates.push('Longitude = @longitude');
      request.input('longitude', sql.Decimal(11, 7), draft.Longitude);
    }

    if (updates.length > 0) {
      request.input('clinicID', sql.Int, clinicId);
      await request.query(`
        UPDATE Clinics
        SET ${updates.join(', ')}
        WHERE ClinicID = @clinicID
      `);
    }

    // Add new providers if they don't exist
    if (draft.providers && draft.providers.length > 0) {
      for (const providerData of draft.providers) {
        // Check if provider already exists
        const existingProvider = await transaction.request()
          .input('clinicID', sql.Int, clinicId)
          .input('providerName', sql.NVarChar, providerData.ProviderName)
          .query(`
            SELECT ProviderID FROM Providers
            WHERE ClinicID = @clinicID AND ProviderName = @providerName
          `);

        if (existingProvider.recordset.length === 0) {
          await this.createProvider(clinicId, providerData, transaction);
        }
      }
    }

    // Add new procedures
    if (draft.procedures && draft.procedures.length > 0) {
      // Get existing providers for this clinic
      const existingProviders = await transaction.request()
        .input('clinicID', sql.Int, clinicId)
        .query('SELECT ProviderID, ProviderName FROM Providers WHERE ClinicID = @clinicID');

      const providerMap = new Map();
      existingProviders.recordset.forEach(p => providerMap.set(p.ProviderName, p.ProviderID));

      for (const procedureData of draft.procedures) {
        const providerId = procedureData.ProviderName 
          ? providerMap.get(procedureData.ProviderName) 
          : (existingProviders.recordset[0]?.ProviderID || null);

        if (providerId) {
          await this.createProcedure(providerId, procedureData, transaction);
        }
      }
    }

    // Update draft status
    await draftService.updateStatus(draft.DraftID, 'merged', reviewedBy);

    return {
      clinicId,
      clinicName: draft.ClinicName,
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
   */
  async createProvider(clinicId, providerData, transaction) {
    const request = new sql.Request(transaction);
    request.input('clinicID', sql.Int, clinicId);
    request.input('providerName', sql.NVarChar, providerData.ProviderName);
    request.input('specialty', sql.NVarChar, providerData.Specialty || null);

    const result = await request.query(`
      INSERT INTO Providers (ClinicID, ProviderName)
      OUTPUT INSERTED.ProviderID
      VALUES (@clinicID, @providerName)
    `);

    const providerId = result.recordset[0].ProviderID;

    // If specialty provided, we'd need to link it via Procedures
    // For now, we'll handle specialty when creating procedures

    return providerId;
  }

  /**
   * Create procedure
   */
  async createProcedure(providerId, procedureData, transaction) {
    if (!providerId) {
      throw new Error('ProviderID is required to create procedure');
    }

    // Get or create CategoryID
    const categoryId = await this.getOrCreateCategory(procedureData.Category, transaction);

    // Get or create SpecialtyID (from provider's specialty if available)
    const specialtyId = await this.getOrCreateSpecialty(
      procedureData.ProviderName ? 'General' : 'General',
      transaction
    );

    const request = new sql.Request(transaction);
    request.input('providerID', sql.Int, providerId);
    request.input('procedureName', sql.NVarChar, procedureData.ProcedureName);
    request.input('categoryID', sql.Int, categoryId);
    request.input('specialtyID', sql.Int, specialtyId);
    request.input('averageCost', sql.Decimal(10, 2), procedureData.AverageCost || null);
    request.input('locationID', sql.Int, null); // Can be set later if needed

    await request.query(`
      INSERT INTO Procedures (
        ProviderID, ProcedureName, CategoryID, SpecialtyID,
        AverageCost, LocationID
      )
      VALUES (
        @providerID, @procedureName, @categoryID, @specialtyID,
        @averageCost, @locationID
      )
    `);
  }

  /**
   * Get or create category
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

    // Create new category
    const createRequest = new sql.Request(transaction);
    createRequest.input('category', sql.NVarChar, categoryName);

    const createResult = await createRequest.query(`
      INSERT INTO Categories (Category)
      OUTPUT INSERTED.CategoryID
      VALUES (@category)
    `);

    return createResult.recordset[0].CategoryID;
  }

  /**
   * Get or create specialty
   */
  async getOrCreateSpecialty(specialtyName, transaction) {
    const findRequest = new sql.Request(transaction);
    findRequest.input('specialty', sql.NVarChar, specialtyName);

    const findResult = await findRequest.query(`
      SELECT TOP 1 SpecialtyID
      FROM Specialties
      WHERE Specialty = @specialty
    `);

    if (findResult.recordset.length > 0) {
      return findResult.recordset[0].SpecialtyID;
    }

    // Create new specialty
    const createRequest = new sql.Request(transaction);
    createRequest.input('specialty', sql.NVarChar, specialtyName);

    const createResult = await createRequest.query(`
      INSERT INTO Specialties (Specialty)
      OUTPUT INSERTED.SpecialtyID
      VALUES (@specialty)
    `);

    return createResult.recordset[0].SpecialtyID;
  }

  /**
   * Create GooglePlacesData entry
   */
  async createGooglePlacesData(clinicId, draft, transaction) {
    const request = new sql.Request(transaction);
    request.input('clinicID', sql.Int, clinicId);
    request.input('placeID', sql.NVarChar, draft.PlaceID);
    request.input('businessName', sql.NVarChar, draft.ClinicName);
    request.input('fullAddress', sql.NVarChar, draft.Address);
    request.input('city', sql.NVarChar, draft.City);
    request.input('state', sql.NVarChar, draft.State);
    request.input('website', sql.NVarChar, draft.Website || null);
    request.input('email', sql.NVarChar, draft.Email || null);
    request.input('category', sql.NVarChar, normalizeCategory(draft.Category));

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

