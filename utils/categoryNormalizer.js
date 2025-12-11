/**
 * Category Normalizer Utility
 * Consolidates clinic categories into 5 standardized buckets:
 * - Plastic Surgery
 * - Medspa / Aesthetics
 * - Medical
 * - Dermatology
 * - Other
 * 
 * Handles typos, plurals, and capitalization variations
 */

// Standardized category constants
const CATEGORIES = {
  PLASTIC_SURGERY: 'Plastic Surgery',
  MEDSPA_AESTHETICS: 'Medspa / Aesthetics',
  MEDICAL: 'Medical',
  DERMATOLOGY: 'Dermatology',
  OTHER: 'Other'
};

/**
 * Normalize a string for comparison (lowercase, trim, remove extra spaces, handle plurals)
 */
function normalizeString(str) {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
    .replace(/[^\w\s]/g, '') // Remove special characters except spaces
    .replace(/s$/, '');  // Remove trailing 's' for basic plural handling
}

/**
 * Check if text contains any of the given keywords
 */
function containsKeywords(normalizedText, keywords) {
  return keywords.some(keyword => {
    const normalizedKeyword = normalizeString(keyword);
    return normalizedText.includes(normalizedKeyword);
  });
}

/**
 * Normalize a clinic category to one of the 5 standard categories
 * @param {string|null} category - The category to normalize
 * @returns {string} One of: "Plastic Surgery", "Medspa / Aesthetics", "Medical", "Dermatology", "Other"
 */
function normalizeCategory(category) {
  // Handle null, undefined, or empty string
  if (!category || typeof category !== 'string' || category.trim() === '') {
    return CATEGORIES.OTHER;
  }

  const normalized = normalizeString(category);
  
  // Early return for empty after normalization
  if (!normalized) {
    return CATEGORIES.OTHER;
  }

  // Plastic Surgery keywords
  // Includes: plastic surgeon, plastic surgery, cosmetic surgeon, cosmetic surgery, etc.
  const plasticSurgeryKeywords = [
    'plastic surgeon',
    'plastic surgery',
    'cosmetic surgeon',
    'cosmetic surgery',
    'plastic',
    'reconstructive surgery',
    'reconstructive surgeon'
  ];
  
  if (containsKeywords(normalized, plasticSurgeryKeywords)) {
    return CATEGORIES.PLASTIC_SURGERY;
  }

  // Dermatology keywords
  // Includes: dermatologist, dermatology, skin care, skincare, clinica dermatologica, etc.
  // Check dermatology BEFORE medspa to avoid misclassification
  const dermatologyKeywords = [
    'dermatolog',  // Catches dermatologist, dermatology, dermatologica
    'skin care',
    'skincare',
    'skin clinic'
  ];
  
  if (containsKeywords(normalized, dermatologyKeywords)) {
    return CATEGORIES.DERMATOLOGY;
  }

  // Medspa / Aesthetics keywords
  // Includes: med spa, medical spa, aesthetics, aesthetic, spa, etc.
  const medspaKeywords = [
    'med spa',
    'medical spa',
    'medspa',
    'aesthetic',
    'aesthetics',
    'beauty clinic',
    'beauty center',
    'spa'
  ];
  
  if (containsKeywords(normalized, medspaKeywords)) {
    return CATEGORIES.MEDSPA_AESTHETICS;
  }

  // Medical keywords
  // Includes: hospital, doctor, nurse practitioner, surgical center, medical center, clinic, etc.
  const medicalKeywords = [
    'hospital',
    'medical center',
    'health center',
    'healthcare',
    'surgical center',
    'surgery center',
    'doctor',
    'physician',
    'nurse practitioner',
    'family medicine',
    'primary care',
    'urgent care',
    'medical clinic',
    'health clinic'
  ];
  
  if (containsKeywords(normalized, medicalKeywords)) {
    return CATEGORIES.MEDICAL;
  }

  // Generic "clinic" keyword - only if not already matched
  // This catches general medical clinics
  if (normalized.includes('clinic')) {
    return CATEGORIES.MEDICAL;
  }

  // Default fallback
  return CATEGORIES.OTHER;
}

/**
 * Get all valid category values
 * @returns {string[]} Array of valid category names
 */
function getValidCategories() {
  return Object.values(CATEGORIES);
}

/**
 * Check if a category is valid (matches one of the standard categories)
 * @param {string} category - Category to check
 * @returns {boolean} True if category is one of the standard categories
 */
function isValidCategory(category) {
  return getValidCategories().includes(category);
}

module.exports = {
  normalizeCategory,
  getValidCategories,
  isValidCategory,
  CATEGORIES
};
