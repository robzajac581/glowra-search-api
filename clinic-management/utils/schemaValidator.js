/**
 * Schema Validator
 * Validates data against field definitions from the schema registry
 */

const { clinicFields, advancedClinicFields, CLINIC_CATEGORIES, US_STATES } = require('../schema/clinicFields');
const { providerFields, PROVIDER_SPECIALTIES } = require('../schema/providerFields');
const { procedureFields, PROCEDURE_CATEGORIES, PRICE_UNITS } = require('../schema/procedureFields');
const { validateClinicPhotos, PHOTO_TYPES, ALLOWED_MIME_TYPES } = require('../schema/photoFields');

/**
 * Validate a single field value against its definition
 * @param {string} fieldName - Name of the field
 * @param {any} value - Value to validate
 * @param {object} fieldDef - Field definition
 * @returns {object} - { valid: boolean, error: string|null }
 */
function validateField(fieldName, value, fieldDef) {
  // Check required
  if (fieldDef.required && (value === undefined || value === null || value === '')) {
    return { valid: false, error: `${fieldDef.label || fieldName} is required` };
  }

  // If not required and empty, skip other validations
  if (value === undefined || value === null || value === '') {
    return { valid: true, error: null };
  }

  // Check type
  if (fieldDef.type === 'string' && typeof value !== 'string') {
    return { valid: false, error: `${fieldDef.label || fieldName} must be a string` };
  }
  
  if (fieldDef.type === 'number') {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      return { valid: false, error: `${fieldDef.label || fieldName} must be a number` };
    }
    if (fieldDef.min !== undefined && numValue < fieldDef.min) {
      return { valid: false, error: `${fieldDef.label || fieldName} must be at least ${fieldDef.min}` };
    }
    if (fieldDef.max !== undefined && numValue > fieldDef.max) {
      return { valid: false, error: `${fieldDef.label || fieldName} must be at most ${fieldDef.max}` };
    }
  }

  if (fieldDef.type === 'array' && !Array.isArray(value)) {
    return { valid: false, error: `${fieldDef.label || fieldName} must be an array` };
  }

  // Check maxLength
  if (fieldDef.maxLength && typeof value === 'string' && value.length > fieldDef.maxLength) {
    return { valid: false, error: `${fieldDef.label || fieldName} must be at most ${fieldDef.maxLength} characters` };
  }

  // Check enum
  if (fieldDef.enum && !fieldDef.enum.includes(value)) {
    return { valid: false, error: `${fieldDef.label || fieldName} must be one of: ${fieldDef.enum.join(', ')}` };
  }

  // Check pattern
  if (fieldDef.pattern && typeof value === 'string') {
    const regex = fieldDef.pattern instanceof RegExp ? fieldDef.pattern : new RegExp(fieldDef.pattern);
    if (!regex.test(value)) {
      return { valid: false, error: `${fieldDef.label || fieldName} format is invalid. ${fieldDef.description || ''}` };
    }
  }

  return { valid: true, error: null };
}

/**
 * Validate clinic data
 * @param {object} clinic - Clinic data object
 * @returns {object} - { valid: boolean, errors: array }
 */
function validateClinic(clinic) {
  const errors = [];

  for (const [fieldName, fieldDef] of Object.entries(clinicFields)) {
    const result = validateField(fieldName, clinic[fieldName], fieldDef);
    if (!result.valid) {
      errors.push({ field: fieldName, message: result.error });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single provider
 * @param {object} provider - Provider data object
 * @param {number} index - Index in the array (for error messages)
 * @returns {object} - { valid: boolean, errors: array }
 */
function validateProvider(provider, index = 0) {
  const errors = [];

  for (const [fieldName, fieldDef] of Object.entries(providerFields)) {
    const result = validateField(fieldName, provider[fieldName], fieldDef);
    if (!result.valid) {
      errors.push({ field: `providers[${index}].${fieldName}`, message: result.error });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate providers array
 * @param {array} providers - Array of provider objects
 * @returns {object} - { valid: boolean, errors: array }
 */
function validateProviders(providers) {
  if (!providers || providers.length === 0) {
    return { valid: true, errors: [] }; // Providers are optional
  }

  const errors = [];
  providers.forEach((provider, index) => {
    const result = validateProvider(provider, index);
    errors.push(...result.errors);
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single procedure
 * @param {object} procedure - Procedure data object
 * @param {number} index - Index in the array (for error messages)
 * @returns {object} - { valid: boolean, errors: array }
 */
function validateProcedure(procedure, index = 0) {
  const errors = [];

  for (const [fieldName, fieldDef] of Object.entries(procedureFields)) {
    const result = validateField(fieldName, procedure[fieldName], fieldDef);
    if (!result.valid) {
      errors.push({ field: `procedures[${index}].${fieldName}`, message: result.error });
    }
  }

  // Custom validation: priceMax must be >= priceMin
  if (procedure.priceMin !== undefined && procedure.priceMax !== undefined) {
    if (Number(procedure.priceMax) < Number(procedure.priceMin)) {
      errors.push({
        field: `procedures[${index}].priceMax`,
        message: 'Maximum price must be greater than or equal to minimum price'
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate procedures array
 * @param {array} procedures - Array of procedure objects
 * @returns {object} - { valid: boolean, errors: array }
 */
function validateProcedures(procedures) {
  if (!procedures || procedures.length === 0) {
    return { valid: true, errors: [] }; // Procedures are optional
  }

  const errors = [];
  procedures.forEach((procedure, index) => {
    const result = validateProcedure(procedure, index);
    errors.push(...result.errors);
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a complete submission (clinic + providers + procedures)
 * @param {object} submission - Complete submission object
 * @returns {object} - { valid: boolean, errors: array }
 */
function validateSubmission(submission) {
  const errors = [];

  // Validate flow
  if (!submission.flow || !['new_clinic', 'add_to_existing'].includes(submission.flow)) {
    errors.push({ field: 'flow', message: 'Flow must be "new_clinic" or "add_to_existing"' });
  }

  // For new clinic, validate clinic data
  if (submission.flow === 'new_clinic') {
    if (!submission.clinic) {
      errors.push({ field: 'clinic', message: 'Clinic information is required for new clinic submissions' });
    } else {
      const clinicResult = validateClinic(submission.clinic);
      errors.push(...clinicResult.errors);
    }
  }

  // For add_to_existing, require existingClinicId
  if (submission.flow === 'add_to_existing') {
    if (!submission.existingClinicId) {
      errors.push({ field: 'existingClinicId', message: 'Existing clinic ID is required when adding to existing clinic' });
    }
  }

  // Validate providers (optional)
  if (submission.providers) {
    const providersResult = validateProviders(submission.providers);
    errors.push(...providersResult.errors);
  }

  // Validate procedures (optional)
  if (submission.procedures) {
    const proceduresResult = validateProcedures(submission.procedures);
    errors.push(...proceduresResult.errors);
  }

  // Validate photos (optional)
  if (submission.photos) {
    const photosResult = validateClinicPhotos(submission.photos);
    errors.push(...photosResult.errors);
  }

  // Validate advanced fields (optional, all fields are optional)
  if (submission.advanced) {
    for (const [fieldName, fieldDef] of Object.entries(advancedClinicFields)) {
      if (submission.advanced[fieldName] !== undefined) {
        const result = validateField(fieldName, submission.advanced[fieldName], fieldDef);
        if (!result.valid) {
          errors.push({ field: `advanced.${fieldName}`, message: result.error });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Calculate average price if not provided
 * @param {object} procedure - Procedure object
 * @returns {number|null} - Calculated average price
 */
function calculateAveragePrice(procedure) {
  if (procedure.averagePrice !== undefined && procedure.averagePrice !== null) {
    return Number(procedure.averagePrice);
  }
  
  if (procedure.priceMin !== undefined && procedure.priceMax !== undefined) {
    return (Number(procedure.priceMin) + Number(procedure.priceMax)) / 2;
  }
  
  if (procedure.priceMin !== undefined) {
    return Number(procedure.priceMin);
  }
  
  if (procedure.priceMax !== undefined) {
    return Number(procedure.priceMax);
  }
  
  return null;
}

module.exports = {
  validateField,
  validateClinic,
  validateProvider,
  validateProviders,
  validateProcedure,
  validateProcedures,
  validateSubmission,
  validateClinicPhotos,
  calculateAveragePrice,
  // Export schemas for reference
  clinicFields,
  advancedClinicFields,
  providerFields,
  procedureFields,
  // Export enums
  CLINIC_CATEGORIES,
  PROVIDER_SPECIALTIES,
  PROCEDURE_CATEGORIES,
  PRICE_UNITS,
  US_STATES,
  PHOTO_TYPES,
  ALLOWED_MIME_TYPES
};

