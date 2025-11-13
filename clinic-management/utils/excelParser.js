const XLSX = require('xlsx');

/**
 * Parse Excel file and extract clinic, provider, and procedure data
 * @param {Buffer|string} filePathOrBuffer - File path or buffer
 * @returns {Object} Parsed data with clinics, providers, procedures arrays
 */
function parseExcelFile(filePathOrBuffer) {
  let workbook;
  
  if (Buffer.isBuffer(filePathOrBuffer)) {
    workbook = XLSX.read(filePathOrBuffer, { type: 'buffer' });
  } else {
    workbook = XLSX.readFile(filePathOrBuffer);
  }

  const result = {
    clinics: [],
    providers: [],
    procedures: []
  };

  // Parse Clinics sheet
  if (workbook.SheetNames.includes('Clinics')) {
    const clinicsSheet = workbook.Sheets['Clinics'];
    result.clinics = XLSX.utils.sheet_to_json(clinicsSheet);
  } else if (workbook.SheetNames.length > 0) {
    // Fallback to first sheet if no "Clinics" sheet
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    result.clinics = XLSX.utils.sheet_to_json(firstSheet);
  }

  // Parse Providers sheet
  if (workbook.SheetNames.includes('Providers')) {
    const providersSheet = workbook.Sheets['Providers'];
    result.providers = XLSX.utils.sheet_to_json(providersSheet);
  }

  // Parse Procedures sheet
  if (workbook.SheetNames.includes('Procedures')) {
    const proceduresSheet = workbook.Sheets['Procedures'];
    result.procedures = XLSX.utils.sheet_to_json(proceduresSheet);
  }

  return result;
}

/**
 * Normalize column names (handle variations like "Clinic Name" vs "ClinicName")
 */
function normalizeColumnName(name) {
  if (!name) return null;
  
  // Remove spaces and convert to camelCase
  return name
    .trim()
    .replace(/\s+/g, '')
    .replace(/^./, (c) => c.toLowerCase())
    .replace(/[A-Z]/g, (c) => c);
}

/**
 * Normalize parsed data to ensure consistent field names
 */
function normalizeParsedData(parsedData) {
  const normalizeRow = (row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = normalizeColumnName(key);
      if (normalizedKey) {
        normalized[normalizedKey] = value;
      }
    }
    return normalized;
  };

  return {
    clinics: parsedData.clinics.map(normalizeRow),
    providers: parsedData.providers.map(normalizeRow),
    procedures: parsedData.procedures.map(normalizeRow)
  };
}

module.exports = {
  parseExcelFile,
  normalizeParsedData
};

