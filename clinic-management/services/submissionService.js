/**
 * Submission Service
 * Handles the "List Your Clinic" wizard form submissions
 */

const { db, sql } = require('../../db');
const draftService = require('./draftService');
const duplicateDetectionService = require('./duplicateDetectionService');
const { validateSubmission, calculateAveragePrice } = require('../utils/schemaValidator');
const { normalizeCategory } = require('../../utils/categoryNormalizer');

class SubmissionService {
  /**
   * Generate a unique submission ID (e.g., GLW-2024-0042)
   * @returns {Promise<string>} Unique submission ID
   */
  async generateSubmissionId() {
    const pool = await db.getConnection();
    const year = new Date().getFullYear();
    
    // Get the highest submission number for this year
    const result = await pool.request()
      .input('pattern', sql.NVarChar, `GLW-${year}-%`)
      .query(`
        SELECT TOP 1 SubmissionId 
        FROM ClinicDrafts 
        WHERE SubmissionId LIKE @pattern
        ORDER BY DraftID DESC
      `);
    
    let nextNumber = 1;
    if (result.recordset.length > 0) {
      const lastId = result.recordset[0].SubmissionId;
      const lastNumber = parseInt(lastId.split('-')[2], 10);
      nextNumber = lastNumber + 1;
    }
    
    return `GLW-${year}-${String(nextNumber).padStart(4, '0')}`;
  }

  /**
   * Process a complete wizard submission
   * @param {object} submission - Full submission payload
   * @returns {Promise<object>} Result with submissionId, draftId, status, duplicateWarning
   */
  async processSubmission(submission) {
    // Validate the submission
    const validation = validateSubmission(submission);
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors
      };
    }

    const pool = await db.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Generate submission ID
      const submissionId = await this.generateSubmissionId();

      // Check for duplicates (for new clinic flow)
      let duplicateWarning = null;
      if (submission.flow === 'new_clinic' && submission.clinic) {
        const duplicateCheck = await duplicateDetectionService.checkDuplicates({
          clinicName: submission.clinic.clinicName,
          address: submission.clinic.address,
          city: submission.clinic.city,
          state: submission.clinic.state,
          phone: submission.clinic.phone,
          website: submission.clinic.website,
          placeID: submission.clinic.placeID
        });

        if (duplicateCheck.hasDuplicates) {
          duplicateWarning = {
            message: 'We found a potential match',
            existingClinic: duplicateCheck.matches[0] ? {
              id: duplicateCheck.matches[0].clinicId,
              name: duplicateCheck.matches[0].clinicName,
              address: duplicateCheck.matches[0].address,
              city: duplicateCheck.matches[0].city,
              state: duplicateCheck.matches[0].state
            } : null,
            confidence: duplicateCheck.matches[0]?.confidence || 'medium',
            matchReason: duplicateCheck.matches[0]?.matchReason
          };
        }
      }

      // Create the draft
      const draftData = this.buildDraftData(submission, submissionId);
      
      // Insert clinic draft with advanced fields
      const request = new sql.Request(transaction);
      request.input('clinicName', sql.NVarChar, draftData.clinicName);
      request.input('address', sql.NVarChar, draftData.address);
      request.input('city', sql.NVarChar, draftData.city);
      request.input('state', sql.NVarChar, draftData.state);
      request.input('zipCode', sql.NVarChar, draftData.zipCode || null);
      request.input('website', sql.NVarChar, draftData.website || null);
      request.input('phone', sql.NVarChar, draftData.phone || null);
      request.input('email', sql.NVarChar, draftData.email || null);
      request.input('category', sql.NVarChar, normalizeCategory(draftData.category));
      request.input('status', sql.NVarChar, 'pending_review');
      request.input('source', sql.NVarChar, 'wizard');
      request.input('submittedBy', sql.NVarChar, draftData.submitterKey || null);
      request.input('submitterKey', sql.NVarChar, draftData.submitterKey || null);
      request.input('submissionFlow', sql.NVarChar, submission.flow);
      request.input('submissionId', sql.NVarChar, submissionId);
      request.input('duplicateClinicID', sql.Int, submission.existingClinicId || null);
      request.input('notes', sql.NVarChar(sql.MAX), duplicateWarning ? `Potential duplicate detected: ${JSON.stringify(duplicateWarning)}` : null);
      
      // Advanced fields
      const advanced = submission.advanced || {};
      request.input('latitude', sql.Decimal(10, 7), advanced.latitude || null);
      request.input('longitude', sql.Decimal(11, 7), advanced.longitude || null);
      request.input('placeID', sql.NVarChar, advanced.placeID || null);
      request.input('description', sql.NVarChar(sql.MAX), advanced.description || null);
      request.input('bookingURL', sql.NVarChar, advanced.bookingURL || null);
      request.input('googleProfileLink', sql.NVarChar, advanced.googleProfileLink || null);
      request.input('facebook', sql.NVarChar, advanced.facebook || null);
      request.input('instagram', sql.NVarChar, advanced.instagram || null);
      request.input('linkedin', sql.NVarChar, advanced.linkedin || null);
      request.input('twitter', sql.NVarChar, advanced.twitter || null);
      request.input('youtube', sql.NVarChar, advanced.youtube || null);
      request.input('workingHours', sql.NVarChar(sql.MAX), 
        advanced.workingHours ? JSON.stringify(advanced.workingHours) : null);

      const draftResult = await request.query(`
        INSERT INTO ClinicDrafts (
          ClinicName, Address, City, State, ZipCode, Website, Phone, Email,
          Category, Status, Source, SubmittedBy, SubmitterKey, SubmissionFlow,
          SubmissionId, DuplicateClinicID, Notes,
          Latitude, Longitude, PlaceID, Description, BookingURL, GoogleProfileLink,
          Facebook, Instagram, LinkedIn, Twitter, YouTube, WorkingHours
        )
        OUTPUT INSERTED.DraftID
        VALUES (
          @clinicName, @address, @city, @state, @zipCode, @website, @phone, @email,
          @category, @status, @source, @submittedBy, @submitterKey, @submissionFlow,
          @submissionId, @duplicateClinicID, @notes,
          @latitude, @longitude, @placeID, @description, @bookingURL, @googleProfileLink,
          @facebook, @instagram, @linkedin, @twitter, @youtube, @workingHours
        )
      `);

      const draftId = draftResult.recordset[0].DraftID;

      // Insert photos
      if (submission.photos && submission.photos.length > 0) {
        for (const photo of submission.photos) {
          const photoRequest = new sql.Request(transaction);
          photoRequest.input('draftID', sql.Int, draftId);
          photoRequest.input('photoType', sql.NVarChar, photo.photoType || 'clinic');
          photoRequest.input('photoData', sql.NVarChar(sql.MAX), photo.photoData || null);
          photoRequest.input('photoURL', sql.NVarChar, photo.photoURL || null);
          photoRequest.input('fileName', sql.NVarChar, photo.fileName || null);
          photoRequest.input('mimeType', sql.NVarChar, photo.mimeType || null);
          photoRequest.input('fileSize', sql.Int, photo.fileSize || null);
          photoRequest.input('isPrimary', sql.Bit, photo.isPrimary ? 1 : 0);
          photoRequest.input('displayOrder', sql.Int, photo.displayOrder || 0);
          photoRequest.input('caption', sql.NVarChar, photo.caption || null);

          await photoRequest.query(`
            INSERT INTO DraftPhotos (
              DraftID, PhotoType, PhotoData, PhotoURL, FileName, MimeType,
              FileSize, IsPrimary, DisplayOrder, Caption
            )
            VALUES (
              @draftID, @photoType, @photoData, @photoURL, @fileName, @mimeType,
              @fileSize, @isPrimary, @displayOrder, @caption
            )
          `);
        }
      }

      // Insert providers (with optional photos)
      if (submission.providers && submission.providers.length > 0) {
        for (const provider of submission.providers) {
          if (provider.providerName) {
            const providerRequest = new sql.Request(transaction);
            providerRequest.input('draftID', sql.Int, draftId);
            providerRequest.input('providerName', sql.NVarChar, provider.providerName);
            providerRequest.input('specialty', sql.NVarChar, provider.specialty || null);
            providerRequest.input('photoURL', sql.NVarChar, provider.photoURL || null);
            providerRequest.input('photoData', sql.NVarChar(sql.MAX), provider.photoData || null);

            await providerRequest.query(`
              INSERT INTO DraftProviders (DraftID, ProviderName, Specialty, PhotoURL, PhotoData)
              VALUES (@draftID, @providerName, @specialty, @photoURL, @photoData)
            `);
          }
        }
      }

      // Insert procedures
      if (submission.procedures && submission.procedures.length > 0) {
        for (const procedure of submission.procedures) {
          if (procedure.procedureName) {
            const avgPrice = calculateAveragePrice(procedure);
            
            const procedureRequest = new sql.Request(transaction);
            procedureRequest.input('draftID', sql.Int, draftId);
            procedureRequest.input('procedureName', sql.NVarChar, procedure.procedureName);
            procedureRequest.input('category', sql.NVarChar, procedure.category);
            procedureRequest.input('averageCost', sql.Decimal(10, 2), avgPrice);
            procedureRequest.input('priceMin', sql.Decimal(10, 2), procedure.priceMin || null);
            procedureRequest.input('priceMax', sql.Decimal(10, 2), procedure.priceMax || null);
            procedureRequest.input('priceUnit', sql.NVarChar, procedure.unit || null);
            procedureRequest.input('providerNames', sql.NVarChar(sql.MAX), 
              procedure.providerNames ? JSON.stringify(procedure.providerNames) : null);
            procedureRequest.input('providerName', sql.NVarChar, 
              procedure.providerNames && procedure.providerNames.length > 0 
                ? procedure.providerNames[0] 
                : null);

            await procedureRequest.query(`
              INSERT INTO DraftProcedures (
                DraftID, ProcedureName, Category, AverageCost, 
                PriceMin, PriceMax, PriceUnit, ProviderNames, ProviderName
              )
              VALUES (
                @draftID, @procedureName, @category, @averageCost,
                @priceMin, @priceMax, @priceUnit, @providerNames, @providerName
              )
            `);
          }
        }
      }

      await transaction.commit();

      return {
        success: true,
        submissionId,
        draftId,
        status: 'pending_review',
        message: "Submission received. We'll review it within 1-2 business days.",
        duplicateWarning
      };

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Build draft data from submission payload
   * @param {object} submission - Submission payload
   * @param {string} submissionId - Generated submission ID
   * @returns {object} Draft data
   */
  buildDraftData(submission, submissionId) {
    if (submission.flow === 'new_clinic') {
      return {
        ...submission.clinic,
        submitterKey: submission.submitterKey || null,
        submissionId
      };
    } else {
      // For add_to_existing, we need to fetch the existing clinic data
      // For now, use placeholder data that will be filled from the existing clinic
      return {
        clinicName: 'Existing Clinic Update',
        address: 'See existing clinic',
        city: 'See existing clinic',
        state: 'See existing clinic',
        category: 'Other',
        submitterKey: submission.submitterKey || null,
        submissionId
      };
    }
  }

  /**
   * Get submission by submission ID
   * @param {string} submissionId - Submission ID (e.g., GLW-2024-0042)
   * @returns {Promise<object|null>} Submission data with providers and procedures
   */
  async getBySubmissionId(submissionId) {
    const pool = await db.getConnection();
    const request = pool.request();
    request.input('submissionId', sql.NVarChar, submissionId);

    const result = await request.query(`
      SELECT DraftID FROM ClinicDrafts WHERE SubmissionId = @submissionId
    `);

    if (result.recordset.length === 0) {
      return null;
    }

    return await draftService.getDraftById(result.recordset[0].DraftID);
  }

  /**
   * List submissions with optional filters
   * @param {object} filters - Filters (submitterKey, status, etc.)
   * @returns {Promise<array>} List of submissions
   */
  async listSubmissions(filters = {}) {
    const pool = await db.getConnection();
    const request = pool.request();

    let query = `
      SELECT
        DraftID,
        SubmissionId,
        ClinicName,
        Address,
        City,
        State,
        Category,
        Status,
        Source,
        SubmitterKey,
        SubmissionFlow,
        SubmittedAt,
        CreatedAt
      FROM ClinicDrafts
      WHERE Source = 'wizard'
    `;

    if (filters.submitterKey) {
      request.input('submitterKey', sql.NVarChar, filters.submitterKey);
      query += ' AND SubmitterKey = @submitterKey';
    }

    if (filters.status) {
      request.input('status', sql.NVarChar, filters.status);
      query += ' AND Status = @status';
    }

    if (filters.flow) {
      request.input('flow', sql.NVarChar, filters.flow);
      query += ' AND SubmissionFlow = @flow';
    }

    query += ' ORDER BY SubmittedAt DESC';

    if (filters.limit) {
      request.input('limit', sql.Int, filters.limit);
      query += ' OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY';
    }

    const result = await request.query(query);
    return result.recordset;
  }
}

module.exports = new SubmissionService();

