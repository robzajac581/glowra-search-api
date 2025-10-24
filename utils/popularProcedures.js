// popularProcedures.js
// Hardcoded ranking of most popular procedures by category
// Used when users search by location or other non-procedure terms

const POPULAR_PROCEDURES_BY_CATEGORY = {
  'Breast': [
    'Breast Augmentation',
    'Breast Lift',
    'Breast Reduction',
    'Breast Reconstruction',
    'Breast Implant Removal'
  ],
  'Face': [
    'Facelift',
    'Rhinoplasty',
    'Blepharoplasty',
    'Neck Lift',
    'Brow Lift'
  ],
  'Body': [
    'Liposuction',
    'Tummy Tuck',
    'Brazilian Butt Lift',
    'Mommy Makeover',
    'Body Contouring'
  ],
  'Injectibles': [
    'Botox',
    'Dermal Fillers',
    'Lip Fillers',
    'Kybella',
    'Sculptra'
  ],
  'Skin': [
    'Laser Treatment',
    'Chemical Peel',
    'Microneedling',
    'IPL Photofacial',
    'Laser Hair Removal'
  ],
  'Other': [
    'Hair Transplant',
    'Scar Revision',
    'Tattoo Removal',
    'Non-Surgical Face Lift',
    'Coolsculpting'
  ]
};

/**
 * Get top procedures from a clinic's procedure list based on popularity ranking
 * Selects up to 2 procedures per category, prioritized by ranking order, up to 5 total
 * 
 * @param {Array} allProcedures - Array of procedure objects with { procedureName, category, price }
 * @param {Number} limit - Maximum number of procedures to return (default: 5)
 * @returns {Array} Array of top procedures
 */
function getTopProcedures(allProcedures, limit = 5) {
  if (!allProcedures || allProcedures.length === 0) {
    return [];
  }

  const selectedProcedures = [];
  const proceduresPerCategory = {};
  
  // Initialize counters for each category
  Object.keys(POPULAR_PROCEDURES_BY_CATEGORY).forEach(category => {
    proceduresPerCategory[category] = 0;
  });

  // Create a map for quick lookup
  const procedureMap = new Map();
  allProcedures.forEach(proc => {
    const key = `${proc.category}|${proc.procedureName}`;
    procedureMap.set(key, proc);
  });

  // Iterate through categories and rankings to select procedures
  for (const category of Object.keys(POPULAR_PROCEDURES_BY_CATEGORY)) {
    const rankedProcedures = POPULAR_PROCEDURES_BY_CATEGORY[category];
    
    for (const procedureName of rankedProcedures) {
      // Stop if we've reached the limit
      if (selectedProcedures.length >= limit) {
        return selectedProcedures;
      }
      
      // Skip if we've already selected 2 from this category
      if (proceduresPerCategory[category] >= 2) {
        break;
      }
      
      // Check if this clinic offers this procedure
      const key = `${category}|${procedureName}`;
      const procedure = procedureMap.get(key);
      
      if (procedure) {
        selectedProcedures.push(procedure);
        proceduresPerCategory[category]++;
      }
    }
  }

  // If we still haven't reached the limit, add remaining procedures
  if (selectedProcedures.length < limit) {
    const selectedIds = new Set(selectedProcedures.map(p => p.procedureId));
    
    for (const proc of allProcedures) {
      if (selectedProcedures.length >= limit) break;
      if (!selectedIds.has(proc.procedureId)) {
        selectedProcedures.push(proc);
      }
    }
  }

  return selectedProcedures;
}

/**
 * Get procedures that match a search category
 * Returns all procedures from the specified category
 * 
 * @param {Array} allProcedures - Array of procedure objects
 * @param {String} searchCategory - Category to filter by
 * @returns {Array} Array of matching procedures
 */
function getProceduresByCategory(allProcedures, searchCategory) {
  if (!allProcedures || !searchCategory) {
    return [];
  }
  
  return allProcedures.filter(proc => 
    proc.category.toLowerCase() === searchCategory.toLowerCase()
  );
}

/**
 * Check if a procedure name matches or is in the same category as search term
 * 
 * @param {String} procedureName - Name of the procedure
 * @param {String} category - Category of the procedure
 * @param {String} searchTerm - User's search term
 * @returns {Object} { isMatch: boolean, isCategoryMatch: boolean }
 */
function matchesProcedureSearch(procedureName, category, searchTerm) {
  const lowerProcedure = procedureName.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const lowerCategory = category.toLowerCase();
  
  // Direct match in procedure name
  const isMatch = lowerProcedure.includes(lowerSearch);
  
  // Category match
  const isCategoryMatch = lowerCategory.includes(lowerSearch) || 
                         lowerSearch.includes(lowerCategory);
  
  return { isMatch, isCategoryMatch };
}

module.exports = {
  POPULAR_PROCEDURES_BY_CATEGORY,
  getTopProcedures,
  getProceduresByCategory,
  matchesProcedureSearch
};

