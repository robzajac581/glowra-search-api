const { parseExcelFile, normalizeParsedData } = require('../utils/excelParser');
const { validateExcelData } = require('../utils/excelValidator');
const draftService = require('./draftService');
const duplicateDetectionService = require('./duplicateDetectionService');

/**
 * Bulk import service
 * Handles Excel file uploads, validation, duplicate detection, and draft creation
 */
class BulkImportService {
  /**
   * Process bulk import from Excel file
   * @param {Buffer} fileBuffer - Excel file buffer
   * @param {string} submittedBy - User identifier
   * @returns {Promise<Object>} Import results
   */
  async processBulkImport(fileBuffer, submittedBy) {
    // Parse Excel file
    const parsedData = parseExcelFile(fileBuffer);
    const normalizedData = normalizeParsedData(parsedData);

    // Validate data
    const validation = validateExcelData(normalizedData);
    if (!validation.isValid) {
      return {
        success: false,
        error: 'Validation failed',
        validationErrors: validation.errors,
        validationWarnings: validation.warnings
      };
    }

    const results = {
      success: true,
      draftsCreated: 0,
      duplicatesFound: 0,
      drafts: [],
      validationWarnings: validation.warnings
    };

    // Process each clinic
    for (const clinicData of normalizedData.clinics) {
      try {
        // Run duplicate detection
        const duplicateCheck = await duplicateDetectionService.checkDuplicates(clinicData);

        // Get providers for this clinic
        const providers = normalizedData.providers.filter(
          p => p.clinicName && p.clinicName.toLowerCase() === clinicData.clinicName.toLowerCase()
        );

        // Get procedures for this clinic
        const procedures = normalizedData.procedures.filter(
          p => p.clinicName && p.clinicName.toLowerCase() === clinicData.clinicName.toLowerCase()
        );

        // Create draft
        const draft = await draftService.createDraft({
          clinicName: clinicData.clinicName,
          address: clinicData.address,
          city: clinicData.city,
          state: clinicData.state,
          website: clinicData.website || null,
          phone: clinicData.phone || null,
          email: clinicData.email || null,
          latitude: clinicData.latitude ? parseFloat(clinicData.latitude) : null,
          longitude: clinicData.longitude ? parseFloat(clinicData.longitude) : null,
          placeID: clinicData.placeID || null,
          category: clinicData.category || null,
          status: 'pending_review',
          source: 'bulk_import',
          submittedBy,
          providers: providers.map(p => ({
            providerName: p.providerName,
            specialty: p.specialty || null
          })),
          procedures: procedures.map(p => ({
            procedureName: p.procedureName,
            category: p.category,
            averageCost: p.averageCost ? parseFloat(p.averageCost) : null,
            providerName: p.providerName || null
          }))
        });

        // Check for missing required fields
        const missingFields = [];
        if (!draft.Website) missingFields.push('Website');
        if (!draft.Phone) missingFields.push('Phone');
        if (!draft.Email) missingFields.push('Email');
        if (!draft.PlaceID) missingFields.push('PlaceID');
        if (!draft.Category) missingFields.push('Category');

        results.draftsCreated++;
        if (duplicateCheck.hasDuplicates) {
          results.duplicatesFound++;
        }

        results.drafts.push({
          draftId: draft.DraftID,
          clinicName: draft.ClinicName,
          status: draft.Status,
          duplicates: duplicateCheck.hasDuplicates ? duplicateCheck.matches : [],
          missingRequiredFields: missingFields
        });
      } catch (error) {
        console.error(`Error processing clinic "${clinicData.clinicName}":`, error);
        results.drafts.push({
          clinicName: clinicData.clinicName,
          status: 'error',
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Validate Excel file without creating drafts
   */
  async validateFile(fileBuffer) {
    const parsedData = parseExcelFile(fileBuffer);
    const normalizedData = normalizeParsedData(parsedData);
    const validation = validateExcelData(normalizedData);

    return {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      summary: validation.summary
    };
  }
}

module.exports = new BulkImportService();

