/**
 * Response Normalizer Utility
 * Standardizes all API responses to consistent camelCase field names
 * 
 * This utility eliminates the need for frontend dual-casing guards like:
 *   getField(obj, 'PascalCase', 'camelCase')
 * 
 * Usage:
 *   const { normalizeResponse, normalizeDraft, normalizeClinic } = require('../utils/responseNormalizer');
 *   
 *   // In your route handlers:
 *   const normalizedDraft = normalizeDraft(draft);
 *   res.json({ success: true, draft: normalizedDraft });
 */

/**
 * Convert a string from PascalCase to camelCase
 * @param {string} str - PascalCase string
 * @returns {string} camelCase string
 */
function toCamelCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Field mapping for special cases where we want specific output names
 * Keys are PascalCase, values are the desired camelCase output
 */
const FIELD_MAPPINGS = {
  // Provider photo - standardize all variations to 'photoUrl'
  'PhotoURL': 'photoUrl',
  'PhotoUrl': 'photoUrl',
  'PhotoData': 'photoData',
  
  // Draft-specific IDs
  'DraftID': 'draftId',
  'DraftProviderID': 'draftProviderId',
  'DraftProcedureID': 'draftProcedureId',
  'DraftPhotoID': 'draftPhotoId',
  
  // Clinic IDs
  'ClinicID': 'clinicId',
  'DuplicateClinicID': 'duplicateClinicId',
  
  // Other IDs
  'ProviderID': 'providerId',
  'ProcedureID': 'procedureId',
  'CategoryID': 'categoryId',
  'LocationID': 'locationId',
  'AdminUserID': 'adminUserId',
  'RequestID': 'requestId',
  'PlaceID': 'placeId',
  'PhotoID': 'photoId',
  
  // Names
  'ClinicName': 'clinicName',
  'ProviderName': 'providerName',
  'ProcedureName': 'procedureName',
  'BusinessName': 'businessName',
  
  // Address fields
  'Address': 'address',
  'City': 'city',
  'State': 'state',
  'ZipCode': 'zipCode',
  'PostalCode': 'zipCode',  // Map PostalCode to zipCode for US-focused API
  'FullAddress': 'fullAddress',
  
  // Contact
  'Phone': 'phone',
  'Website': 'website',
  'Email': 'email',
  
  // Location coordinates
  'Latitude': 'latitude',
  'Longitude': 'longitude',
  
  // Ratings
  'GoogleRating': 'googleRating',
  'GoogleReviewCount': 'googleReviewCount',
  'GoogleReviewsJSON': 'googleReviewsJson',
  'GoogleDataJSON': 'googleDataJson',
  
  // Procedures
  'AverageCost': 'averageCost',
  'PriceMin': 'priceMin',
  'PriceMax': 'priceMax',
  'PriceUnit': 'priceUnit',
  'ProviderNames': 'providerNames',
  
  // Photos
  'PhotoType': 'photoType',
  'PhotoReference': 'photoReference',
  'IsPrimary': 'isPrimary',
  'DisplayOrder': 'displayOrder',
  'Caption': 'caption',
  'Source': 'source',
  'FileName': 'fileName',
  'MimeType': 'mimeType',
  'FileSize': 'fileSize',
  
  // Status and metadata
  'Status': 'status',
  'Category': 'category',
  'Specialty': 'specialty',
  'Notes': 'notes',
  'SubmissionFlow': 'submissionFlow',
  'SubmissionId': 'submissionId',
  'SubmittedBy': 'submittedBy',
  'SubmitterKey': 'submitterKey',
  'SubmittedAt': 'submittedAt',
  'ReviewedBy': 'reviewedBy',
  'ReviewedAt': 'reviewedAt',
  'CreatedAt': 'createdAt',
  'UpdatedAt': 'updatedAt',
  'LastRatingUpdate': 'lastRatingUpdate',
  'LastUpdated': 'lastUpdated',
  
  // Google Places
  'GoogleProfileLink': 'googleProfileLink',
  'BookingURL': 'bookingUrl',
  'Description': 'description',
  'WorkingHours': 'workingHours',
  'AboutJSON': 'aboutJson',
  'Verified': 'verified',
  'BusinessStatus': 'businessStatus',
  'Subtypes': 'subtypes',
  
  // Social media
  'Facebook': 'facebook',
  'Instagram': 'instagram',
  'LinkedIn': 'linkedin',
  'Twitter': 'twitter',
  'YouTube': 'youtube',
  
  // Photos and media
  'Photo': 'photo',
  'Logo': 'logo',
  'StreetView': 'streetView',
  'Width': 'width',
  'Height': 'height',
  'AttributionText': 'attributionText',
  
  // Other
  'IsActive': 'isActive',
  'Role': 'role',
  'PasswordHash': 'passwordHash',
  'LastLoginAt': 'lastLoginAt'
};

/**
 * Normalize a single key from PascalCase to camelCase
 * @param {string} key - The key to normalize
 * @returns {string} Normalized camelCase key
 */
function normalizeKey(key) {
  // Check if we have a specific mapping
  if (FIELD_MAPPINGS[key]) {
    return FIELD_MAPPINGS[key];
  }
  // Otherwise, convert to camelCase
  return toCamelCase(key);
}

/**
 * Recursively normalize an object's keys to camelCase
 * @param {Object|Array} data - Object or array to normalize
 * @returns {Object|Array} Normalized data with camelCase keys
 */
function normalizeResponse(data) {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => normalizeResponse(item));
  }

  if (typeof data === 'object' && !(data instanceof Date)) {
    const normalized = {};
    for (const [key, value] of Object.entries(data)) {
      const normalizedKey = normalizeKey(key);
      normalized[normalizedKey] = normalizeResponse(value);
    }
    return normalized;
  }

  return data;
}

/**
 * Normalize a draft object with all its nested data (providers, procedures, photos)
 * @param {Object} draft - Draft object from database
 * @returns {Object} Normalized draft with camelCase keys
 */
function normalizeDraft(draft) {
  if (!draft) return null;

  const normalized = normalizeResponse(draft);
  
  // Parse JSON fields if they're strings
  if (normalized.googleDataJson && typeof normalized.googleDataJson === 'string') {
    try {
      normalized.googleData = JSON.parse(normalized.googleDataJson);
    } catch (e) {
      // Keep as string if parsing fails
    }
  }
  
  if (normalized.workingHours && typeof normalized.workingHours === 'string') {
    try {
      normalized.workingHours = JSON.parse(normalized.workingHours);
    } catch (e) {
      // Keep as string if parsing fails
    }
  }

  // Parse providerNames if it's a JSON string
  if (normalized.procedures) {
    normalized.procedures = normalized.procedures.map(proc => {
      if (proc.providerNames && typeof proc.providerNames === 'string') {
        try {
          proc.providerNames = JSON.parse(proc.providerNames);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      return proc;
    });
  }

  return normalized;
}

/**
 * Normalize a clinic object with all its associated data
 * @param {Object} clinic - Clinic object from database
 * @returns {Object} Normalized clinic with camelCase keys
 */
function normalizeClinic(clinic) {
  if (!clinic) return null;
  
  const normalized = normalizeResponse(clinic);
  
  // Parse JSON fields if they're strings
  if (normalized.googleReviewsJson && typeof normalized.googleReviewsJson === 'string') {
    try {
      normalized.reviews = JSON.parse(normalized.googleReviewsJson);
    } catch (e) {
      normalized.reviews = [];
    }
  }
  
  if (normalized.workingHours && typeof normalized.workingHours === 'string') {
    try {
      normalized.workingHours = JSON.parse(normalized.workingHours);
    } catch (e) {
      // Keep as string if parsing fails
    }
  }
  
  if (normalized.aboutJson && typeof normalized.aboutJson === 'string') {
    try {
      normalized.about = JSON.parse(normalized.aboutJson);
    } catch (e) {
      // Keep as string if parsing fails
    }
  }

  return normalized;
}

/**
 * Normalize providers array with standardized photoUrl field
 * @param {Array} providers - Array of provider objects
 * @returns {Array} Normalized providers with standardized photoUrl
 */
function normalizeProviders(providers) {
  if (!providers || !Array.isArray(providers)) return [];
  
  return providers.map(provider => {
    const normalized = normalizeResponse(provider);
    
    // Ensure photoUrl is standardized (handle all legacy variations)
    if (!normalized.photoUrl) {
      normalized.photoUrl = provider.PhotoURL || provider.PhotoUrl || provider.photoURL || provider.photoUrl || null;
    }
    
    return normalized;
  });
}

/**
 * Normalize procedures array
 * @param {Array} procedures - Array of procedure objects
 * @returns {Array} Normalized procedures
 */
function normalizeProcedures(procedures) {
  if (!procedures || !Array.isArray(procedures)) return [];
  
  return procedures.map(proc => {
    const normalized = normalizeResponse(proc);
    
    // Parse providerNames if it's a JSON string
    if (normalized.providerNames && typeof normalized.providerNames === 'string') {
      try {
        normalized.providerNames = JSON.parse(normalized.providerNames);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    
    return normalized;
  });
}

/**
 * Normalize photos array
 * @param {Array} photos - Array of photo objects
 * @returns {Array} Normalized photos
 */
function normalizePhotos(photos) {
  if (!photos || !Array.isArray(photos)) return [];
  
  return photos.map(photo => {
    const normalized = normalizeResponse(photo);
    
    // Ensure photoUrl is standardized
    if (!normalized.photoUrl) {
      normalized.photoUrl = photo.PhotoURL || photo.PhotoUrl || photo.photoURL || photo.photoUrl || null;
    }
    
    return normalized;
  });
}

/**
 * Flatten grouped procedures to flat array format
 * @param {Object} groupedProcedures - Procedures grouped by category { "Face": { procedures: [...] } }
 * @returns {Array} Flat array of procedures with category field
 */
function flattenProcedures(groupedProcedures) {
  if (!groupedProcedures || typeof groupedProcedures !== 'object') return [];
  
  const flat = [];
  for (const [category, data] of Object.entries(groupedProcedures)) {
    const procedures = data.procedures || data;
    if (Array.isArray(procedures)) {
      for (const proc of procedures) {
        flat.push({
          ...normalizeResponse(proc),
          category: category
        });
      }
    }
  }
  return flat;
}

/**
 * Group flat procedures array by category
 * @param {Array} procedures - Flat array of procedures
 * @returns {Object} Procedures grouped by category
 */
function groupProcedures(procedures) {
  if (!procedures || !Array.isArray(procedures)) return {};
  
  return procedures.reduce((acc, proc) => {
    const normalized = normalizeResponse(proc);
    const category = normalized.category || 'Other';
    
    if (!acc[category]) {
      acc[category] = {
        categoryId: normalized.categoryId || null,
        procedures: []
      };
    }
    
    acc[category].procedures.push({
      id: normalized.procedureId || normalized.id,
      name: normalized.procedureName || normalized.name,
      price: normalized.averageCost || normalized.price,
      priceMin: normalized.priceMin,
      priceMax: normalized.priceMax,
      priceUnit: normalized.priceUnit,
      providerNames: normalized.providerNames
    });
    
    return acc;
  }, {});
}

module.exports = {
  toCamelCase,
  normalizeKey,
  normalizeResponse,
  normalizeDraft,
  normalizeClinic,
  normalizeProviders,
  normalizeProcedures,
  normalizePhotos,
  flattenProcedures,
  groupProcedures,
  FIELD_MAPPINGS
};

