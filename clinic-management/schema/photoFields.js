/**
 * Photo Field Definitions
 * Single source of truth for photo upload validation
 */

const PHOTO_TYPES = ['clinic', 'icon', 'logo'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const clinicPhotoFields = {
  photoType: {
    type: 'string',
    required: true,
    enum: PHOTO_TYPES,
    label: 'Photo Type',
    description: 'Type of photo (clinic gallery or icon/logo)'
  },
  
  photoData: {
    type: 'string',
    required: false,
    label: 'Photo Data',
    description: 'Base64 encoded image data (for direct upload)',
    example: 'data:image/jpeg;base64,/9j/4AAQ...'
  },
  
  photoURL: {
    type: 'string',
    required: false,
    maxLength: 2000,
    pattern: /^https?:\/\/.+/,
    label: 'Photo URL',
    description: 'URL of externally hosted image',
    example: 'https://example.com/clinic-photo.jpg'
  },
  
  fileName: {
    type: 'string',
    required: false,
    maxLength: 255,
    label: 'File Name',
    description: 'Original file name',
    example: 'clinic-exterior.jpg'
  },
  
  mimeType: {
    type: 'string',
    required: false,
    enum: ALLOWED_MIME_TYPES,
    label: 'MIME Type',
    description: 'Image format'
  },
  
  isPrimary: {
    type: 'boolean',
    required: false,
    default: false,
    label: 'Primary Photo',
    description: 'Set as the main photo shown on search cards'
  },
  
  displayOrder: {
    type: 'number',
    required: false,
    min: 0,
    default: 0,
    label: 'Display Order',
    description: 'Order for displaying in gallery (0 = first)'
  },
  
  caption: {
    type: 'string',
    required: false,
    maxLength: 500,
    label: 'Caption',
    description: 'Optional caption or alt text for the image'
  }
};

const providerPhotoFields = {
  photoData: {
    type: 'string',
    required: false,
    label: 'Photo Data',
    description: 'Base64 encoded provider headshot',
    example: 'data:image/jpeg;base64,/9j/4AAQ...'
  },
  
  photoURL: {
    type: 'string',
    required: false,
    maxLength: 2000,
    pattern: /^https?:\/\/.+/,
    label: 'Photo URL',
    description: 'URL of externally hosted provider photo',
    example: 'https://example.com/dr-smith.jpg'
  }
};

/**
 * Validate a photo object
 * @param {object} photo - Photo object to validate
 * @returns {object} - { valid: boolean, errors: array }
 */
function validatePhoto(photo) {
  const errors = [];
  
  // Support both camelCase (photoUrl) and PascalCase (photoURL) for backward compatibility
  const photoUrl = photo.photoUrl || photo.photoURL;
  const photoData = photo.photoData;
  
  // Must have either photoData or photoURL/photoUrl
  // Google photos (source: 'google') only need photoUrl, user photos need either photoData or photoUrl
  if (!photoData && !photoUrl) {
    errors.push({ field: 'photoUrl', message: 'Either photoData or photoUrl is required' });
  }
  
  // Validate MIME type if provided
  if (photo.mimeType && !ALLOWED_MIME_TYPES.includes(photo.mimeType)) {
    errors.push({ 
      field: 'mimeType', 
      message: `Invalid image type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` 
    });
  }
  
  // Validate base64 data if provided
  if (photoData) {
    // Check if it's a valid data URL
    const dataUrlRegex = /^data:image\/(jpeg|png|webp|gif);base64,/;
    if (!dataUrlRegex.test(photoData)) {
      errors.push({ 
        field: 'photoData', 
        message: 'Invalid image data. Must be base64 encoded with data URL prefix' 
      });
    }
    
    // Rough size check (base64 is ~33% larger than original)
    const base64Data = photoData.split(',')[1] || '';
    const estimatedSize = (base64Data.length * 3) / 4;
    if (estimatedSize > MAX_FILE_SIZE) {
      errors.push({ 
        field: 'photoData', 
        message: `Image too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
      });
    }
  }
  
  // Validate URL if provided (support both camelCase and PascalCase)
  if (photoUrl) {
    try {
      new URL(photoUrl);
    } catch {
      errors.push({ field: 'photoUrl', message: 'Invalid URL format' });
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate array of clinic photos
 * @param {array} photos - Array of photo objects
 * @returns {object} - { valid: boolean, errors: array }
 */
function validateClinicPhotos(photos) {
  if (!photos || photos.length === 0) {
    return { valid: true, errors: [] }; // Photos are optional
  }
  
  const errors = [];
  let primaryCount = 0;
  
  photos.forEach((photo, index) => {
    const result = validatePhoto(photo);
    result.errors.forEach(err => {
      errors.push({ 
        field: `photos[${index}].${err.field}`, 
        message: err.message 
      });
    });
    
    if (photo.isPrimary) primaryCount++;
  });
  
  // Warn if multiple primary photos (will use first one)
  if (primaryCount > 1) {
    errors.push({ 
      field: 'photos', 
      message: 'Multiple photos marked as primary. Only the first will be used.' 
    });
  }
  
  return { valid: errors.length === 0, errors };
}

module.exports = {
  clinicPhotoFields,
  providerPhotoFields,
  validatePhoto,
  validateClinicPhotos,
  PHOTO_TYPES,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE
};

