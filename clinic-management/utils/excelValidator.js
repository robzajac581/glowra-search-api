/**
 * Validate Excel data structure and content
 * Returns validation errors and warnings
 */

const REQUIRED_CLINIC_FIELDS = ['clinicName', 'address', 'city', 'state'];
const REQUIRED_FOR_APPROVAL = ['website', 'phone', 'email', 'placeID', 'category'];

/**
 * Validate clinic data
 */
function validateClinic(clinic, index) {
  const errors = [];
  const warnings = [];

  // Check required fields
  for (const field of REQUIRED_CLINIC_FIELDS) {
    if (!clinic[field] || String(clinic[field]).trim() === '') {
      errors.push(`Clinic ${index + 1}: Missing required field "${field}"`);
    }
  }

  // Check fields required for approval (warnings, not errors)
  for (const field of REQUIRED_FOR_APPROVAL) {
    if (!clinic[field] || String(clinic[field]).trim() === '') {
      warnings.push(`Clinic "${clinic.clinicName || index + 1}": Missing field "${field}" (required for approval)`);
    }
  }

  // Validate email format if provided
  if (clinic.email && !isValidEmail(clinic.email)) {
    errors.push(`Clinic "${clinic.clinicName || index + 1}": Invalid email format`);
  }

  // Validate website URL if provided
  if (clinic.website && !isValidUrl(clinic.website)) {
    warnings.push(`Clinic "${clinic.clinicName || index + 1}": Website may be invalid (should start with http:// or https://)`);
  }

  // Validate coordinates if provided
  if (clinic.latitude) {
    const lat = parseFloat(clinic.latitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      errors.push(`Clinic "${clinic.clinicName || index + 1}": Invalid latitude (must be between -90 and 90)`);
    }
  }

  if (clinic.longitude) {
    const lng = parseFloat(clinic.longitude);
    if (isNaN(lng) || lng < -180 || lng > 180) {
      errors.push(`Clinic "${clinic.clinicName || index + 1}": Invalid longitude (must be between -180 and 180)`);
    }
  }

  // Validate phone format (basic check)
  if (clinic.phone && !isValidPhone(clinic.phone)) {
    warnings.push(`Clinic "${clinic.clinicName || index + 1}": Phone number format may be invalid`);
  }

  return { errors, warnings };
}

/**
 * Validate provider data
 */
function validateProvider(provider, index, clinicNames) {
  const errors = [];
  const warnings = [];

  if (!provider.providerName || String(provider.providerName).trim() === '') {
    errors.push(`Provider ${index + 1}: Missing required field "providerName"`);
  }

  if (!provider.clinicName || String(provider.clinicName).trim() === '') {
    errors.push(`Provider ${index + 1}: Missing required field "clinicName"`);
  } else if (clinicNames && !clinicNames.includes(provider.clinicName)) {
    warnings.push(`Provider "${provider.providerName}": ClinicName "${provider.clinicName}" not found in Clinics sheet`);
  }

  return { errors, warnings };
}

/**
 * Validate procedure data
 */
function validateProcedure(procedure, index, clinicNames, providerNames) {
  const errors = [];
  const warnings = [];

  if (!procedure.procedureName || String(procedure.procedureName).trim() === '') {
    errors.push(`Procedure ${index + 1}: Missing required field "procedureName"`);
  }

  if (!procedure.category || String(procedure.category).trim() === '') {
    errors.push(`Procedure ${index + 1}: Missing required field "category"`);
  }

  if (!procedure.clinicName || String(procedure.clinicName).trim() === '') {
    errors.push(`Procedure ${index + 1}: Missing required field "clinicName"`);
  } else if (clinicNames && !clinicNames.includes(procedure.clinicName)) {
    warnings.push(`Procedure "${procedure.procedureName}": ClinicName "${procedure.clinicName}" not found in Clinics sheet`);
  }

  if (procedure.providerName && providerNames && !providerNames.includes(procedure.providerName)) {
    warnings.push(`Procedure "${procedure.procedureName}": ProviderName "${procedure.providerName}" not found in Providers sheet`);
  }

  if (procedure.averageCost) {
    const cost = parseFloat(procedure.averageCost);
    if (isNaN(cost) || cost < 0) {
      errors.push(`Procedure "${procedure.procedureName}": Invalid AverageCost (must be a positive number)`);
    }
  }

  return { errors, warnings };
}

/**
 * Validate entire Excel data structure
 */
function validateExcelData(parsedData) {
  const allErrors = [];
  const allWarnings = [];

  // Validate clinics
  if (!parsedData.clinics || parsedData.clinics.length === 0) {
    allErrors.push('No clinics found in Excel file');
    return { errors: allErrors, warnings: allWarnings, isValid: false };
  }

  const clinicNames = parsedData.clinics.map(c => c.clinicName).filter(Boolean);

  parsedData.clinics.forEach((clinic, index) => {
    const { errors, warnings } = validateClinic(clinic, index);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  });

  // Validate providers
  const providerNames = [];
  parsedData.providers.forEach((provider, index) => {
    const { errors, warnings } = validateProvider(provider, index, clinicNames);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
    
    if (provider.providerName) {
      providerNames.push(provider.providerName);
    }
  });

  // Validate procedures
  parsedData.procedures.forEach((procedure, index) => {
    const { errors, warnings } = validateProcedure(procedure, index, clinicNames, providerNames);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  });

  return {
    errors: allErrors,
    warnings: allWarnings,
    isValid: allErrors.length === 0,
    summary: {
      clinics: parsedData.clinics.length,
      providers: parsedData.providers.length,
      procedures: parsedData.procedures.length,
      errorCount: allErrors.length,
      warningCount: allWarnings.length
    }
  };
}

/**
 * Helper: Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Helper: Validate URL format
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Helper: Validate phone format (basic check)
 */
function isValidPhone(phone) {
  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  // Should have at least 10 digits
  return /^\d{10,}$/.test(cleaned);
}

module.exports = {
  validateExcelData,
  validateClinic,
  validateProvider,
  validateProcedure,
  REQUIRED_CLINIC_FIELDS,
  REQUIRED_FOR_APPROVAL
};

