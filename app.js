// app.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { sql, db } = require('./db');
const { batchFetchPlaceDetails } = require('./utils/googlePlaces');
const { initRatingRefreshJob } = require('./jobs/ratingRefresh');
const app = express();
const port = process.env.PORT || 3001;

// Load environment configuration
require('dotenv').config();

app.use(cors());
app.use(express.json());

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

// Serve provider photos as static files
// Photos accessible via: /api/provider-photos/[ClinicName]/[ProviderName].png
app.use('/api/provider-photos', express.static('photos/Provider Pictures', {
  maxAge: '7d', // Cache for 7 days for better performance
  etag: true,
  lastModified: true
}));

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

    // First, try to get the photo URL or reference from GooglePlacesData
    const result = await request.query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        g.Photo as PhotoURL
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
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

// Get specific clinic details
app.get('/api/procedures', async (req, res) => {
  let pool;
  try {
    const { searchQuery, location, minPrice, maxPrice, specialty, category, page = 1, limit = 100 } = req.query;
    
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
        s.Specialty,
        c.Category,
        pr.ProviderName,
        cl.ClinicID,
        cl.ClinicName,
        cl.Address,
        cl.Website
      FROM Procedures p
      JOIN Locations l ON p.LocationID = l.LocationID
      JOIN Specialties s ON p.SpecialtyID = s.SpecialtyID
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
            c.Category LIKE @${paramName} OR
            s.Specialty LIKE @${paramName}
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

    if (specialty) {
      conditions.push(`s.Specialty LIKE @specialty`);
      parameters.specialty = `%${specialty}%`;
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
      JOIN Specialties s ON p.SpecialtyID = s.SpecialtyID
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
        s.Specialty,
        c.Category,
        pr.ProviderName,
        cl.ClinicID,
        cl.ClinicName,
        cl.Address,
        cl.Website
      FROM Procedures p
      JOIN Locations l ON p.LocationID = l.LocationID
      JOIN Specialties s ON p.SpecialtyID = s.SpecialtyID
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
app.get('/api/clinics/search-index', async (req, res) => {
  let pool;
  try {
    pool = await db.getConnection();
    if (!pool) {
      throw new Error('Could not establish database connection');
    }

    // Query to get all clinics with their procedures
    // Excludes providers that are placeholder "Please Request Consult" entries
    const result = await pool.request().query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        c.Address,
        l.City,
        l.State,
        c.GoogleRating,
        c.GoogleReviewCount,
        COALESCE(g.Category, 'Medical Spa') as ClinicCategory,
        g.Photo as PhotoURL,
        p.ProcedureID,
        p.ProcedureName,
        p.AverageCost,
        cat.Category as ProcedureCategory
      FROM Clinics c
      LEFT JOIN Locations l ON c.LocationID = l.LocationID
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      JOIN Providers pr ON c.ClinicID = pr.ClinicID
      JOIN Procedures p ON pr.ProviderID = p.ProviderID
      JOIN Categories cat ON p.CategoryID = cat.CategoryID
      WHERE pr.ProviderName NOT LIKE '%Please Request Consult%'
      ORDER BY c.ClinicID, p.ProcedureName
    `);

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
          rating: row.GoogleRating || 0,
          reviewCount: row.GoogleReviewCount || 0,
          clinicCategory: row.ClinicCategory,
          photoURL: row.PhotoURL || null,
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
    const clinics = Array.from(clinicsMap.values());

    res.json({
      clinics,
      meta: {
        totalClinics: clinics.length,
        timestamp: new Date().toISOString()
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
        g.Photo as PhotoURL,
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
      WHERE 
        c.GoogleRating >= 4.0
        AND c.Latitude IS NOT NULL
        AND c.Longitude IS NOT NULL
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
        category: clinic.ClinicCategory || 'Medical Spa',
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
      Category: clinic.Category,
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
      SELECT 
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
    
    // Apply limit if specified
    if (limit && !isNaN(parseInt(limit))) {
      const limitNum = parseInt(limit);
      query = `SELECT TOP ${limitNum} * FROM (${query}) AS Photos`;
    }
    
    const result = await request.query(query);
    
    // Transform data to include optimized URLs for different sizes
    const photos = result.recordset.map(photo => {
      // Extract the base photo reference from the URL
      const photoRef = photo.PhotoReference;
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      const baseParams = `key=${apiKey}&photoreference=${photoRef}`;
      
      return {
        photoId: photo.PhotoID,
        url: photo.PhotoURL, // Full size (1600px)
        urls: {
          thumbnail: `https://maps.googleapis.com/maps/api/place/photo?${baseParams}&maxwidth=400`,
          medium: `https://maps.googleapis.com/maps/api/place/photo?${baseParams}&maxwidth=800`,
          large: photo.PhotoURL
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

    // Query providers with photo URLs
    const result = await request.query(`
      SELECT DISTINCT
        p.ProviderID,
        p.ProviderName,
        p.PhotoURL,
        s.Specialty
      FROM Providers p
      JOIN Procedures [procs] ON p.ProviderID = [procs].ProviderID
      JOIN Specialties s ON [procs].SpecialtyID = s.SpecialtyID
      WHERE p.ClinicID = @clinicId;
    `);

    // Check if this clinic only has "Please Request Consult" providers
    const hasRealProviders = result.recordset.some(p => 
      !p.ProviderName.includes('Please Request Consult')
    );
    
    // Map providers with photo URLs, no fallback for missing photos
    const providers = result.recordset
      .filter(p => !p.ProviderName.includes('Please Request Consult')) // Filter out placeholder providers
      .map(provider => ({
        ProviderID: provider.ProviderID,
        ProviderName: provider.ProviderName,
        Specialty: provider.Specialty,
        PhotoURL: provider.PhotoURL || null, // Return null if no photo
        hasPhoto: !!provider.PhotoURL // Boolean flag for frontend convenience
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