// app.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { sql, db } = require('./db');
const { batchFetchPlaceDetails } = require('./utils/googlePlaces');
const { initRatingRefreshJob } = require('./jobs/scheduledRefresh');
const clinicManagementRouter = require('./clinic-management');
const { calculateDistance, geocodeLocation, parseLocationInput, findMetroArea, stateMatches } = require('./utils/locationUtils');
const { normalizeCategory } = require('./utils/categoryNormalizer');
const app = express();
const port = process.env.PORT || 3001;

// Load environment configuration
require('dotenv').config();

// Determine allowed origins based on environment
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [
      'https://glowra.com',
      'https://www.glowra.com',
      'https://glowra-fe.vercel.app',
      'https://glowra-search-api.onrender.com', // Allow Swagger UI from production
    ]
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173', // Vite default
      'https://glowra.com',
      'https://www.glowra.com',
      'https://glowra-fe.vercel.app',
      'https://glowra-search-api.onrender.com', // Allow production testing
    ];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Submitted-By', 'X-Reviewed-By'],
  credentials: true,
};

// Trust proxy headers (required for proper protocol detection behind proxies like Render, Heroku, etc.)
app.set('trust proxy', true);

app.use(cors(corsOptions));
// Increase JSON body size limit to support base64 image uploads
// Base64 encoding increases file size by ~33%, so 15MB covers 10MB files
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Photo cache configuration
const PHOTO_CACHE_DIR = path.join(__dirname, '.photo-cache');
const PHOTO_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Ensure cache directory exists
(async () => {
  try {
    await fs.mkdir(PHOTO_CACHE_DIR, { recursive: true });
    console.log('Photo cache directory initialized');
  } catch (error) {
    console.error('Failed to create photo cache directory:', error);
  }
})();

/**
 * Provider Photo Endpoint - Serves provider photos from database
 * GET /api/provider-photos/:providerId
 * 
 * This endpoint:
 * - Serves provider photos stored as binary data in the database
 * - Works in production without requiring filesystem access
 * - Caches photos for 7 days for better performance
 * - Returns actual image binary data with proper content type
 */
app.get('/api/provider-photos/:providerId', async (req, res) => {
  let pool;
  try {
    const { providerId } = req.params;
    
    // Validate provider ID
    if (!providerId || isNaN(parseInt(providerId))) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }

    const request = pool.request();
    request.input('providerId', sql.Int, parseInt(providerId));

    const result = await request.query(`
      SELECT 
        PhotoData,
        PhotoContentType,
        ProviderName
      FROM Providers
      WHERE ProviderID = @providerId AND PhotoData IS NOT NULL
    `);

    if (result.recordset.length === 0 || !result.recordset[0].PhotoData) {
      return res.status(404).json({ error: 'Photo not found for this provider' });
    }

    const photo = result.recordset[0];
    const contentType = photo.PhotoContentType || 'image/jpeg';
    
    // Set cache headers (7 days)
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=604800', // 7 days
      'ETag': `"${Buffer.from(photo.PhotoData).toString('base64', 0, 32)}"`,
      'Content-Length': photo.PhotoData.length
    });

    // Send binary image data
    res.send(photo.PhotoData);
  } catch (error) {
    console.error('Error serving provider photo:', error);
    res.status(500).json({ error: 'Failed to retrieve photo' });
  }
});

/**
 * Photo Proxy Endpoint - Handles Google Places photos with caching
 * GET /api/photos/clinic/:clinicId
 * 
 * This endpoint:
 * - Proxies Google Places photos to avoid frontend rate limiting
 * - Caches images locally for 7 days
 * - Uses authenticated API requests to Google
 * - Returns actual image binary data with proper headers
 */
app.get('/api/photos/clinic/:clinicId', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    
    // Validate clinic ID
    if (!clinicId || isNaN(parseInt(clinicId))) {
      return res.status(400).json({ error: 'Invalid clinic ID' });
    }

    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }

    const request = pool.request();
    request.input('clinicId', sql.Int, parseInt(clinicId));

    // First, try to get the photo URL from GooglePlacesData, fallback to ClinicPhotos
    const result = await request.query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        COALESCE(g.Photo, cp.PhotoURL) as PhotoURL
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      LEFT JOIN (
        SELECT ClinicID, PhotoURL,
          ROW_NUMBER() OVER (PARTITION BY ClinicID ORDER BY IsPrimary DESC, DisplayOrder ASC) as RowNum
        FROM ClinicPhotos
      ) cp ON c.ClinicID = cp.ClinicID AND cp.RowNum = 1
      WHERE c.ClinicID = @clinicId
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    const clinic = result.recordset[0];
    const photoURL = clinic.PhotoURL;

    if (!photoURL) {
      return res.status(404).json({ error: 'No photo available for this clinic' });
    }

    // Generate cache key based on photo URL
    const cacheKey = crypto.createHash('md5').update(photoURL).digest('hex');
    const cacheFilePath = path.join(PHOTO_CACHE_DIR, `${cacheKey}.jpg`);
    const cacheMetaPath = path.join(PHOTO_CACHE_DIR, `${cacheKey}.meta.json`);

    // Check if cached version exists and is fresh
    let cachedPhoto = null;
    try {
      const stats = await fs.stat(cacheFilePath);
      const meta = JSON.parse(await fs.readFile(cacheMetaPath, 'utf-8'));
      
      const cacheAge = Date.now() - stats.mtimeMs;
      
      if (cacheAge < PHOTO_CACHE_DURATION) {
        cachedPhoto = await fs.readFile(cacheFilePath);
        
        // Serve cached image
        res.set({
          'Content-Type': meta.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800', // 7 days
          'X-Cache': 'HIT',
          'Last-Modified': stats.mtime.toUTCString(),
          'ETag': `"${cacheKey}"`
        });
        
        return res.send(cachedPhoto);
      }
    } catch (error) {
      // Cache miss or expired - continue to fetch from Google
    }

    // Fetch from Google Places API with authentication
    // The photoURL already contains the photo reference and API key
    try {
      const response = await axios.get(photoURL, {
        responseType: 'arraybuffer',
        timeout: 15000, // 15 second timeout
        maxRedirects: 5
      });

      const imageBuffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/jpeg';

      // Cache the image
      await fs.writeFile(cacheFilePath, imageBuffer);
      await fs.writeFile(cacheMetaPath, JSON.stringify({
        contentType,
        clinicId: clinic.ClinicID,
        clinicName: clinic.ClinicName,
        cachedAt: new Date().toISOString()
      }));

      // Serve the image
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800', // 7 days
        'X-Cache': 'MISS',
        'ETag': `"${cacheKey}"`
      });

      return res.send(imageBuffer);

    } catch (fetchError) {
      console.error(`Failed to fetch photo for clinic ${clinicId}:`, fetchError.message);

      // Check for specific error types
      if (fetchError.response?.status === 429) {
        // Rate limited by Google
        return res.status(503).set({
          'Retry-After': '60',
          'X-Error': 'Rate limited'
        }).json({ 
          error: 'Service temporarily unavailable due to rate limiting',
          retryAfter: 60
        });
      }

      if (fetchError.response?.status === 403) {
        return res.status(403).json({ 
          error: 'Access denied by photo provider',
          message: 'API key may be invalid or photo access is restricted'
        });
      }

      // For other errors, return 404 (photo not available)
      return res.status(404).json({ 
        error: 'Photo could not be retrieved',
        message: process.env.NODE_ENV === 'development' ? fetchError.message : undefined
      });
    }

  } catch (error) {
    console.error('Error in /api/photos/clinic/:clinicId:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Photo Proxy Endpoint for Individual Photos - Handles Google Places photos by PhotoID with caching
 * GET /api/photos/proxy/:photoId
 * 
 * This endpoint:
 * - Proxies individual Google Places photos from ClinicPhotos table
 * - Supports size parameter: thumbnail (400px), medium (800px), large (1600px)
 * - Caches images locally for 7 days
 * - Uses authenticated API requests to Google
 * - Returns actual image binary data with proper headers
 */
app.get('/api/photos/proxy/:photoId', async (req, res) => {
  let pool;
  try {
    const { photoId } = req.params;
    const { size = 'medium' } = req.query;
    
    // Validate photo ID
    if (!photoId || isNaN(parseInt(photoId))) {
      return res.status(400).json({ error: 'Invalid photo ID' });
    }

    // Validate and map size parameter to maxwidth
    const sizeMap = {
      'thumbnail': 400,
      'medium': 800,
      'large': 1600
    };
    
    const maxWidth = sizeMap[size] || 800;

    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }

    const request = pool.request();
    request.input('photoId', sql.Int, parseInt(photoId));

    // Get the photo reference and URL from ClinicPhotos table
    const result = await request.query(`
      SELECT 
        PhotoID,
        PhotoReference,
        PhotoURL,
        ClinicID
      FROM ClinicPhotos
      WHERE PhotoID = @photoId
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photo = result.recordset[0];
    
    // Construct the Google Places Photo URL with the appropriate size
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const photoURL = `https://maps.googleapis.com/maps/api/place/photo?key=${apiKey}&photoreference=${photo.PhotoReference}&maxwidth=${maxWidth}`;

    // Generate cache key based on photo ID and size
    const cacheKey = crypto.createHash('md5').update(`${photoId}-${size}`).digest('hex');
    const cacheFilePath = path.join(PHOTO_CACHE_DIR, `${cacheKey}.jpg`);
    const cacheMetaPath = path.join(PHOTO_CACHE_DIR, `${cacheKey}.meta.json`);

    // Check if cached version exists and is fresh
    let cachedPhoto = null;
    try {
      const stats = await fs.stat(cacheFilePath);
      const meta = JSON.parse(await fs.readFile(cacheMetaPath, 'utf-8'));
      
      const cacheAge = Date.now() - stats.mtimeMs;
      
      if (cacheAge < PHOTO_CACHE_DURATION) {
        cachedPhoto = await fs.readFile(cacheFilePath);
        
        // Serve cached image
        res.set({
          'Content-Type': meta.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800', // 7 days
          'X-Cache': 'HIT',
          'Last-Modified': stats.mtime.toUTCString(),
          'ETag': `"${cacheKey}"`
        });
        
        return res.send(cachedPhoto);
      }
    } catch (error) {
      // Cache miss or expired - continue to fetch from Google
    }

    // Fetch from Google Places API with authentication
    try {
      const response = await axios.get(photoURL, {
        responseType: 'arraybuffer',
        timeout: 15000, // 15 second timeout
        maxRedirects: 5
      });

      const imageBuffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/jpeg';

      // Cache the image
      await fs.writeFile(cacheFilePath, imageBuffer);
      await fs.writeFile(cacheMetaPath, JSON.stringify({
        contentType,
        photoId: photo.PhotoID,
        clinicId: photo.ClinicID,
        size: size,
        maxWidth: maxWidth,
        cachedAt: new Date().toISOString()
      }));

      // Serve the image
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800', // 7 days
        'X-Cache': 'MISS',
        'ETag': `"${cacheKey}"`
      });

      return res.send(imageBuffer);

    } catch (fetchError) {
      console.error(`Failed to fetch photo ${photoId}:`, fetchError.message);

      // Check for specific error types
      if (fetchError.response?.status === 429) {
        // Rate limited by Google
        return res.status(503).set({
          'Retry-After': '60',
          'X-Error': 'Rate limited'
        }).json({ 
          error: 'Service temporarily unavailable due to rate limiting',
          retryAfter: 60
        });
      }

      if (fetchError.response?.status === 403) {
        return res.status(403).json({ 
          error: 'Access denied by photo provider',
          message: 'API key may be invalid or photo access is restricted'
        });
      }

      // For other errors, return 404 (photo not available)
      return res.status(404).json({ 
        error: 'Photo could not be retrieved',
        message: process.env.NODE_ENV === 'development' ? fetchError.message : undefined
      });
    }

  } catch (error) {
    console.error('Error in /api/photos/proxy/:photoId:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get specific clinic details
app.get('/api/procedures', async (req, res) => {
  let pool;
  try {
    const { searchQuery, location, minPrice, maxPrice, category, page = 1, limit = 100 } = req.query;
    
    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }

    let query = `
      SELECT 
        p.ProcedureID,
        p.ProcedureName,
        p.AverageCost,
        l.City,
        l.State,
        c.Category,
        pr.ProviderName,
        cl.ClinicID,
        cl.ClinicName,
        cl.Address,
        cl.Website
      FROM Procedures p
      JOIN Locations l ON p.LocationID = l.LocationID
      JOIN Categories c ON p.CategoryID = c.CategoryID
      JOIN Providers pr ON p.ProviderID = pr.ProviderID
      JOIN Clinics cl ON pr.ClinicID = cl.ClinicID
      WHERE 1=1
    `;
    
    const conditions = [];
    const parameters = {};

    // Add improved fuzzy matching for search query
    if (searchQuery && searchQuery.trim()) {
      // Break the search query into individual words
      const terms = searchQuery.trim().split(/\s+/).filter(term => term.length > 1);
      
      if (terms.length > 0) {
        // Create pattern for each word - search in multiple fields
        const termConditions = terms.map((term, index) => {
          // Create a parameter for this term
          const paramName = `term${index}`;
          parameters[paramName] = `%${term}%`;
          
          // Search across multiple fields
          return `(
            p.ProcedureName LIKE @${paramName} OR 
            cl.ClinicName LIKE @${paramName} OR 
            pr.ProviderName LIKE @${paramName} OR
            c.Category LIKE @${paramName}
          )`;
        });
        
        // Combine with OR - a result matches if any term is found
        // You could use AND instead to require all terms to match
        conditions.push(`(${termConditions.join(' OR ')})`);
      }
    }

    // Add other filter conditions as before
    if (location) {
      conditions.push(`(l.City LIKE @location OR l.State LIKE @location)`);
      parameters.location = `%${location}%`;
    }

    // Handle min price if provided
    if (minPrice) {
      conditions.push(`p.AverageCost >= @minPrice`);
      parameters.minPrice = Number(minPrice);
    }

    // Handle max price if provided
    if (maxPrice) {
      conditions.push(`p.AverageCost <= @maxPrice`);
      parameters.maxPrice = Number(maxPrice);
    }

    if (category) {
      conditions.push(`c.Category LIKE @category`);
      parameters.category = `%${category}%`;
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }
    

    // Add ORDER BY to prioritize exact matches first
    if (searchQuery && searchQuery.trim()) {
      // This ordering will prioritize exact matches in the name
      query += `
        ORDER BY 
          CASE WHEN p.ProcedureName LIKE @exactMatch THEN 0
               WHEN p.ProcedureName LIKE @startMatch THEN 1
               WHEN p.ProcedureName LIKE @containsMatch THEN 2
               ELSE 3
          END,
          p.ProcedureName
      `;
      parameters.exactMatch = searchQuery.trim();
      parameters.startMatch = searchQuery.trim() + '%';
      parameters.containsMatch = '%' + searchQuery.trim() + '%';
    } else {
      query += ` ORDER BY p.ProcedureID`;
    }

    // Add pagination
    query += `
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;
    
    const offset = (Number(page) - 1) * Number(limit);
    parameters.offset = offset;
    parameters.limit = Number(limit);

    // Create count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM Procedures p
      JOIN Locations l ON p.LocationID = l.LocationID
      JOIN Categories c ON p.CategoryID = c.CategoryID
      JOIN Providers pr ON p.ProviderID = pr.ProviderID
      JOIN Clinics cl ON pr.ClinicID = cl.ClinicID
      WHERE ${conditions.length > 0 ? conditions.join(' AND ') : '1=1'}
    `;

    // Execute queries
    const request = pool.request();
    Object.entries(parameters).forEach(([key, value]) => {
      request.input(key, value);
    });

    // Execute both queries
    const [results, countResult] = await Promise.all([
      request.query(query),
      request.query(countQuery)
    ]);

    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      procedures: results.recordset,
      pagination: {
        total,
        totalPages,
        currentPage: Number(page),
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error('Error in /api/procedures:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/procedures/search-index', async (req, res) => {
  let pool;
  try {
    pool = await db.getConnection();
    const result = await pool.request().query(`
      SELECT 
        p.ProcedureID,
        p.ProcedureName,
        p.AverageCost,
        l.City,
        l.State,
        c.Category,
        pr.ProviderName,
        cl.ClinicID,
        cl.ClinicName,
        cl.Address,
        cl.Website
      FROM Procedures p
      JOIN Locations l ON p.LocationID = l.LocationID
      JOIN Categories c ON p.CategoryID = c.CategoryID
      JOIN Providers pr ON p.ProviderID = pr.ProviderID
      JOIN Clinics cl ON pr.ClinicID = cl.ClinicID
    `);
    
    res.json(result.recordset);
  } catch (error) {
    console.error('Error in /api/procedures/search-index:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all clinics with their procedures for clinic-based search
// This endpoint returns a clinic-centric data structure for client-side search
// Supports optional filtering by location and procedure
// Query parameters:
//   - location: city name, state abbreviation, or zip code
//   - procedure: procedure name (case-insensitive, partial match)
//   - radius: radius in miles for location searches (default: 20-30 for cities, 20 for zip)
app.get('/api/clinics/search-index', async (req, res) => {
  let pool;
  try {
    const { location, procedure, radius } = req.query;
    
    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }

    // Query to get all clinics with their procedures
    // Includes Latitude and Longitude for distance calculations
    // Excludes providers that are placeholder "Please Request Consult" entries
    // Excludes clinics without photos from any source (temporary filter until photo data is complete)
    const result = await pool.request().query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        c.Address,
        COALESCE(l.City, g.City) as City,
        COALESCE(l.State, g.State) as State,
        g.PostalCode,
        c.Latitude,
        c.Longitude,
        c.GoogleRating,
        c.GoogleReviewCount,
        COALESCE(g.Category, 'Medical Spa') as ClinicCategory,
        COALESCE(g.Photo, cp.PhotoURL) as PhotoURL,
        p.ProcedureID,
        p.ProcedureName,
        p.AverageCost,
        cat.Category as ProcedureCategory
      FROM Clinics c
      LEFT JOIN Locations l ON c.LocationID = l.LocationID
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      LEFT JOIN (
        SELECT ClinicID, PhotoURL,
          ROW_NUMBER() OVER (PARTITION BY ClinicID ORDER BY IsPrimary DESC, DisplayOrder ASC) as RowNum
        FROM ClinicPhotos
      ) cp ON c.ClinicID = cp.ClinicID AND cp.RowNum = 1
      JOIN Providers pr ON c.ClinicID = pr.ClinicID
      JOIN Procedures p ON pr.ProviderID = p.ProviderID
      JOIN Categories cat ON p.CategoryID = cat.CategoryID
      WHERE pr.ProviderName NOT LIKE '%Please Request Consult%'
        AND (g.Photo IS NOT NULL OR cp.PhotoURL IS NOT NULL)
      ORDER BY c.ClinicID, p.ProcedureName
    `);

    // Query to get gallery photos for all clinics (up to 5 photos per clinic)
    const photosResult = await pool.request().query(`
      SELECT 
        ClinicID,
        PhotoID,
        DisplayOrder
      FROM ClinicPhotos
      WHERE ClinicID IN (
        SELECT DISTINCT c.ClinicID
        FROM Clinics c
        JOIN Providers pr ON c.ClinicID = pr.ClinicID
        WHERE pr.ProviderName NOT LIKE '%Please Request Consult%'
      )
      ORDER BY ClinicID, DisplayOrder ASC
    `);

    // Build a map of clinic gallery photos
    const galleryPhotosMap = new Map();
    const baseURL = process.env.API_BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    photosResult.recordset.forEach(photo => {
      if (!galleryPhotosMap.has(photo.ClinicID)) {
        galleryPhotosMap.set(photo.ClinicID, []);
      }
      const photos = galleryPhotosMap.get(photo.ClinicID);
      // Limit to 5 photos per clinic for efficiency
      if (photos.length < 5) {
        photos.push(`${baseURL}/api/photos/proxy/${photo.PhotoID}?size=thumbnail`);
      }
    });

    // Transform the flat result set into a clinic-centric structure
    const clinicsMap = new Map();

    result.recordset.forEach(row => {
      const clinicId = row.ClinicID;

      // Initialize clinic object if it doesn't exist
      if (!clinicsMap.has(clinicId)) {
        clinicsMap.set(clinicId, {
          clinicId: row.ClinicID,
          clinicName: row.ClinicName,
          address: row.Address,
          city: row.City,
          state: row.State,
          zipCode: row.PostalCode || null,
          latitude: row.Latitude || null,
          longitude: row.Longitude || null,
          rating: row.GoogleRating || 0,
          reviewCount: row.GoogleReviewCount || 0,
          clinicCategory: normalizeCategory(row.ClinicCategory),
          photoURL: row.PhotoURL || null,
          galleryPhotos: galleryPhotosMap.get(clinicId) || null,
          procedures: []
        });
      }

      // Get the clinic object
      const clinic = clinicsMap.get(clinicId);

      // Deduplicate procedures by name AND category to avoid showing the same procedure multiple times
      // This handles cases where multiple providers at the same clinic offer the same procedure
      const procedureExists = clinic.procedures.some(
        proc => proc.procedureName === row.ProcedureName && proc.category === row.ProcedureCategory
      );

      if (!procedureExists) {
        clinic.procedures.push({
          procedureId: row.ProcedureID,
          procedureName: row.ProcedureName,
          price: row.AverageCost || 0,
          category: row.ProcedureCategory
        });
      }
    });

    // Convert map to array
    let clinics = Array.from(clinicsMap.values());

    // Apply location filtering if provided
    if (location) {
      clinics = await filterByLocation(clinics, location, radius);
    }

    // Apply procedure filtering if provided
    if (procedure) {
      clinics = filterByProcedure(clinics, procedure);
    }

    res.json({
      clinics,
      meta: {
        totalClinics: clinics.length,
        timestamp: new Date().toISOString(),
        filters: {
          location: location || null,
          procedure: procedure || null,
          radius: radius || null
        }
      }
    });
  } catch (error) {
    console.error('Error in /api/clinics/search-index:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Filter clinics by location (city, state, or zip)
 * @param {Array} clinics - Array of clinic objects
 * @param {string} location - Location string (city, state, or zip)
 * @param {string|number} radius - Optional radius in miles
 * @returns {Promise<Array>} Filtered clinics array
 */
async function filterByLocation(clinics, location, radius) {
  const locationInfo = parseLocationInput(location);
  
  if (!locationInfo.type || !locationInfo.value) {
    return [];
  }

  const searchRadius = radius ? parseFloat(radius) : null;

  switch (locationInfo.type) {
    case 'state':
      // State search: matches both abbreviations (FL) and full names (Florida)
      return clinics.filter(clinic => 
        stateMatches(clinic.state, locationInfo.value)
      );

    case 'zip':
      // ZIP code search
      if (searchRadius && searchRadius > 0) {
        // Use radius-based search
        return await filterByZipRadius(clinics, locationInfo.value, searchRadius);
      } else {
        // Exact zip match or same first 3 digits (nearby zip codes)
        const zipPrefix = locationInfo.value.substring(0, 3);
        return clinics.filter(clinic => {
          if (!clinic.zipCode) return false;
          const clinicZip = clinic.zipCode.toString().trim();
          return clinicZip === locationInfo.value || clinicZip.startsWith(zipPrefix);
        });
      }

    case 'city':
      // City search: exact city + metro area + nearby cities
      return await filterByCity(clinics, locationInfo.value, searchRadius);

    default:
      return [];
  }
}

/**
 * Filter clinics by city, including metro area and nearby cities
 * @param {Array} clinics - Array of clinic objects
 * @param {string} cityName - City name
 * @param {number|null} radius - Optional radius override
 * @returns {Promise<Array>} Filtered clinics array
 */
async function filterByCity(clinics, cityName, radius) {
  const lowerCityName = cityName.toLowerCase().trim();
  const matchedClinics = new Set();
  let primaryState = null; // Track the primary state for the city to prevent false positives

  // Step 1: Find exact city matches and determine primary state
  const exactMatches = [];
  clinics.forEach(clinic => {
    if (clinic.city && clinic.city.toLowerCase().trim() === lowerCityName) {
      exactMatches.push(clinic);
      matchedClinics.add(clinic.clinicId);
      // Use the first matched clinic's state as primary state
      if (!primaryState && clinic.state) {
        primaryState = clinic.state.toUpperCase();
      }
    }
  });

  // If we found exact matches, prefer clinics in the same state to prevent false positives
  // (e.g., "Palo Alto" in CA should not match "Palo Alto" in other states)
  if (primaryState && exactMatches.length > 0) {
    // Re-filter to prioritize same-state matches
    const sameStateMatches = exactMatches.filter(c => c.state && c.state.toUpperCase() === primaryState);
    if (sameStateMatches.length > 0) {
      // If we have same-state matches, use those as the primary state
      matchedClinics.clear();
      sameStateMatches.forEach(clinic => matchedClinics.add(clinic.clinicId));
    }
  }

  // Step 2: Check if city is in a defined metro area
  const metroArea = findMetroArea(cityName);
  let searchRadius = radius || (metroArea ? metroArea.radius : 25); // Default 25 miles
  let centerLat = null;
  let centerLng = null;

  if (metroArea) {
    // Use metro area center coordinates
    centerLat = metroArea.lat;
    centerLng = metroArea.lng;
    searchRadius = radius || metroArea.radius;

    // Include all cities in the metro area (metro areas are typically single-state)
    metroArea.cities.forEach(metroCity => {
      clinics.forEach(clinic => {
        if (clinic.city && clinic.city.toLowerCase().trim() === metroCity.toLowerCase()) {
          // If we have a primary state, prefer same-state matches
          if (!primaryState || !clinic.state || clinic.state.toUpperCase() === primaryState) {
            matchedClinics.add(clinic.clinicId);
          }
        }
      });
    });
  } else {
    // Try to geocode the city to get coordinates
    // Add state context if available to improve geocoding accuracy
    const geocodeQuery = primaryState ? `${cityName}, ${primaryState}` : cityName;
    const geocoded = await geocodeLocation(geocodeQuery);
    if (geocoded) {
      centerLat = geocoded.lat;
      centerLng = geocoded.lng;
    } else {
      // If geocoding fails, try to find a clinic in the city and use its coordinates
      // Prefer clinics in the primary state if we have one
      const cityClinic = clinics.find(c => 
        c.city && c.city.toLowerCase().trim() === lowerCityName && 
        c.latitude && c.longitude &&
        (!primaryState || !c.state || c.state.toUpperCase() === primaryState)
      ) || clinics.find(c => 
        c.city && c.city.toLowerCase().trim() === lowerCityName && c.latitude && c.longitude
      );
      if (cityClinic) {
        centerLat = cityClinic.latitude;
        centerLng = cityClinic.longitude;
        if (!primaryState && cityClinic.state) {
          primaryState = cityClinic.state.toUpperCase();
        }
      }
    }
  }

  // Step 3: Include clinics within radius using coordinates
  // Prefer clinics in the same state to prevent false positives
  if (centerLat && centerLng) {
    clinics.forEach(clinic => {
      if (clinic.latitude && clinic.longitude) {
        const distance = calculateDistance(
          centerLat,
          centerLng,
          clinic.latitude,
          clinic.longitude
        );
        
        if (distance !== null && distance <= searchRadius) {
          // If we have a primary state, prefer same-state matches
          // But still include nearby clinics even if different state (for border cities)
          // Only exclude if it's clearly a false positive (very far and different state)
          const isSameState = primaryState && clinic.state && clinic.state.toUpperCase() === primaryState;
          const isFarAway = distance > searchRadius * 0.8; // More than 80% of radius
          
          if (isSameState || !isFarAway || !primaryState) {
            matchedClinics.add(clinic.clinicId);
          }
        }
      }
    });
  }

  // Return filtered clinics
  return clinics.filter(clinic => matchedClinics.has(clinic.clinicId));
}

/**
 * Filter clinics by ZIP code with radius
 * @param {Array} clinics - Array of clinic objects
 * @param {string} zipCode - ZIP code
 * @param {number} radius - Radius in miles
 * @returns {Promise<Array>} Filtered clinics array
 */
async function filterByZipRadius(clinics, zipCode, radius) {
  // First, find a clinic with this zip code to get coordinates
  let zipClinic = clinics.find(c => 
    c.zipCode && c.zipCode.toString().trim() === zipCode && c.latitude && c.longitude
  );

  // If no clinic found with exact zip, try geocoding
  let centerLat = null;
  let centerLng = null;

  if (zipClinic) {
    centerLat = zipClinic.latitude;
    centerLng = zipClinic.longitude;
  } else {
    const geocoded = await geocodeLocation(zipCode);
    if (geocoded) {
      centerLat = geocoded.lat;
      centerLng = geocoded.lng;
    } else {
      // Fallback: return clinics with same first 3 digits
      const zipPrefix = zipCode.substring(0, 3);
      return clinics.filter(clinic => {
        if (!clinic.zipCode) return false;
        const clinicZip = clinic.zipCode.toString().trim();
        return clinicZip.startsWith(zipPrefix);
      });
    }
  }

  // Filter clinics within radius
  const matchedClinics = new Set();

  // Include exact zip matches first
  clinics.forEach(clinic => {
    if (clinic.zipCode && clinic.zipCode.toString().trim() === zipCode) {
      matchedClinics.add(clinic.clinicId);
    }
  });

  // Include clinics within radius
  if (centerLat && centerLng) {
    clinics.forEach(clinic => {
      if (clinic.latitude && clinic.longitude) {
        const distance = calculateDistance(
          centerLat,
          centerLng,
          clinic.latitude,
          clinic.longitude
        );
        
        if (distance !== null && distance <= radius) {
          matchedClinics.add(clinic.clinicId);
        }
      }
    });
  }

  return clinics.filter(clinic => matchedClinics.has(clinic.clinicId));
}

/**
 * Filter clinics by procedure name
 * @param {Array} clinics - Array of clinic objects
 * @param {string} procedureName - Procedure name to search for (case-insensitive, partial match)
 * @returns {Array} Filtered clinics array
 */
function filterByProcedure(clinics, procedureName) {
  const lowerProcedure = procedureName.toLowerCase().trim();
  
  // Common procedure abbreviations mapping
  const procedureAbbreviations = {
    'bbl': 'brazilian butt lift',
    'tummy tuck': 'abdominoplasty',
    'nose job': 'rhinoplasty',
    'boob job': 'breast augmentation',
    'botox': 'botulinum toxin',
    'filler': 'dermal filler'
  };

  // Check if search term is an abbreviation
  const expandedTerm = procedureAbbreviations[lowerProcedure] || null;

  return clinics.filter(clinic => {
    // Check if clinic has any procedure matching the search term
    return clinic.procedures.some(proc => {
      const procName = proc.procedureName.toLowerCase();
      // Direct match
      if (procName.includes(lowerProcedure)) {
        return true;
      }
      // Abbreviation match (e.g., "BBL" matches "Brazilian Butt Lift")
      if (expandedTerm && procName.includes(expandedTerm)) {
        return true;
      }
      // Reverse: if search term is full name, check if procedure name contains abbreviation
      // (e.g., "Brazilian Butt Lift" matches "BBL")
      for (const [abbr, fullName] of Object.entries(procedureAbbreviations)) {
        if (lowerProcedure.includes(fullName) && procName.includes(abbr)) {
          return true;
        }
      }
      return false;
    });
  });
}

/**
 * Simple Clinic Search Endpoint
 * GET /api/clinics/search?q={query}
 * 
 * Used by:
 * - List Your Clinic wizard → "Edit Existing" flow
 * - Quick clinic lookup by name/address
 * 
 * Returns a simplified list of clinics matching the search query.
 */
app.get('/api/clinics/search', async (req, res) => {
  let pool;
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ results: [] });
    }
    
    const searchTerm = q.trim();
    
    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }
    
    const request = pool.request();
    request.input('searchTerm', sql.NVarChar, `%${searchTerm}%`);
    
    // Search clinics by name, address, city, or state
    const result = await request.query(`
      SELECT TOP 20
        c.ClinicID as id,
        c.ClinicName as clinicName,
        c.Address as address,
        COALESCE(g.City, l.City) as city,
        COALESCE(g.State, l.State) as state,
        COALESCE(g.Category, 'Medical Spa') as category,
        c.GoogleRating as rating,
        c.GoogleReviewCount as reviewCount
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      LEFT JOIN Locations l ON c.LocationID = l.LocationID
      WHERE 
        c.ClinicName LIKE @searchTerm
        OR c.Address LIKE @searchTerm
        OR g.City LIKE @searchTerm
        OR l.City LIKE @searchTerm
        OR g.State LIKE @searchTerm
        OR l.State LIKE @searchTerm
      ORDER BY 
        CASE 
          WHEN c.ClinicName LIKE @searchTerm THEN 0
          ELSE 1
        END,
        c.GoogleRating DESC,
        c.ClinicName
    `);
    
    res.json({
      results: result.recordset
    });
  } catch (error) {
    console.error('Error in /api/clinics/search:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get top-rated clinics near a location with one review each
// Optimized for homepage "Book with Local Doctors" section
// IMPORTANT: This must be defined BEFORE /api/clinics/:clinicId to avoid route collision
app.get('/api/clinics/nearby-top-rated', async (req, res) => {
  let pool;
  try {
    const { lat, lng, limit = 3 } = req.query;

    // Validate required parameters
    if (!lat || !lng) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        message: 'Both lat and lng are required'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ 
        error: 'Invalid coordinates',
        message: 'lat and lng must be valid numbers'
      });
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ 
        error: 'Invalid coordinates',
        message: 'Coordinates out of valid range'
      });
    }

    const clinicLimit = Math.min(Math.max(parseInt(limit) || 3, 1), 20); // Max 20 clinics

    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }

    const request = pool.request();
    request.input('latitude', sql.Float, latitude);
    request.input('longitude', sql.Float, longitude);
    request.input('limit', sql.Int, clinicLimit);

    // Query to get top-rated clinics with distance calculation
    // Uses Haversine formula for distance calculation
    // Excludes clinics without photos from any source (temporary filter until photo data is complete)
    const result = await request.query(`
      SELECT TOP (@limit)
        c.ClinicID,
        c.ClinicName,
        c.Address,
        c.Latitude,
        c.Longitude,
        c.GoogleRating,
        c.GoogleReviewCount,
        c.GoogleReviewsJSON,
        c.Phone,
        c.Website,
        COALESCE(g.Photo, cp.PhotoURL) as PhotoURL,
        g.Category as ClinicCategory,
        g.Description,
        
        -- Calculate distance in miles using Haversine formula
        (
          3959 * ACOS(
            CASE
              WHEN COS(RADIANS(@latitude)) * COS(RADIANS(c.Latitude)) * 
                   COS(RADIANS(c.Longitude) - RADIANS(@longitude)) + 
                   SIN(RADIANS(@latitude)) * SIN(RADIANS(c.Latitude)) > 1
              THEN 1
              WHEN COS(RADIANS(@latitude)) * COS(RADIANS(c.Latitude)) * 
                   COS(RADIANS(c.Longitude) - RADIANS(@longitude)) + 
                   SIN(RADIANS(@latitude)) * SIN(RADIANS(c.Latitude)) < -1
              THEN -1
              ELSE COS(RADIANS(@latitude)) * COS(RADIANS(c.Latitude)) * 
                   COS(RADIANS(c.Longitude) - RADIANS(@longitude)) + 
                   SIN(RADIANS(@latitude)) * SIN(RADIANS(c.Latitude))
            END
          )
        ) AS DistanceMiles
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      LEFT JOIN (
        SELECT ClinicID, PhotoURL,
          ROW_NUMBER() OVER (PARTITION BY ClinicID ORDER BY IsPrimary DESC, DisplayOrder ASC) as RowNum
        FROM ClinicPhotos
      ) cp ON c.ClinicID = cp.ClinicID AND cp.RowNum = 1
      WHERE 
        c.GoogleRating >= 4.0
        AND c.Latitude IS NOT NULL
        AND c.Longitude IS NOT NULL
        AND (g.Photo IS NOT NULL OR cp.PhotoURL IS NOT NULL)
      ORDER BY 
        c.GoogleRating DESC,
        DistanceMiles ASC
    `);

    // Process results to include one quality review per clinic
    const clinics = result.recordset.map(clinic => {
      let selectedReview = null;
      
      // Parse and select a quality review
      if (clinic.GoogleReviewsJSON) {
        try {
          const reviews = JSON.parse(clinic.GoogleReviewsJSON);
          
          // Filter for high-rated reviews (4-5 stars) with substantial text
          const qualityReviews = reviews.filter(review => 
            review.rating >= 4 && 
            review.text && 
            review.text.trim().length >= 50 // At least 50 characters
          );
          
          if (qualityReviews.length > 0) {
            // Sort by text length (prefer more detailed reviews) and pick randomly from top ones
            qualityReviews.sort((a, b) => b.text.length - a.text.length);
            
            // Pick one from the top 3 most detailed reviews (random if multiple available)
            const topReviews = qualityReviews.slice(0, Math.min(3, qualityReviews.length));
            selectedReview = topReviews[Math.floor(Math.random() * topReviews.length)];
          } else {
            // Fallback: pick any 4-5 star review even if short
            const highRatedReviews = reviews.filter(review => review.rating >= 4);
            if (highRatedReviews.length > 0) {
              selectedReview = highRatedReviews[Math.floor(Math.random() * highRatedReviews.length)];
            }
          }
        } catch (parseError) {
          console.error(`Error parsing reviews for clinic ${clinic.ClinicID}:`, parseError);
        }
      }

      // Calculate distance in km as well
      const distanceKm = clinic.DistanceMiles * 1.60934;

      return {
        clinicId: clinic.ClinicID,
        clinicName: clinic.ClinicName,
        address: clinic.Address,
        phone: clinic.Phone,
        website: clinic.Website,
        rating: clinic.GoogleRating,
        reviewCount: clinic.GoogleReviewCount,
        category: normalizeCategory(clinic.ClinicCategory),
        description: clinic.Description,
        photoURL: clinic.PhotoURL,
        location: {
          latitude: clinic.Latitude,
          longitude: clinic.Longitude
        },
        distance: {
          miles: Math.round(clinic.DistanceMiles * 10) / 10, // Round to 1 decimal
          km: Math.round(distanceKm * 10) / 10
        },
        review: selectedReview ? {
          author: selectedReview.author_name || selectedReview.author,
          rating: selectedReview.rating,
          text: selectedReview.text,
          time: selectedReview.time || selectedReview.relative_time_description
        } : null
      };
    });

    res.json({
      success: true,
      count: clinics.length,
      query: {
        latitude,
        longitude,
        limit: clinicLimit
      },
      clinics
    });

  } catch (error) {
    console.error('Error in /api/clinics/nearby-top-rated:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get specific clinic details with cached Google Places ratings and rich metadata
// Note: This endpoint only reads from the database cache and never calls Google Places API
// The scheduled job (runs daily at 2 AM) keeps the rating data fresh
app.get('/api/clinics/:clinicId', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    pool = await db.getConnection();

    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);

    // Query clinic with cached Google Places data + rich metadata from GooglePlacesData table
    const result = await request.query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        c.Address,
        c.Phone,
        c.Website,
        c.Latitude,
        c.Longitude,
        c.LocationID,
        c.PlaceID,
        c.GoogleRating,
        c.GoogleReviewCount,
        c.GoogleReviewsJSON,
        c.LastRatingUpdate,
        
        -- Google Places Data fields (LEFT JOIN handles clinics without this data)
        g.Photo,
        g.Logo,
        g.StreetView,
        g.Description,
        g.WorkingHours,
        g.AboutJSON,
        g.Verified,
        g.Facebook,
        g.Instagram,
        g.LinkedIn,
        g.Twitter,
        g.YouTube,
        g.GoogleProfileLink,
        g.ReviewsLink,
        g.BookingAppointmentLink,
        g.MenuLink,
        g.BusinessStatus,
        g.Category,
        g.Subtypes,
        g.BusinessName,
        g.Email
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      WHERE c.ClinicID = @clinicId;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    const clinic = result.recordset[0];
    
    // Parse stored reviews if available
    let reviews = [];
    if (clinic.GoogleReviewsJSON) {
      try {
        reviews = JSON.parse(clinic.GoogleReviewsJSON);
      } catch (parseError) {
        console.error('Error parsing reviews JSON:', parseError);
      }
    }

    // Return complete clinic info with all Google Places data
    // Note: WorkingHours and AboutJSON are kept as JSON strings - frontend will parse them
    res.json({
      // Core clinic data
      ClinicID: clinic.ClinicID,
      ClinicName: clinic.ClinicName,
      Address: clinic.Address,
      Phone: clinic.Phone,
      Website: clinic.Website,
      Latitude: clinic.Latitude,
      Longitude: clinic.Longitude,
      LocationID: clinic.LocationID,
      PlaceID: clinic.PlaceID,
      
      // Google ratings (from Clinics table)
      GoogleRating: clinic.GoogleRating || 0,
      GoogleReviewCount: clinic.GoogleReviewCount || 0,
      
      // Legacy fields for backward compatibility
      rating: clinic.GoogleRating || 0,
      reviewCount: clinic.GoogleReviewCount || 0,
      reviews: reviews,
      GoogleReviewsJSON: clinic.GoogleReviewsJSON, // Raw JSON string if needed
      lastRatingUpdate: clinic.LastRatingUpdate,
      
      // Rich Google Places data (may be null if not available)
      Photo: clinic.Photo,
      Logo: clinic.Logo,
      StreetView: clinic.StreetView,
      Description: clinic.Description,
      WorkingHours: clinic.WorkingHours, // JSON string - parse on frontend
      AboutJSON: clinic.AboutJSON, // JSON string - parse on frontend
      Verified: clinic.Verified,
      
      // Social media links
      Facebook: clinic.Facebook,
      Instagram: clinic.Instagram,
      LinkedIn: clinic.LinkedIn,
      Twitter: clinic.Twitter,
      YouTube: clinic.YouTube,
      
      // Google links
      GoogleProfileLink: clinic.GoogleProfileLink,
      ReviewsLink: clinic.ReviewsLink,
      BookingAppointmentLink: clinic.BookingAppointmentLink,
      MenuLink: clinic.MenuLink,
      
      // Business info
      BusinessStatus: clinic.BusinessStatus,
      Category: normalizeCategory(clinic.Category),
      Subtypes: clinic.Subtypes,
      BusinessName: clinic.BusinessName,
      Email: clinic.Email,
      
      // Deprecated field (kept for backward compatibility)
      isOpen: null // Opening hours would require real-time API call, kept null for performance
    });
  } catch (error) {
    console.error('Error in /api/clinics/:clinicId:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get photos for a specific clinic
app.get('/api/clinics/:clinicId/photos', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    const { limit, primary } = req.query;
    
    pool = await db.getConnection();
    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);
    
    let query = `
      SELECT ${limit && !isNaN(parseInt(limit)) ? 'TOP ' + parseInt(limit) : ''}
        PhotoID,
        PhotoReference,
        PhotoURL,
        Width,
        Height,
        AttributionText,
        IsPrimary,
        DisplayOrder,
        LastUpdated
      FROM ClinicPhotos
      WHERE ClinicID = @clinicId
    `;
    
    // Filter for primary photo only if requested
    if (primary === 'true' || primary === '1') {
      query += ' AND IsPrimary = 1';
    }
    
    query += ' ORDER BY DisplayOrder ASC';
    
    const result = await request.query(query);
    
    // Transform data to include optimized URLs for different sizes
    // Use backend proxy URLs instead of direct Google Places API URLs
    // Construct base URL from the request to automatically work in any environment
    const baseURL = process.env.API_BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    const photos = result.recordset.map(photo => {
      // Use backend proxy endpoint with size parameter
      const photoId = photo.PhotoID;
      
      return {
        photoId: photo.PhotoID,
        url: `${baseURL}/api/photos/proxy/${photoId}?size=large`, // Full size (1600px)
        urls: {
          thumbnail: `${baseURL}/api/photos/proxy/${photoId}?size=thumbnail`,
          medium: `${baseURL}/api/photos/proxy/${photoId}?size=medium`,
          large: `${baseURL}/api/photos/proxy/${photoId}?size=large`
        },
        width: photo.Width,
        height: photo.Height,
        attribution: photo.AttributionText,
        isPrimary: photo.IsPrimary,
        displayOrder: photo.DisplayOrder,
        lastUpdated: photo.LastUpdated
      };
    });
    
    res.json({
      clinicId: parseInt(clinicId),
      count: photos.length,
      photos: photos
    });
    
  } catch (error) {
    console.error('Error in /api/clinics/:clinicId/photos:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get providers/doctors for a specific clinic
app.get('/api/clinics/:clinicId/providers', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    pool = await db.getConnection();

    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);

    // Query providers with photo data availability
    const result = await request.query(`
      SELECT DISTINCT
        p.ProviderID,
        p.ProviderName,
        CASE WHEN p.PhotoData IS NOT NULL THEN 1 ELSE 0 END as HasPhotoData
      FROM Providers p
      WHERE p.ClinicID = @clinicId;
    `);

    // Check if this clinic only has "Please Request Consult" providers
    const hasRealProviders = result.recordset.some(p => 
      !p.ProviderName.includes('Please Request Consult')
    );
    
    // Map providers with photo URLs pointing to database-served endpoint
    // Construct base URL from the request to automatically work in any environment
    const apiBaseUrl = process.env.API_BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    const providers = result.recordset
      .filter(p => !p.ProviderName.includes('Please Request Consult')) // Filter out placeholder providers
      .map(provider => ({
        ProviderID: provider.ProviderID,
        ProviderName: provider.ProviderName,
        PhotoURL: provider.HasPhotoData 
          ? `${apiBaseUrl}/api/provider-photos/${provider.ProviderID}`
          : null, // Return null if no photo
        hasPhoto: !!provider.HasPhotoData // Boolean flag for frontend convenience
      }));
    
    // Return response with flag indicating if clinic requires consult request
    res.json({
      providers,
      requiresConsultRequest: !hasRealProviders || providers.length === 0,
      message: !hasRealProviders || providers.length === 0 
        ? 'Please request a consult for more info'
        : null
    });
  } catch (error) {
    console.error('Error in /api/clinics/:clinicId/providers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/clinics/:clinicId/procedures', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    pool = await db.getConnection();

    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);

    const result = await request.query(`
      SELECT 
        ProcedureID,
        ProcedureName,
        AverageCost,
        Category,
        CategoryID
      FROM (
        SELECT 
          p.ProcedureID,
          p.ProcedureName,
          p.AverageCost,
          c.Category,
          c.CategoryID,
          ROW_NUMBER() OVER (PARTITION BY p.ProcedureName, c.Category ORDER BY p.ProcedureID) as RowNum
        FROM Procedures p
        JOIN Categories c ON p.CategoryID = c.CategoryID
        JOIN Providers pr ON p.ProviderID = pr.ProviderID
        WHERE pr.ClinicID = @clinicId
      ) AS RankedProcedures
      WHERE RowNum = 1
      ORDER BY Category, ProcedureName;
    `);

    // Group procedures by category
    const groupedProcedures = result.recordset.reduce((acc, proc) => {
      if (!acc[proc.Category]) {
        acc[proc.Category] = {
          categoryId: proc.CategoryID,
          procedures: []
        };
      }
      acc[proc.Category].procedures.push({
        id: proc.ProcedureID,
        name: proc.ProcedureName,
        price: proc.AverageCost
      });
      return acc;
    }, {});

    res.json(groupedProcedures);
  } catch (error) {
    console.error('Error in /api/clinics/:clinicId/procedures:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to manually refresh ratings for one or all clinics
// TODO: add auth to this (once we have auth)
app.post('/api/admin/refresh-ratings', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.body;
    pool = await db.getConnection();

    let clinicsToUpdate = [];

    if (clinicId) {
      // Refresh specific clinic
      const request = pool.request();
      request.input('clinicId', sql.Int, clinicId);
      
      const result = await request.query(`
        SELECT ClinicID, ClinicName, PlaceID
        FROM Clinics
        WHERE ClinicID = @clinicId AND PlaceID IS NOT NULL;
      `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ 
          error: 'Clinic not found or missing PlaceID' 
        });
      }

      clinicsToUpdate = result.recordset;
    } else {
      // Refresh all clinics with PlaceIDs
      const result = await pool.request().query(`
        SELECT ClinicID, ClinicName, PlaceID
        FROM Clinics
        WHERE PlaceID IS NOT NULL;
      `);

      clinicsToUpdate = result.recordset;
    }

    if (clinicsToUpdate.length === 0) {
      return res.json({
        message: 'No clinics with PlaceIDs found to update',
        updated: 0,
        failed: 0
      });
    }

    // Extract place IDs
    const placeIds = clinicsToUpdate.map(c => c.PlaceID);

    // Batch fetch with rate limiting (5 concurrent, 200ms delay between batches)
    const results = await batchFetchPlaceDetails(placeIds, 5, 200);

    // Update database with results
    const updatePromises = [];
    let successCount = 0;
    let failCount = 0;
    const updateDetails = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const clinic = clinicsToUpdate[i];

      if (result.data && !result.error) {
        const reviewsJSON = JSON.stringify(result.data.reviews);
        
        const updateRequest = pool.request();
        updateRequest.input('clinicId', sql.Int, clinic.ClinicID);
        updateRequest.input('rating', sql.Decimal(2, 1), result.data.rating);
        updateRequest.input('reviewCount', sql.Int, result.data.reviewCount);
        updateRequest.input('reviewsJSON', sql.NVarChar(sql.MAX), reviewsJSON);
        updateRequest.input('lastUpdate', sql.DateTime, new Date());

        updatePromises.push(
          updateRequest.query(`
            UPDATE Clinics 
            SET GoogleRating = @rating,
                GoogleReviewCount = @reviewCount,
                GoogleReviewsJSON = @reviewsJSON,
                LastRatingUpdate = @lastUpdate
            WHERE ClinicID = @clinicId;
          `).then(() => {
            successCount++;
            updateDetails.push({
              clinicId: clinic.ClinicID,
              clinicName: clinic.ClinicName,
              status: 'success',
              rating: result.data.rating,
              reviewCount: result.data.reviewCount
            });
          }).catch(err => {
            failCount++;
            console.error(`Failed to update clinic ${clinic.ClinicID}:`, err);
            updateDetails.push({
              clinicId: clinic.ClinicID,
              clinicName: clinic.ClinicName,
              status: 'database_error',
              error: err.message
            });
          })
        );
      } else {
        failCount++;
        updateDetails.push({
          clinicId: clinic.ClinicID,
          clinicName: clinic.ClinicName,
          status: 'api_error',
          error: result.error
        });
        console.error(`Failed to fetch data for clinic ${clinic.ClinicID}:`, result.error);
      }
    }

    // Wait for all updates to complete
    await Promise.all(updatePromises);

    res.json({
      message: 'Rating refresh completed',
      total: clinicsToUpdate.length,
      updated: successCount,
      failed: failCount,
      details: updateDetails
    });
  } catch (error) {
    console.error('Error in /api/admin/refresh-ratings:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Admin routes (mounted directly for cleaner frontend access)
const adminRoutes = require('./clinic-management/routes/adminRoutes');
app.use('/api/admin', adminRoutes);

// Clinic Management API routes
app.use('/api/clinic-management', clinicManagementRouter);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize scheduled jobs
try {
  initRatingRefreshJob();
} catch (error) {
  console.error('Failed to initialize scheduled jobs:', error);
  // Continue without scheduled jobs rather than crashing
}

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});