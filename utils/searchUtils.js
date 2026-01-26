/**
 * Search utility functions for fuzzy matching and normalization
 */

/**
 * Normalizes a string for fuzzy matching by:
 * - Converting to lowercase
 * - Removing all spaces
 * - Removing common punctuation
 * @param {string} str - String to normalize
 * @returns {string} Normalized string
 */
function normalizeForSearch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\s+/g, '') // Remove all spaces
    .replace(/[^\w]/g, ''); // Remove punctuation, keep only alphanumeric
}

/**
 * Checks if a normalized search term matches a normalized target string
 * Supports:
 * - Exact match
 * - Contains match (partial)
 * - Word split tolerance (e.g., "micro blading" matches "microblading")
 * @param {string} searchTerm - The search term to match
 * @param {string} target - The target string to search in
 * @returns {boolean} True if match found
 */
function fuzzyMatch(searchTerm, target) {
  if (!searchTerm || !target) return false;
  
  const normalizedSearch = normalizeForSearch(searchTerm);
  const normalizedTarget = normalizeForSearch(target);
  
  // Exact normalized match
  if (normalizedTarget === normalizedSearch) return true;
  
  // Contains match (partial)
  if (normalizedTarget.includes(normalizedSearch)) return true;
  
  // Reverse contains (search term contains target - for partial clinic names)
  if (normalizedSearch.includes(normalizedTarget)) return true;
  
  // Word split tolerance: check if all characters in search term appear in target in order
  // This handles "micro blading" matching "microblading"
  let searchIndex = 0;
  for (let i = 0; i < normalizedTarget.length && searchIndex < normalizedSearch.length; i++) {
    if (normalizedTarget[i] === normalizedSearch[searchIndex]) {
      searchIndex++;
    }
  }
  if (searchIndex === normalizedSearch.length) return true;
  
  return false;
}

/**
 * Checks if a procedure name matches a search term with fuzzy matching
 * Handles word splits, abbreviations, and partial matches
 * @param {string} procedureName - The procedure name to check
 * @param {string} searchTerm - The search term
 * @returns {boolean} True if match found
 */
function matchesProcedureSearch(procedureName, searchTerm) {
  if (!procedureName || !searchTerm) {
    return false;
  }
  
  const lowerProcedure = procedureName.toLowerCase().trim();
  const lowerSearch = searchTerm.toLowerCase().trim();
  
  // Direct contains match (case-insensitive)
  if (lowerProcedure.includes(lowerSearch)) {
    return true;
  }
  
  // Normalize both for fuzzy matching (handles word splits like "micro blading" vs "microblading")
  const normalizedProcedure = normalizeForSearch(procedureName);
  const normalizedSearch = normalizeForSearch(searchTerm);
  
  // Exact normalized match
  if (normalizedProcedure === normalizedSearch) {
    return true;
  }
  
  // Normalized contains match (procedure name contains search term)
  if (normalizedProcedure.includes(normalizedSearch)) {
    return true;
  }
  
  // Check individual words in search term (for multi-word searches)
  const searchWords = lowerSearch.split(/\s+/).filter(w => w.length > 1);
  
  if (searchWords.length > 1) {
    // If search has multiple words, check if all words appear in procedure name
    const allWordsMatch = searchWords.every(word => {
      const normalizedWord = normalizeForSearch(word);
      return normalizedProcedure.includes(normalizedWord);
    });
    if (allWordsMatch) {
      return true;
    }
    
    // Also check character-by-character matching for word splits
    // This handles cases where "micro blading" should match "microblading"
    let searchIndex = 0;
    for (let i = 0; i < normalizedProcedure.length && searchIndex < normalizedSearch.length; i++) {
      if (normalizedProcedure[i] === normalizedSearch[searchIndex]) {
        searchIndex++;
      }
    }
    if (searchIndex === normalizedSearch.length) {
      return true;
    }
  }
  
  return false;
}

/**
 * Checks if a clinic name matches a search term with fuzzy matching
 * Handles word splits, word order tolerance, and partial matches
 * @param {string} clinicName - The clinic name to check
 * @param {string} searchTerm - The search term
 * @returns {boolean} True if match found
 */
function matchesClinicNameSearch(clinicName, searchTerm) {
  if (!clinicName || !searchTerm) return false;
  
  const lowerClinic = clinicName.toLowerCase().trim();
  const lowerSearch = searchTerm.toLowerCase().trim();
  
  // Direct contains match (case-insensitive)
  if (lowerClinic.includes(lowerSearch)) return true;
  
  // Fuzzy match with normalization (handles word splits)
  if (fuzzyMatch(searchTerm, clinicName)) return true;
  
  // Word order tolerance: check if all words in search appear in clinic name
  const searchWords = lowerSearch.split(/\s+/).filter(w => w.length > 1);
  const clinicWords = lowerClinic.split(/\s+/).filter(w => w.length > 1);
  
  if (searchWords.length > 1) {
    // Check if all search words appear in clinic name (order-independent)
    const normalizedClinic = normalizeForSearch(clinicName);
    const allWordsMatch = searchWords.every(word => {
      const normalizedWord = normalizeForSearch(word);
      return normalizedClinic.includes(normalizedWord);
    });
    if (allWordsMatch) return true;
  }
  
  // Check if any individual word matches (for partial matches like "Fiala" matching "Fiala Aesthetics")
  if (searchWords.length === 1) {
    const normalizedClinic = normalizeForSearch(clinicName);
    const normalizedSearch = normalizeForSearch(searchTerm);
    if (normalizedClinic.includes(normalizedSearch)) return true;
  }
  
  return false;
}

/**
 * Calculates relevance score for search results
 * Higher score = more relevant
 * @param {string} field - The field being searched (clinicName, procedureName, etc.)
 * @param {string} searchTerm - The search term
 * @returns {number} Relevance score (0-100)
 */
function calculateRelevanceScore(field, searchTerm) {
  if (!field || !searchTerm) return 0;
  
  const lowerField = field.toLowerCase().trim();
  const lowerSearch = searchTerm.toLowerCase().trim();
  
  // Exact match (case-insensitive) - highest score
  if (lowerField === lowerSearch) return 100;
  
  // Starts with search term - high score
  if (lowerField.startsWith(lowerSearch)) return 90;
  
  // Contains search term - medium-high score
  if (lowerField.includes(lowerSearch)) return 70;
  
  // Fuzzy normalized match - medium score
  const normalizedField = normalizeForSearch(field);
  const normalizedSearch = normalizeForSearch(searchTerm);
  if (normalizedField === normalizedSearch) return 60;
  if (normalizedField.includes(normalizedSearch)) return 50;
  
  // Word-based match - lower score
  const searchWords = lowerSearch.split(/\s+/).filter(w => w.length > 1);
  const fieldWords = lowerField.split(/\s+/).filter(w => w.length > 1);
  
  if (searchWords.length > 0) {
    const matchingWords = searchWords.filter(word => 
      fieldWords.some(fw => fw.includes(word) || word.includes(fw))
    ).length;
    if (matchingWords > 0) {
      return (matchingWords / searchWords.length) * 40;
    }
  }
  
  return 0;
}

module.exports = {
  normalizeForSearch,
  fuzzyMatch,
  matchesProcedureSearch,
  matchesClinicNameSearch,
  calculateRelevanceScore
};
