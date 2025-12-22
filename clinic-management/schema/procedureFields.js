/**
 * Procedure Field Definitions
 * Single source of truth for procedure data validation and form generation
 */

const PROCEDURE_CATEGORIES = [
  'Face',
  'Body',
  'Breast',
  'Butt',
  'Injectables',
  'Skin',
  'Other'
];

const PRICE_UNITS = [
  '',           // No unit (blank)
  '/unit',
  '/session',
  '/injection',
  '/area',
  '/treatment',
  '/syringe',
  '/vial'
];

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
  
  unit: {
    type: 'string',
    required: false,
    enum: PRICE_UNITS,
    label: 'Price Unit',
    description: 'Unit for the price (e.g., /unit, /session)',
    example: '/unit'
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
  PRICE_UNITS
};

