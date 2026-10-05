/**
 * Clinic Field Definitions
 * Single source of truth for clinic data validation and form generation
 */

// Single source of truth: the canonical state list lives in
// utils/stateNormalizer.js, which is what every write path runs values through
// before storing them. This file used to redeclare the list as FULL NAMES
// ('Florida'), so validateClinic() rejected the normaliser's own output ('FL')
// -- the same second-spelling trap GLO-68 fixed for categories.
//
// STATE_ALIASES keeps full names accepted on input: glowra-FE's
// list-your-clinic form (src/pages/list-your-clinic/constants.js) and the
// admin BasicInfoTab both submit 'Florida'. Accepting it keeps those forms
// working while the canonical stored value stays the two-letter USPS code.
const {
  getValidStateValues,
  getStateAliases: getClinicStateAliases
} = require('../../utils/stateNormalizer');

const US_STATES = getValidStateValues();
const US_STATE_ALIASES = getClinicStateAliases();

// Single source of truth: the canonical category list lives in
// utils/categoryNormalizer.js, which is what every write path runs values
// through before storing them. This file used to redeclare the list with
// 'Med Spa / Aesthetics' instead of 'Medspa / Aesthetics', so validateClinic()
// rejected the normaliser's own output (GLO-68).
//
// CLINIC_CATEGORY_ALIASES keeps the older 'Med Spa / Aesthetics' spelling
// accepted on input -- glowra-FE's list-your-clinic form still submits it.
const {
  getValidCategories,
  CATEGORY_ALIASES: CLINIC_CATEGORY_ALIASES
} = require('../../utils/categoryNormalizer');

const CLINIC_CATEGORIES = getValidCategories();

const clinicFields = {
  clinicName: {
    type: 'string',
    required: true,
    maxLength: 255,
    label: 'Clinic Name',
    description: 'The official name as it appears on the clinic\'s website',
    example: 'Skin Solutions Miami',
    placeholder: 'Enter clinic name...'
  },
  
  address: {
    type: 'string',
    required: true,
    maxLength: 500,
    label: 'Street Address',
    description: 'Full street address (not including city/state)',
    example: '123 Collins Ave, Suite 400',
    placeholder: 'Enter street address...'
  },
  
  city: {
    type: 'string',
    required: true,
    maxLength: 100,
    label: 'City',
    description: 'City where the clinic is located',
    example: 'Miami Beach',
    placeholder: 'Enter city...'
  },
  
  state: {
    type: 'string',
    required: true,
    maxLength: 100,
    enum: US_STATES,
    enumAliases: US_STATE_ALIASES,
    label: 'State',
    description: 'US state, stored as its two-letter USPS code. Full names are accepted on input and normalised.',
    example: 'FL'
  },
  
  zipCode: {
    type: 'string',
    required: false,
    pattern: /^\d{5}(-\d{4})?$/,
    label: 'Zip Code',
    description: '5-digit ZIP code',
    example: '33139',
    placeholder: 'Enter ZIP code...'
  },
  
  category: {
    type: 'string',
    required: true,
    enum: CLINIC_CATEGORIES,
    enumAliases: CLINIC_CATEGORY_ALIASES,
    label: 'Clinic Category',
    description: 'Primary category of the clinic',
    example: 'Medspa / Aesthetics'
  },
  
  website: {
    type: 'string',
    required: false,
    maxLength: 500,
    pattern: /^https?:\/\/.+/,
    label: 'Website',
    description: 'Must start with http:// or https://',
    example: 'https://skinsolutionsmiami.com',
    placeholder: 'https://'
  },
  
  phone: {
    type: 'string',
    required: false,
    maxLength: 50,
    pattern: /^\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/,
    label: 'Phone',
    description: 'Format: (XXX) XXX-XXXX or XXX-XXX-XXXX',
    example: '(305) 555-1234',
    placeholder: '(XXX) XXX-XXXX'
  },
  
  email: {
    type: 'string',
    required: false,
    maxLength: 255,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    label: 'Email',
    description: 'Contact email for the clinic',
    example: 'info@skinsolutionsmiami.com',
    placeholder: 'email@example.com'
  }
};

/**
 * Advanced clinic fields (optional - for scrapers/power users)
 */
const advancedClinicFields = {
  latitude: {
    type: 'number',
    required: false,
    min: -90,
    max: 90,
    label: 'Latitude',
    description: 'Geographic latitude coordinate',
    example: 25.7617,
    placeholder: 'e.g., 25.7617'
  },
  
  longitude: {
    type: 'number',
    required: false,
    min: -180,
    max: 180,
    label: 'Longitude',
    description: 'Geographic longitude coordinate',
    example: -80.1918,
    placeholder: 'e.g., -80.1918'
  },
  
  placeID: {
    type: 'string',
    required: false,
    maxLength: 500,
    label: 'Google Place ID',
    description: 'Google Maps Place ID for this location',
    example: 'ChIJrTLr-GyuEmsRBfy61i59si0',
    placeholder: 'ChIJ...'
  },
  
  description: {
    type: 'string',
    required: false,
    maxLength: 2000,
    label: 'Clinic Description',
    description: 'A brief description of the clinic and its services',
    example: 'Skin Solutions Miami is a premier med spa offering...',
    placeholder: 'Describe the clinic...'
  },
  
  bookingURL: {
    type: 'string',
    required: false,
    maxLength: 1000,
    pattern: /^https?:\/\/.+/,
    label: 'Booking URL',
    description: 'Direct link to book an appointment',
    example: 'https://skinsolutionsmiami.com/book',
    placeholder: 'https://'
  },
  
  googleProfileLink: {
    type: 'string',
    required: false,
    maxLength: 1000,
    pattern: /^https?:\/\/.+/,
    label: 'Google Maps Link',
    description: 'Link to the clinic\'s Google Maps profile',
    example: 'https://maps.google.com/?cid=...',
    placeholder: 'https://maps.google.com/...'
  },
  
  // Social Media
  facebook: {
    type: 'string',
    required: false,
    maxLength: 500,
    pattern: /^https?:\/\/(www\.)?facebook\.com\/.+/,
    label: 'Facebook',
    description: 'Facebook page URL',
    example: 'https://facebook.com/skinsolutionsmiami',
    placeholder: 'https://facebook.com/...'
  },
  
  instagram: {
    type: 'string',
    required: false,
    maxLength: 500,
    pattern: /^https?:\/\/(www\.)?instagram\.com\/.+/,
    label: 'Instagram',
    description: 'Instagram profile URL',
    example: 'https://instagram.com/skinsolutionsmiami',
    placeholder: 'https://instagram.com/...'
  },
  
  linkedin: {
    type: 'string',
    required: false,
    maxLength: 500,
    pattern: /^https?:\/\/(www\.)?linkedin\.com\/.+/,
    label: 'LinkedIn',
    description: 'LinkedIn page URL',
    example: 'https://linkedin.com/company/skinsolutionsmiami',
    placeholder: 'https://linkedin.com/...'
  },
  
  twitter: {
    type: 'string',
    required: false,
    maxLength: 500,
    label: 'Twitter/X',
    description: 'Twitter/X profile URL',
    example: 'https://twitter.com/skinsolutions',
    placeholder: 'https://twitter.com/...'
  },
  
  youtube: {
    type: 'string',
    required: false,
    maxLength: 500,
    pattern: /^https?:\/\/(www\.)?youtube\.com\/.+/,
    label: 'YouTube',
    description: 'YouTube channel URL',
    example: 'https://youtube.com/@skinsolutionsmiami',
    placeholder: 'https://youtube.com/...'
  },
  
  workingHours: {
    type: 'object',
    required: false,
    label: 'Working Hours',
    description: 'Operating hours by day of week (JSON format)',
    example: {
      Monday: '9AM-5PM',
      Tuesday: '9AM-5PM',
      Wednesday: '9AM-5PM',
      Thursday: '9AM-5PM',
      Friday: '9AM-5PM',
      Saturday: '9AM-2PM',
      Sunday: 'Closed'
    }
  }
};

module.exports = {
  clinicFields,
  advancedClinicFields,
  US_STATES,
  CLINIC_CATEGORIES,
  CLINIC_CATEGORY_ALIASES
};

