const XLSX = require('xlsx');
const { isValidEmail, isValidUrl } = require('./excelValidator');

/**
 * Parse Excel file and extract clinic, provider, and procedure data
 * @param {Buffer|string} filePathOrBuffer - File path or buffer
 * @returns {Object} Parsed data with clinics, providers, procedures arrays (optional googlePlaces)
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
    procedures: [],
    googlePlaces: []
  };

  if (workbook.SheetNames.includes('Clinics')) {
    const clinicsSheet = workbook.Sheets.Clinics;
    result.clinics = XLSX.utils.sheet_to_json(clinicsSheet);
  } else if (workbook.SheetNames.length > 0) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    result.clinics = XLSX.utils.sheet_to_json(firstSheet);
  }

  if (workbook.SheetNames.includes('Providers')) {
    const providersSheet = workbook.Sheets.Providers;
    result.providers = XLSX.utils.sheet_to_json(providersSheet);
  }

  if (workbook.SheetNames.includes('Procedures')) {
    const proceduresSheet = workbook.Sheets.Procedures;
    result.procedures = XLSX.utils.sheet_to_json(proceduresSheet);
  }

  if (workbook.SheetNames.includes('Google Places')) {
    const gpSheet = workbook.Sheets['Google Places'];
    result.googlePlaces = XLSX.utils.sheet_to_json(gpSheet);
  }

  return result;
}

function normalizeColumnName(name) {
  if (!name) return null;

  return name
    .trim()
    .replace(/\s+/g, '')
    .replace(/^./, (c) => c.toLowerCase())
    .replace(/[A-Z]/g, (c) => c);
}

function sanitizeClinicContactFields(clinic) {
  const next = { ...clinic };

  const emailRaw = next.email != null ? String(next.email).trim() : '';
  if (!emailRaw || !isValidEmail(emailRaw)) {
    delete next.email;
  } else {
    next.email = emailRaw;
  }

  const websiteRaw = next.website != null ? String(next.website).trim() : '';
  if (!websiteRaw || !isValidUrl(websiteRaw)) {
    delete next.website;
  } else {
    next.website = websiteRaw;
  }

  return next;
}

function applyClinicAliases(clinic) {
  const next = { ...clinic };
  if (
    (next.address === undefined || next.address === null || String(next.address).trim() === '') &&
    next.streetAddress != null &&
    String(next.streetAddress).trim() !== ''
  ) {
    next.address = typeof next.streetAddress === 'string' ? next.streetAddress.trim() : next.streetAddress;
  }
  return next;
}

function applyProcedureAliases(procedure) {
  const next = { ...procedure };
  if (
    (next.category === undefined || next.category === null || String(next.category).trim() === '') &&
    next.glowraCategory != null &&
    String(next.glowraCategory).trim() !== ''
  ) {
    next.category = typeof next.glowraCategory === 'string' ? next.glowraCategory.trim() : next.glowraCategory;
  }
  if (
    (next.averageCost === undefined || next.averageCost === null || String(next.averageCost).trim() === '') &&
    next.avgPrice != null &&
    String(next.avgPrice).trim() !== ''
  ) {
    next.averageCost = next.avgPrice;
  }
  return next;
}


/**
 * Omit averageCost when it is not a non-negative numeric price (e.g. "per unit", "per vial").
 */
function sanitizeProcedureAverageCost(procedure) {
  const next = { ...procedure };
  if (next.averageCost === undefined || next.averageCost === null) return next;
  if (typeof next.averageCost === 'number') {
    if (Number.isNaN(next.averageCost) || next.averageCost < 0) delete next.averageCost;
    return next;
  }
  const str = String(next.averageCost).trim();
  if (str === '') {
    delete next.averageCost;
    return next;
  }
  const cleaned = str.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    delete next.averageCost;
    return next;
  }
  const num = parseFloat(cleaned);
  if (Number.isNaN(num) || num < 0) delete next.averageCost;
  else next.averageCost = num;
  return next;
}

function pickPlaceId(gp) {
  return gp.placeID ?? gp.placeId ?? gp.place_id ?? null;
}

function pickLatitude(gp) {
  const v = gp.latitude ?? gp.Latitude;
  return v !== undefined && v !== null && String(v).trim() !== '' ? v : null;
}

function pickLongitude(gp) {
  const v = gp.longitude ?? gp.Longitude;
  return v !== undefined && v !== null && String(v).trim() !== '' ? v : null;
}

function findGooglePlaceRow(clinic, googlePlaceRows) {
  const name = String(clinic.clinicName || '').trim().toLowerCase();
  const city = String(clinic.city || '').trim().toLowerCase();
  const state = String(clinic.state || '').trim().toLowerCase();
  if (!name) return null;

  const byTriple = googlePlaceRows.filter((gp) => {
    const gn = String(gp.clinicName || '').trim().toLowerCase();
    const gc = String(gp.city || '').trim().toLowerCase();
    const gs = String(gp.state || '').trim().toLowerCase();
    return gn === name && gc === city && gs === state;
  });
  if (byTriple.length === 1) return byTriple[0];
  if (byTriple.length > 1) return byTriple[0];

  const byName = googlePlaceRows.filter((gp) => String(gp.clinicName || '').trim().toLowerCase() === name);
  if (byName.length === 1) return byName[0];
  return null;
}

function mergeGooglePlacesIntoClinic(clinic, googlePlaceRows) {
  const gp = findGooglePlaceRow(clinic, googlePlaceRows);
  if (!gp) return clinic;

  const next = { ...clinic };
  const placeId = pickPlaceId(gp);
  if (placeId && (next.placeID === undefined || next.placeID === null || String(next.placeID).trim() === '')) {
    next.placeID = typeof placeId === 'string' ? placeId.trim() : placeId;
  }
  const lat = pickLatitude(gp);
  if (lat != null && (next.latitude === undefined || next.latitude === null || String(next.latitude).trim() === '')) {
    next.latitude = lat;
  }
  const lng = pickLongitude(gp);
  if (lng != null && (next.longitude === undefined || next.longitude === null || String(next.longitude).trim() === '')) {
    next.longitude = lng;
  }
  return next;
}

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

  const googlePlaceRows = (parsedData.googlePlaces || []).map(normalizeRow);

  let clinics = parsedData.clinics.map(normalizeRow).map(applyClinicAliases).map(sanitizeClinicContactFields);

  clinics = clinics.map((c) => mergeGooglePlacesIntoClinic(c, googlePlaceRows));

  return {
    clinics,
    providers: parsedData.providers.map(normalizeRow),
    procedures: parsedData.procedures.map(normalizeRow).map(applyProcedureAliases).map(sanitizeProcedureAverageCost)
  };
}

module.exports = {
  parseExcelFile,
  normalizeParsedData
};
