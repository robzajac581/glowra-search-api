/**
 * Clinic Field Definitions
 * Single source of truth for clinic data validation and form generation
 */

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois',
  'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts',
  'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming'
];

const CLINIC_CATEGORIES = [
  'Plastic Surgery',
  'Med Spa / Aesthetics',
  'Medical',
  'Dermatology',
  'Other'
];

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
    label: 'State',
    description: 'US state where the clinic is located',
    example: 'Florida'
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
    label: 'Clinic Category',
    description: 'Primary category of the clinic',
    example: 'Med Spa / Aesthetics'
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
  CLINIC_CATEGORIES
};

