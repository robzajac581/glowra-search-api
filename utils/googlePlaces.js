const axios = require('axios');
require('dotenv').config();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GOOGLE_PLACES_API_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

/**
 * Fetches place details from Google Places API
 * @param {string} placeId - Google Place ID
 * @param {boolean} includePhotos - Whether to include photos in the request (default: false)
 * @returns {Promise<Object>} - Place details with rating, reviews, and opening hours
 */
async function fetchGooglePlaceDetails(placeId, includePhotos = false) {
  // Validation
  if (!placeId) {
    throw new Error('Place ID is required');
  }

  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured in environment variables');
  }

  try {
    // Request only the fields we need to minimize API costs
    let fields = 'rating,user_ratings_total,reviews,opening_hours,business_status';
    
    // Add photos field if requested
    if (includePhotos) {
      fields += ',photos';
    }
    
    const response = await axios.get(GOOGLE_PLACES_API_URL, {
      params: {
        place_id: placeId,
        fields: fields,
        key: GOOGLE_PLACES_API_KEY
      },
      timeout: 10000 // 10 second timeout
    });

    // Check API response status
    if (response.data.status === 'OK') {
      const result = response.data.result;
      
      // Structure the response data with fallbacks for missing fields
      const responseData = {
        rating: result.rating || null,
        reviewCount: result.user_ratings_total || 0,
        reviews: parseReviews(result.reviews || []),
        isOpen: determineIsOpen(result.opening_hours),
        openingHours: result.opening_hours?.weekday_text || [],
        businessStatus: result.business_status || 'OPERATIONAL'
      };
      
      // Add photos if they were requested and are available
      if (includePhotos && result.photos) {
        responseData.photos = parsePhotos(result.photos);
      }
      
      return responseData;
    } else if (response.data.status === 'NOT_FOUND') {
      console.warn(`Place not found for Place ID: ${placeId}`);
      return null;
    } else if (response.data.status === 'INVALID_REQUEST') {
      console.error(`INVALID_REQUEST for ${placeId}. Error message:`, response.data.error_message);
      throw new Error('Invalid Place ID or API request');
    } else if (response.data.status === 'OVER_QUERY_LIMIT') {
      throw new Error('Google Places API quota exceeded');
    } else if (response.data.status === 'REQUEST_DENIED') {
      console.error(`REQUEST_DENIED for ${placeId}. Error message:`, response.data.error_message);
      throw new Error('Google Places API request denied - check API key and permissions');
    } else {
      console.error(`Unexpected status ${response.data.status} for ${placeId}. Full response:`, response.data);
      throw new Error(`Google Places API error: ${response.data.status}`);
    }
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw new Error('Google Places API request timed out');
    } else if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Google Places API Error Response:', error.response.data);
      throw new Error(`Google Places API error: ${error.response.status}`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error('No response from Google Places API');
    } else {
      // Something happened in setting up the request
      throw error;
    }
  }
}

/**
 * Fetches place details with retry logic
 * @param {string} placeId - Google Place ID
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {boolean} includePhotos - Whether to include photos in the request (default: false)
 * @returns {Promise<Object>} - Place details or null on failure
 */
async function fetchGooglePlaceDetailsWithRetry(placeId, maxRetries = 3, includePhotos = false) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchGooglePlaceDetails(placeId, includePhotos);
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      // Don't retry on certain errors
      if (error.message.includes('INVALID_REQUEST') || 
          error.message.includes('REQUEST_DENIED') ||
          error.message.includes('NOT_FOUND')) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await sleep(waitTime);
      }
    }
  }
  
  // All retries failed
  throw lastError;
}

/**
 * Parse photos from Google Places API response
 * @param {Array} photos - Raw photos array from API
 * @returns {Array} - Structured photos array with URLs
 */
function parsePhotos(photos) {
  if (!Array.isArray(photos)) {
    return [];
  }

  return photos.map((photo, index) => {
    // Photo reference for constructing URLs
    const photoReference = photo.photo_reference;
    
    // Construct optimized photo URLs
    // For web performance, we'll create multiple sizes
    const baseParams = `key=${GOOGLE_PLACES_API_KEY}&photoreference=${photoReference}`;
    
    return {
      reference: photoReference,
      width: photo.width || null,
      height: photo.height || null,
      // Full size (max 1600px as per Google's limit)
      url: `https://maps.googleapis.com/maps/api/place/photo?${baseParams}&maxwidth=1600`,
      // Optimized sizes for different use cases
      urls: {
        thumbnail: `https://maps.googleapis.com/maps/api/place/photo?${baseParams}&maxwidth=400`,  // Cards/thumbnails
        medium: `https://maps.googleapis.com/maps/api/place/photo?${baseParams}&maxwidth=800`,     // Gallery previews
        large: `https://maps.googleapis.com/maps/api/place/photo?${baseParams}&maxwidth=1600`      // Full screen
      },
      // Attribution (required by Google Terms of Service)
      attributions: photo.html_attributions || [],
      isPrimary: index === 0  // First photo is the primary/featured image
    };
  });
}

/**
 * Parse reviews from Google Places API response
 * @param {Array} reviews - Raw reviews array from API
 * @returns {Array} - Structured reviews array
 */
function parseReviews(reviews) {
  if (!Array.isArray(reviews)) {
    return [];
  }

  return reviews.slice(0, 5).map(review => ({
    author: review.author_name || 'Anonymous',
    rating: review.rating || 0,
    text: review.text || '',
    time: review.time ? new Date(review.time * 1000).toISOString() : null,
    relativeTime: review.relative_time_description || '',
    profilePhoto: review.profile_photo_url || null
  }));
}

/**
 * Determine if a place is currently open
 * @param {Object} openingHours - Opening hours object from API
 * @returns {boolean|null} - True if open, false if closed, null if unknown
 */
function determineIsOpen(openingHours) {
  if (!openingHours) {
    return null;
  }
  
  // Check if the place is currently open
  if (typeof openingHours.open_now === 'boolean') {
    return openingHours.open_now;
  }
  
  return null;
}

/**
 * Check if cached rating data is still fresh
 * @param {Date} lastUpdate - Last update timestamp
 * @param {number} cacheHours - Cache duration in hours
 * @returns {boolean} - True if cache is still valid
 */
function isCacheFresh(lastUpdate, cacheHours = 24) {
  if (!lastUpdate) {
    return false;
  }

  const cacheExpirationMs = cacheHours * 60 * 60 * 1000;
  const now = new Date();
  const updateTime = new Date(lastUpdate);
  const age = now - updateTime;

  return age < cacheExpirationMs;
}

/**
 * Sleep helper function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Batch process multiple place IDs with rate limiting
 * @param {Array<string>} placeIds - Array of Google Place IDs
 * @param {number} concurrency - Number of concurrent requests (default: 5)
 * @param {number} delayMs - Delay between batches in milliseconds (default: 200)
 * @returns {Promise<Array>} - Array of results {placeId, data, error}
 */
async function batchFetchPlaceDetails(placeIds, concurrency = 5, delayMs = 200) {
  const results = [];
  
  // Process in chunks to avoid rate limiting
  for (let i = 0; i < placeIds.length; i += concurrency) {
    const chunk = placeIds.slice(i, i + concurrency);
    
    const chunkResults = await Promise.allSettled(
      chunk.map(async (placeId) => {
        try {
          const data = await fetchGooglePlaceDetailsWithRetry(placeId, 2);
          return { placeId, data, error: null };
        } catch (error) {
          console.error(`Failed to fetch data for ${placeId}:`, error.message);
          return { placeId, data: null, error: error.message };
        }
      })
    );
    
    // Collect results
    chunkResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ placeId: null, data: null, error: result.reason.message });
      }
    });
    
    // Add delay between batches to avoid rate limiting
    if (i + concurrency < placeIds.length) {
      await sleep(delayMs);
    }
  }
  
  return results;
}

/**
 * Fetch photos for a specific place
 * @param {string} placeId - Google Place ID
 * @returns {Promise<Array>} - Array of photo objects
 */
async function fetchPlacePhotos(placeId) {
  try {
    const placeDetails = await fetchGooglePlaceDetails(placeId, true);
    return placeDetails.photos || [];
  } catch (error) {
    console.error(`Failed to fetch photos for place ${placeId}:`, error.message);
    return [];
  }
}

/**
 * Search for a place by text query (clinic name + address)
 * Uses Google Places Text Search API to find matching businesses
 * @param {string} clinicName - Name of the clinic
 * @param {string} address - Full address (street, city, state)
 * @returns {Promise<Object|null>} - Place info with confidence score, or null if not found
 */
async function searchPlaceByText(clinicName, address) {
  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured in environment variables');
  }

  try {
    // Construct search query
    const query = `${clinicName} ${address}`;
    
    // Use Text Search API (findplacefromtext for better accuracy)
    const response = await axios.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
      params: {
        input: query,
        inputtype: 'textquery',
        fields: 'place_id,name,formatted_address,geometry',
        key: GOOGLE_PLACES_API_KEY
      },
      timeout: 10000
    });

    if (response.data.status === 'OK' && response.data.candidates && response.data.candidates.length > 0) {
      const candidate = response.data.candidates[0];
      
      // Calculate confidence based on name similarity
      const confidence = calculateNameSimilarity(clinicName, candidate.name);
      
      return {
        placeId: candidate.place_id,
        name: candidate.name,
        formattedAddress: candidate.formatted_address,
        latitude: candidate.geometry?.location?.lat || null,
        longitude: candidate.geometry?.location?.lng || null,
        confidence
      };
    } else if (response.data.status === 'ZERO_RESULTS') {
      // Try with just the clinic name if address didn't help
      const fallbackResponse = await axios.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
        params: {
          input: clinicName,
          inputtype: 'textquery',
          fields: 'place_id,name,formatted_address,geometry',
          locationbias: `point:${await getApproximateLocation(address)}`, // bias towards the address area
          key: GOOGLE_PLACES_API_KEY
        },
        timeout: 10000
      });

      if (fallbackResponse.data.status === 'OK' && fallbackResponse.data.candidates && fallbackResponse.data.candidates.length > 0) {
        const candidate = fallbackResponse.data.candidates[0];
        const confidence = calculateNameSimilarity(clinicName, candidate.name) * 0.8; // Lower confidence for fallback
        
        return {
          placeId: candidate.place_id,
          name: candidate.name,
          formattedAddress: candidate.formatted_address,
          latitude: candidate.geometry?.location?.lat || null,
          longitude: candidate.geometry?.location?.lng || null,
          confidence
        };
      }
      
      return null;
    } else {
      console.warn(`Places Text Search returned status: ${response.data.status}`);
      return null;
    }
  } catch (error) {
    console.error('Error in searchPlaceByText:', error.message);
    throw error;
  }
}

/**
 * Calculate similarity between two business names
 * Simple implementation - can be improved with fuzzy matching
 * @param {string} name1 - First name
 * @param {string} name2 - Second name
 * @returns {number} - Similarity score 0-1
 */
function calculateNameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;
  
  // Normalize names
  const normalize = (s) => s.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const n1 = normalize(name1);
  const n2 = normalize(name2);
  
  // Exact match
  if (n1 === n2) return 1;
  
  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;
  
  // Calculate word overlap
  const words1 = new Set(n1.split(' '));
  const words2 = new Set(n2.split(' '));
  
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);
  
  const jaccardSimilarity = intersection.length / union.size;
  
  return Math.min(jaccardSimilarity + 0.3, 0.95); // Boost but cap at 0.95
}

/**
 * Get approximate lat/lng for an address (for location biasing)
 * Uses Geocoding API
 * @param {string} address - Address to geocode
 * @returns {Promise<string>} - "lat,lng" string
 */
async function getApproximateLocation(address) {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: address,
        key: GOOGLE_PLACES_API_KEY
      },
      timeout: 5000
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const location = response.data.results[0].geometry.location;
      return `${location.lat},${location.lng}`;
    }
  } catch (error) {
    console.warn('Geocoding failed for location bias:', error.message);
  }
  
  // Default to center of US if geocoding fails
  return '39.8283,-98.5795';
}

module.exports = {
  fetchGooglePlaceDetails,
  fetchGooglePlaceDetailsWithRetry,
  fetchPlacePhotos,
  searchPlaceByText,
  parseReviews,
  parsePhotos,
  isCacheFresh,
  batchFetchPlaceDetails
};

