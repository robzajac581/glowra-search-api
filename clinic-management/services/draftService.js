const { db, sql } = require('../../db');
const { normalizeCategory } = require('../../utils/categoryNormalizer');
const { normalizeDraft, normalizeProviders, normalizeProcedures, normalizePhotos } = require('../../utils/responseNormalizer');

/**
 * Draft management service
 * Handles CRUD operations and status transitions for clinic drafts
 */
class DraftService {
  /**
   * Create a new draft
   */
  async createDraft(draftData) {
    const pool = await db.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();
      const request = new sql.Request(transaction);

      // Insert clinic draft
      request.input('clinicName', sql.NVarChar, draftData.clinicName);
      request.input('address', sql.NVarChar, draftData.address);
      request.input('city', sql.NVarChar, draftData.city);
      request.input('state', sql.NVarChar, draftData.state);
      request.input('zipCode', sql.NVarChar, draftData.zipCode || null);
      request.input('website', sql.NVarChar, draftData.website || null);
      request.input('phone', sql.NVarChar, draftData.phone || null);
      request.input('email', sql.NVarChar, draftData.email || null);
      request.input('latitude', sql.Decimal(10, 7), draftData.latitude || null);
      request.input('longitude', sql.Decimal(11, 7), draftData.longitude || null);
      request.input('placeID', sql.NVarChar, draftData.placeID || null);
      request.input('category', sql.NVarChar, normalizeCategory(draftData.category));
      request.input('status', sql.NVarChar, draftData.status || 'draft');
      request.input('source', sql.NVarChar, draftData.source || 'manual');
      request.input('submittedBy', sql.NVarChar, draftData.submittedBy || null);
      request.input('requestID', sql.UniqueIdentifier, draftData.requestID || null);
      request.input('duplicateClinicID', sql.Int, draftData.duplicateClinicID || null);
      request.input('notes', sql.NVarChar(sql.MAX), draftData.notes || null);

      const result = await request.query(`
        INSERT INTO ClinicDrafts (
          ClinicName, Address, City, State, ZipCode, Website, Phone, Email,
          Latitude, Longitude, PlaceID, Category, Status, Source,
          SubmittedBy, RequestID, DuplicateClinicID, Notes
        )
        OUTPUT INSERTED.DraftID, INSERTED.CreatedAt
        VALUES (
          @clinicName, @address, @city, @state, @zipCode, @website, @phone, @email,
          @latitude, @longitude, @placeID, @category, @status, @source,
          @submittedBy, @requestID, @duplicateClinicID, @notes
        )
      `);

      const draftId = result.recordset[0].DraftID;

      // Insert providers if provided
      if (draftData.providers && draftData.providers.length > 0) {
        for (const provider of draftData.providers) {
          const providerRequest = new sql.Request(transaction);
          providerRequest.input('draftID', sql.Int, draftId);
          providerRequest.input('providerName', sql.NVarChar, provider.providerName);
          providerRequest.input('specialty', sql.NVarChar, provider.specialty || null);

          await providerRequest.query(`
            INSERT INTO DraftProviders (DraftID, ProviderName, Specialty)
            VALUES (@draftID, @providerName, @specialty)
          `);
        }
      }

      // Insert procedures if provided
      if (draftData.procedures && draftData.procedures.length > 0) {
        for (const procedure of draftData.procedures) {
          const procedureRequest = new sql.Request(transaction);
          procedureRequest.input('draftID', sql.Int, draftId);
          procedureRequest.input('procedureName', sql.NVarChar, procedure.procedureName);
          procedureRequest.input('category', sql.NVarChar, procedure.category);
          procedureRequest.input('averageCost', sql.Decimal(10, 2), procedure.averageCost || null);
          procedureRequest.input('providerName', sql.NVarChar, procedure.providerName || null);

          await procedureRequest.query(`
            INSERT INTO DraftProcedures (DraftID, ProcedureName, Category, AverageCost, ProviderName)
            VALUES (@draftID, @procedureName, @category, @averageCost, @providerName)
          `);
        }
      }

      await transaction.commit();
      return await this.getDraftById(draftId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Get draft by ID with providers and procedures
   */
  async getDraftById(draftId) {
    const pool = await db.getConnection();
    const request = pool.request();
    request.input('draftID', sql.Int, draftId);

    const result = await request.query(`
      SELECT
        DraftID,
        RequestID,
        ClinicName,
        Address,
        City,
        State,
        ZipCode,
        Website,
        Phone,
        Email,
        Latitude,
        Longitude,
        PlaceID,
        Category,
        Status,
        Source,
        SubmittedBy,
        SubmitterKey,
        SubmissionFlow,
        SubmissionId,
        SubmittedAt,
        ReviewedBy,
        ReviewedAt,
        Notes,
        DuplicateClinicID,
        CreatedAt,
        UpdatedAt
      FROM ClinicDrafts
      WHERE DraftID = @draftID
    `);

    if (result.recordset.length === 0) {
      return null;
    }

    const draft = result.recordset[0];

    // Get providers (including photos and file metadata)
    const providersResult = await pool.request()
      .input('draftID', sql.Int, draftId)
      .query(`
        SELECT DraftProviderID, ProviderName, Specialty, PhotoURL, PhotoData, FileName, MimeType
        FROM DraftProviders
        WHERE DraftID = @draftID
      `);

    // Get procedures
    const proceduresResult = await pool.request()
      .input('draftID', sql.Int, draftId)
      .query(`
        SELECT 
          DraftProcedureID, 
          ProcedureName, 
          Category, 
          AverageCost,
          PriceMin,
          PriceMax,
          PriceUnit,
          ProviderName,
          ProviderNames
        FROM DraftProcedures
        WHERE DraftID = @draftID
      `);

    // Get photos (including PhotoData and Source for proper persistence)
    const photosResult = await pool.request()
      .input('draftID', sql.Int, draftId)
      .query(`
        SELECT 
          DraftPhotoID,
          PhotoType,
          PhotoData,
          PhotoURL,
          FileName,
          MimeType,
          FileSize,
          IsPrimary,
          DisplayOrder,
          Caption,
          Source,
          CreatedAt
        FROM DraftPhotos
        WHERE DraftID = @draftID
        ORDER BY DisplayOrder, CreatedAt
      `);

    // Normalize the response to camelCase for frontend consistency
    const normalizedDraft = normalizeDraft({
      ...draft,
      providers: normalizeProviders(providersResult.recordset),
      procedures: normalizeProcedures(proceduresResult.recordset),
      photos: normalizePhotos(photosResult.recordset)
    });

    return normalizedDraft;
  }

  /**
   * List drafts with filters
   */
  async listDrafts(filters = {}) {
    const pool = await db.getConnection();
    const request = pool.request();

    let query = `
      SELECT
        DraftID,
        RequestID,
        SubmissionId,
        ClinicName,
        Address,
        City,
        State,
        ZipCode,
        Website,
        Phone,
        Email,
        PlaceID,
        Category,
        Status,
        Source,
        SubmittedBy,
        SubmitterKey,
        SubmissionFlow,
        SubmittedAt,
        ReviewedBy,
        ReviewedAt,
        DuplicateClinicID,
        CreatedAt
      FROM ClinicDrafts
      WHERE 1=1
    `;

    if (filters.status) {
      request.input('status', sql.NVarChar, filters.status);
      query += ' AND Status = @status';
    }

    if (filters.source) {
      request.input('source', sql.NVarChar, filters.source);
      query += ' AND Source = @source';
    }

    if (filters.submitterKey) {
      request.input('submitterKey', sql.NVarChar, filters.submitterKey);
      query += ' AND SubmitterKey = @submitterKey';
    }

    if (filters.fromDate) {
      request.input('fromDate', sql.DateTime, filters.fromDate);
      query += ' AND SubmittedAt >= @fromDate';
    }

    if (filters.toDate) {
      request.input('toDate', sql.DateTime, filters.toDate);
      query += ' AND SubmittedAt <= @toDate';
    }

    query += ' ORDER BY SubmittedAt DESC';

    if (filters.limit) {
      request.input('limit', sql.Int, filters.limit);
      query += ' OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY';
    }

    const result = await request.query(query);
    
    // Normalize all drafts in the list to camelCase
    return result.recordset.map(draft => normalizeDraft(draft));
  }

  /**
   * Update draft
   */
  async updateDraft(draftId, updateData) {
    const pool = await db.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();
      const request = new sql.Request(transaction);

      const updates = [];
      const params = {};

      // Build dynamic update query
      if (updateData.clinicName !== undefined) {
        updates.push('ClinicName = @clinicName');
        request.input('clinicName', sql.NVarChar, updateData.clinicName);
      }
      if (updateData.address !== undefined) {
        updates.push('Address = @address');
        request.input('address', sql.NVarChar, updateData.address);
      }
      if (updateData.city !== undefined) {
        updates.push('City = @city');
        request.input('city', sql.NVarChar, updateData.city);
      }
      if (updateData.state !== undefined) {
        updates.push('State = @state');
        request.input('state', sql.NVarChar, updateData.state);
      }
      if (updateData.zipCode !== undefined) {
        updates.push('ZipCode = @zipCode');
        request.input('zipCode', sql.NVarChar, updateData.zipCode || null);
      }
      if (updateData.website !== undefined) {
        updates.push('Website = @website');
        request.input('website', sql.NVarChar, updateData.website || null);
      }
      if (updateData.phone !== undefined) {
        updates.push('Phone = @phone');
        request.input('phone', sql.NVarChar, updateData.phone || null);
      }
      if (updateData.email !== undefined) {
        updates.push('Email = @email');
        request.input('email', sql.NVarChar, updateData.email || null);
      }
      if (updateData.latitude !== undefined) {
        updates.push('Latitude = @latitude');
        request.input('latitude', sql.Decimal(10, 7), updateData.latitude || null);
      }
      if (updateData.longitude !== undefined) {
        updates.push('Longitude = @longitude');
        request.input('longitude', sql.Decimal(11, 7), updateData.longitude || null);
      }
      if (updateData.placeID !== undefined) {
        updates.push('PlaceID = @placeID');
        request.input('placeID', sql.NVarChar, updateData.placeID || null);
      }
      if (updateData.category !== undefined) {
        updates.push('Category = @category');
        request.input('category', sql.NVarChar, normalizeCategory(updateData.category));
      }
      if (updateData.status !== undefined) {
        updates.push('Status = @status');
        request.input('status', sql.NVarChar, updateData.status);
      }
      if (updateData.notes !== undefined) {
        updates.push('Notes = @notes');
        request.input('notes', sql.NVarChar(sql.MAX), updateData.notes || null);
      }

      updates.push('UpdatedAt = GETDATE()');

      request.input('draftID', sql.Int, draftId);

      await request.query(`
        UPDATE ClinicDrafts
        SET ${updates.join(', ')}
        WHERE DraftID = @draftID
      `);

      // Update providers if provided
      if (updateData.providers !== undefined) {
        // Delete existing providers
        await transaction.request()
          .input('draftID', sql.Int, draftId)
          .query('DELETE FROM DraftProviders WHERE DraftID = @draftID');

        // Insert new providers (including photo data)
        for (const provider of updateData.providers) {
          const providerRequest = new sql.Request(transaction);
          providerRequest.input('draftID', sql.Int, draftId);
          providerRequest.input('providerName', sql.NVarChar, provider.providerName);
          providerRequest.input('specialty', sql.NVarChar, provider.specialty || null);
          providerRequest.input('photoURL', sql.NVarChar, provider.photoUrl || provider.photoURL || null);
          providerRequest.input('photoData', sql.NVarChar(sql.MAX), provider.photoData || null);
          providerRequest.input('fileName', sql.NVarChar, provider.fileName || null);
          providerRequest.input('mimeType', sql.NVarChar, provider.mimeType || null);

          await providerRequest.query(`
            INSERT INTO DraftProviders (DraftID, ProviderName, Specialty, PhotoURL, PhotoData, FileName, MimeType)
            VALUES (@draftID, @providerName, @specialty, @photoURL, @photoData, @fileName, @mimeType)
          `);
        }
      }

      // Update procedures if provided
      if (updateData.procedures !== undefined) {
        // Delete existing procedures
        await transaction.request()
          .input('draftID', sql.Int, draftId)
          .query('DELETE FROM DraftProcedures WHERE DraftID = @draftID');

        // Insert new procedures
        for (const procedure of updateData.procedures) {
          const procedureRequest = new sql.Request(transaction);
          procedureRequest.input('draftID', sql.Int, draftId);
          procedureRequest.input('procedureName', sql.NVarChar, procedure.procedureName);
          procedureRequest.input('category', sql.NVarChar, procedure.category);
          procedureRequest.input('averageCost', sql.Decimal(10, 2), procedure.averageCost || null);
          procedureRequest.input('providerName', sql.NVarChar, procedure.providerName || null);

          await procedureRequest.query(`
            INSERT INTO DraftProcedures (DraftID, ProcedureName, Category, AverageCost, ProviderName)
            VALUES (@draftID, @procedureName, @category, @averageCost, @providerName)
          `);
        }
      }

      // Update photos if provided
      if (updateData.photos !== undefined) {
        // Delete existing photos
        await transaction.request()
          .input('draftID', sql.Int, draftId)
          .query('DELETE FROM DraftPhotos WHERE DraftID = @draftID');

        // Insert new photos
        for (let i = 0; i < updateData.photos.length; i++) {
          const photo = updateData.photos[i];
          const photoRequest = new sql.Request(transaction);
          photoRequest.input('draftID', sql.Int, draftId);
          photoRequest.input('photoType', sql.NVarChar, photo.photoType || 'clinic');
          photoRequest.input('photoData', sql.NVarChar(sql.MAX), photo.photoData || null);
          photoRequest.input('photoURL', sql.NVarChar, photo.photoUrl || photo.photoURL || null);
          photoRequest.input('fileName', sql.NVarChar, photo.fileName || null);
          photoRequest.input('mimeType', sql.NVarChar, photo.mimeType || null);
          photoRequest.input('fileSize', sql.Int, photo.fileSize || null);
          photoRequest.input('isPrimary', sql.Bit, photo.isPrimary ? 1 : 0);
          photoRequest.input('displayOrder', sql.Int, photo.displayOrder ?? i);
          photoRequest.input('caption', sql.NVarChar, photo.caption || null);
          photoRequest.input('source', sql.NVarChar, photo.source || 'user');

          await photoRequest.query(`
            INSERT INTO DraftPhotos (DraftID, PhotoType, PhotoData, PhotoURL, FileName, MimeType, FileSize, IsPrimary, DisplayOrder, Caption, Source)
            VALUES (@draftID, @photoType, @photoData, @photoURL, @fileName, @mimeType, @fileSize, @isPrimary, @displayOrder, @caption, @source)
          `);
        }
      }

      await transaction.commit();
      return await this.getDraftById(draftId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Update draft status
   */
  async updateStatus(draftId, status, reviewedBy = null) {
    const pool = await db.getConnection();
    const request = pool.request();
    request.input('draftID', sql.Int, draftId);
    request.input('status', sql.NVarChar, status);
    request.input('reviewedBy', sql.NVarChar, reviewedBy || null);

    await request.query(`
      UPDATE ClinicDrafts
      SET Status = @status,
          ReviewedBy = @reviewedBy,
          ReviewedAt = CASE WHEN @status IN ('approved', 'rejected', 'merged') THEN GETDATE() ELSE ReviewedAt END,
          UpdatedAt = GETDATE()
      WHERE DraftID = @draftID
    `);

    return await this.getDraftById(draftId);
  }

  /**
   * Check if draft has all required fields for approval
   * Only Category is truly required - others are optional but recommended
   * Note: Draft is now normalized to camelCase by getDraftById
   */
  async validateForApproval(draftId) {
    const draft = await this.getDraftById(draftId);
    if (!draft) {
      return { isValid: false, errors: ['Draft not found'] };
    }

    const errors = [];
    const warnings = [];
    
    // Truly required fields (camelCase to match normalized response)
    const requiredFields = ['category'];
    
    // Recommended but optional fields (camelCase)
    const recommendedFields = ['website', 'phone', 'email', 'placeId'];

    for (const field of requiredFields) {
      if (!draft[field] || String(draft[field]).trim() === '') {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    for (const field of recommendedFields) {
      if (!draft[field] || String(draft[field]).trim() === '') {
        warnings.push(`Missing recommended field: ${field}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      missingFields: errors.map(e => e.replace('Missing required field: ', ''))
    };
  }
}

module.exports = new DraftService();

