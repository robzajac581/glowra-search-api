/**
 * Procedure Field Definitions
 * Single source of truth for procedure data validation and form generation
 */

const {
  getValidPriceUnits,
  getPriceUnitAliases
} = require('../../utils/priceUnitNormalizer');
const {
  validatePromotionalFlagInput,
  describeAcceptedPromotionalValues
} = require('../../utils/promotionalFlagNormalizer');

const PROCEDURE_CATEGORIES = [
  'Face',
  'Body',
  'Breast',
  'Butt',
  'Injectables',
  'Skin',
  'Other'
];

// Derived from utils/priceUnitNormalizer rather than redeclared, so the enum
// and the normaliser cannot drift apart (the GLO-68 failure mode, applied here
// before it could happen). glowra-FE keeps its own copy for the form dropdown
// in src/pages/list-your-clinic/constants.js -- that list must be kept in step
// with this one; test/procedurePriceUnitEnum.test.js pins the values it expects.
const PRICE_UNITS = getValidPriceUnits();
const PRICE_UNIT_ALIASES = getPriceUnitAliases();

const procedureFields = {
  procedureName: {
    type: 'string',
    required: true,
    maxLength: 255,
    label: 'Procedure Name',
    description: 'Name of the procedure or treatment',
    example: 'Botox',
    placeholder: 'Enter procedure name...'
  },
  
  category: {
    type: 'string',
    required: true,
    enum: PROCEDURE_CATEGORIES,
    label: 'Category',
    description: 'Body area or type of procedure',
    example: 'Injectables'
  },
  
  priceMin: {
    type: 'number',
    required: false,
    min: 0,
    label: 'Minimum Price',
    description: 'Starting price for this procedure',
    example: 12,
    placeholder: '0'
  },
  
  priceMax: {
    type: 'number',
    required: false,
    min: 0,
    label: 'Maximum Price',
    description: 'Maximum price for this procedure (must be >= minimum)',
    example: 15,
    placeholder: '0'
  },
  
  // The canonical request field is 'unit'. Write paths also accept 'priceUnit'
  // (and 'PriceUnit'), which is the name used in the API response, in the
  // database column, and by glowra-FE's admin review screen -- validateProcedure
  // resolves those to this field before validating, so a payload cannot bypass
  // the enum by choosing the other spelling.
  unit: {
    type: 'string',
    required: false,
    enum: PRICE_UNITS,
    enumAliases: PRICE_UNIT_ALIASES,
    label: 'Price Unit',
    description: 'Unit for the price (e.g., /unit, /session)',
    example: '/unit'
  },
  
  // GLO-72. Three-state, and the third state is the point: true =
  // assessed and promotional, false = assessed and standard, absent/null =
  // NOT ASSESSED. Omitting the field leaves a procedure unassessed; it must
  // never be read as false. See utils/promotionalFlagNormalizer.js.
  //
  // Accepted under 'isPromotional', 'IsPromotional' and 'promotional' --
  // validateProcedure resolves all three to this field before validating, so a
  // payload cannot bypass validation by choosing a different spelling (the
  // GLO-69 priceUnit failure mode).
  isPromotional: {
    type: 'boolean',
    required: false,
    resolve: validatePromotionalFlagInput,
    resolveError: `must be ${describeAcceptedPromotionalValues()}`,
    label: 'Promotional Price',
    description:
      'Whether the price is conditional (new clients only, limited time, package) rather than the standard rate. Leave blank if not assessed.',
    example: true
  },

  averagePrice: {
    type: 'number',
    required: false,
    min: 0,
    label: 'Average Price',
    description: 'If not provided, calculated as (min + max) / 2',
    example: 13.50,
    placeholder: 'Auto-calculated if left blank'
  },
  
  providerNames: {
    type: 'array',
    required: false,
    items: { type: 'string' },
    label: 'Providers',
    description: 'Which providers perform this procedure',
    example: ['Dr. Sarah Johnson', 'Maria Garcia, RN']
  }
};

module.exports = {
  procedureFields,
  PROCEDURE_CATEGORIES,
  PRICE_UNITS,
  PRICE_UNIT_ALIASES
};

