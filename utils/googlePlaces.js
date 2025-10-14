const axios = require('axios');
require('dotenv').config();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GOOGLE_PLACES_API_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

/**
 * Fetches place details from Google Places API
 * @param {string} placeId - Google Place ID
 * @returns {Promise<Object>} - Place details with rating, reviews, and opening hours
 */
async function fetchGooglePlaceDetails(placeId) {
  // Validation
  if (!placeId) {
    throw new Error('Place ID is required');
  }

  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured in environment variables');
  }

  try {
    // Request only the fields we need to minimize API costs
    const fields = 'rating,user_ratings_total,reviews,opening_hours,business_status';
    
    const response = await axios.get(GOOGLE_PLACES_API_URL, {
      params: {
        place_id: placeId,
        fields: fields,
        key: GOOGLE_PLACES_API_KEY
      },
      timeout: 10000 // 10 second timeout
    });

    // Detailed logging for diagnosis
    console.log('=== Google API Response for', placeId, '===');
    console.log('Status:', response.data.status);
    console.log('Full result:', JSON.stringify(response.data.result, null, 2));
    console.log('==========================================');

    // Check API response status
    if (response.data.status === 'OK') {
      const result = response.data.result;
      
      // Log what data we received
      console.log(`✓ Place ${placeId}:`);
      console.log(`  - Rating: ${result.rating || 'NONE'}`);
      console.log(`  - Review Count: ${result.user_ratings_total || 'NONE'}`);
      console.log(`  - Reviews array length: ${result.reviews?.length || 0}`);
      
      // Structure the response data with fallbacks for missing fields
      return {
        rating: result.rating || null,
        reviewCount: result.user_ratings_total || 0,
        reviews: parseReviews(result.reviews || []),
        isOpen: determineIsOpen(result.opening_hours),
        openingHours: result.opening_hours?.weekday_text || [],
        businessStatus: result.business_status || 'OPERATIONAL'
      };
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
 * @returns {Promise<Object>} - Place details or null on failure
 */
async function fetchGooglePlaceDetailsWithRetry(placeId, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Fetching Google Places data for ${placeId} (attempt ${attempt}/${maxRetries})`);
      return await fetchGooglePlaceDetails(placeId);
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
        console.log(`Waiting ${waitTime}ms before retry...`);
        await sleep(waitTime);
      }
    }
  }
  
  // All retries failed
  throw lastError;
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

module.exports = {
  fetchGooglePlaceDetails,
  fetchGooglePlaceDetailsWithRetry,
  parseReviews,
  isCacheFresh,
  batchFetchPlaceDetails
};

