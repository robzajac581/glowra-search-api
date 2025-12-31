/**
 * Provider Field Definitions
 * Single source of truth for provider data validation and form generation
 */

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
  providerFields
};

