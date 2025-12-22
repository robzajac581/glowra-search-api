/**
 * Provider Field Definitions
 * Single source of truth for provider data validation and form generation
 */

const PROVIDER_SPECIALTIES = [
  'Plastic Surgery',
  'Med Spa / Aesthetics',
  'Medical',
  'Dermatology',
  'Other'
];

const providerFields = {
  providerName: {
    type: 'string',
    required: true,
    maxLength: 255,
    label: 'Provider Name',
    description: 'Full name and credentials (e.g., Dr. Jane Smith, MD)',
    example: 'Dr. Sarah Johnson',
    placeholder: 'Enter provider name...'
  },
  
  specialty: {
    type: 'string',
    required: false,
    enum: PROVIDER_SPECIALTIES,
    label: 'Specialty',
    description: 'Provider\'s area of specialization',
    example: 'Plastic Surgery'
  },
  
  photoData: {
    type: 'string',
    required: false,
    label: 'Photo (Base64)',
    description: 'Provider headshot as base64 encoded image',
    example: 'data:image/jpeg;base64,/9j/4AAQ...'
  },
  
  photoURL: {
    type: 'string',
    required: false,
    maxLength: 2000,
    label: 'Photo URL',
    description: 'URL to provider headshot if externally hosted',
    example: 'https://example.com/dr-johnson.jpg'
  }
};

module.exports = {
  providerFields,
  PROVIDER_SPECIALTIES
};

