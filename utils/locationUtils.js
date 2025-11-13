const axios = require('axios');
require('dotenv').config();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in miles
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    return null;
  }

  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Geocode a location string (city, state, or zip) to coordinates
 * Uses Google Geocoding API
 * @param {string} location - Location string (e.g., "Palo Alto, CA" or "90210")
 * @returns {Promise<Object|null>} Object with lat, lng, formattedAddress, or null if not found
 */
async function geocodeLocation(location) {
  if (!location || !location.trim()) {
    return null;
  }

  if (!GOOGLE_PLACES_API_KEY) {
    console.warn('GOOGLE_PLACES_API_KEY not configured, geocoding unavailable');
    return null;
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: location,
        key: GOOGLE_PLACES_API_KEY
      },
      timeout: 5000
    });

    if (response.data.status === 'OK' && response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];
      const locationData = result.geometry.location;
      
      return {
        lat: locationData.lat,
        lng: locationData.lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id
      };
    }

    return null;
  } catch (error) {
    console.error('Geocoding error:', error.message);
    return null;
  }
}

/**
 * Parse location input to determine type (city, state, or zip)
 * @param {string} location - Location string
 * @returns {Object} Object with type and parsed value
 */
function parseLocationInput(location) {
  if (!location || !location.trim()) {
    return { type: null, value: null };
  }

  const trimmed = location.trim();

  // Check if it's a zip code (5 digits)
  if (/^\d{5}$/.test(trimmed)) {
    return { type: 'zip', value: trimmed };
  }

  // Check if it's a state abbreviation (2 letters)
  if (/^[A-Z]{2}$/i.test(trimmed)) {
    return { type: 'state', value: trimmed.toUpperCase() };
  }

  // Check if it's a full state name (common states)
  const stateNames = {
    'california': 'CA',
    'texas': 'TX',
    'florida': 'FL',
    'new york': 'NY',
    'illinois': 'IL',
    'pennsylvania': 'PA',
    'ohio': 'OH',
    'georgia': 'GA',
    'north carolina': 'NC',
    'michigan': 'MI',
    'new jersey': 'NJ',
    'virginia': 'VA',
    'washington': 'WA',
    'arizona': 'AZ',
    'massachusetts': 'MA',
    'tennessee': 'TN',
    'indiana': 'IN',
    'missouri': 'MO',
    'maryland': 'MD',
    'wisconsin': 'WI',
    'colorado': 'CO',
    'minnesota': 'MN',
    'south carolina': 'SC',
    'alabama': 'AL',
    'louisiana': 'LA',
    'kentucky': 'KY',
    'oregon': 'OR',
    'oklahoma': 'OK',
    'connecticut': 'CT',
    'utah': 'UT',
    'iowa': 'IA',
    'nevada': 'NV',
    'arkansas': 'AR',
    'mississippi': 'MS',
    'kansas': 'KS',
    'new mexico': 'NM',
    'nebraska': 'NE',
    'west virginia': 'WV',
    'idaho': 'ID',
    'hawaii': 'HI',
    'new hampshire': 'NH',
    'maine': 'ME',
    'montana': 'MT',
    'rhode island': 'RI',
    'delaware': 'DE',
    'south dakota': 'SD',
    'north dakota': 'ND',
    'alaska': 'AK',
    'vermont': 'VT',
    'wyoming': 'WY',
    'district of columbia': 'DC'
  };

  const lowerTrimmed = trimmed.toLowerCase();
  if (stateNames[lowerTrimmed]) {
    return { type: 'state', value: stateNames[lowerTrimmed] };
  }

  // Default to city
  return { type: 'city', value: trimmed };
}

/**
 * Major metro area definitions with center coordinates
 * Used for city searches to include nearby suburbs
 */
const METRO_AREAS = {
  'chicago': { lat: 41.8781, lng: -87.6298, radius: 30, cities: ['chicago', 'evanston', 'oak park', 'schaumburg', 'naperville', 'arlington heights', 'joliet', 'aurora'] },
  'palo alto': { lat: 37.4419, lng: -122.1430, radius: 25, cities: ['palo alto', 'mountain view', 'menlo park', 'redwood city', 'sunnyvale', 'cupertino', 'los altos'] },
  'san francisco': { lat: 37.7749, lng: -122.4194, radius: 30, cities: ['san francisco', 'oakland', 'berkeley', 'san mateo', 'daly city', 'south san francisco'] },
  'los angeles': { lat: 34.0522, lng: -118.2437, radius: 30, cities: ['los angeles', 'beverly hills', 'santa monica', 'pasadena', 'glendale', 'burbank', 'long beach'] },
  'new york': { lat: 40.7128, lng: -74.0060, radius: 30, cities: ['new york', 'brooklyn', 'queens', 'bronx', 'staten island', 'jersey city', 'newark'] },
  'miami': { lat: 25.7617, lng: -80.1918, radius: 25, cities: ['miami', 'miami beach', 'coral gables', 'fort lauderdale', 'west palm beach'] },
  'houston': { lat: 29.7604, lng: -95.3698, radius: 30, cities: ['houston', 'sugar land', 'the woodlands', 'pearland', 'katy'] },
  'dallas': { lat: 32.7767, lng: -96.7970, radius: 30, cities: ['dallas', 'fort worth', 'plano', 'irving', 'garland', 'arlington'] },
  'atlanta': { lat: 33.7490, lng: -84.3880, radius: 30, cities: ['atlanta', 'sandy springs', 'roswell', 'alpharetta', 'marietta'] },
  'boston': { lat: 42.3601, lng: -71.0589, radius: 25, cities: ['boston', 'cambridge', 'somerville', 'quincy', 'newton'] },
  'phoenix': { lat: 33.4484, lng: -112.0740, radius: 30, cities: ['phoenix', 'scottsdale', 'tempe', 'mesa', 'glendale'] },
  'seattle': { lat: 47.6062, lng: -122.3321, radius: 25, cities: ['seattle', 'bellevue', 'redmond', 'tacoma', 'everett'] }
};

/**
 * Find metro area definition for a city
 * @param {string} cityName - City name (case-insensitive)
 * @returns {Object|null} Metro area definition or null
 */
function findMetroArea(cityName) {
  if (!cityName) return null;
  
  const lowerCity = cityName.toLowerCase().trim();
  
  // Check exact match first
  if (METRO_AREAS[lowerCity]) {
    return METRO_AREAS[lowerCity];
  }
  
  // Check if city is in any metro area's cities list
  for (const [metroName, metroData] of Object.entries(METRO_AREAS)) {
    if (metroData.cities.some(c => c.toLowerCase() === lowerCity)) {
      return metroData;
    }
  }
  
  return null;
}

module.exports = {
  calculateDistance,
  geocodeLocation,
  parseLocationInput,
  findMetroArea,
  METRO_AREAS
};

