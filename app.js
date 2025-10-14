// app.js
const express = require('express');
const cors = require('cors');
const { sql, db } = require('./db');
const { batchFetchPlaceDetails } = require('./utils/googlePlaces');
const { initRatingRefreshJob } = require('./jobs/ratingRefresh');
const app = express();
const port = process.env.PORT || 3001;

// Load environment configuration
require('dotenv').config();

app.use(cors());
app.use(express.json());

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

app.get('/api/procedures', async (req, res) => {
  let pool;
  try {
    const { location, minPrice, maxPrice, specialty, category, page = 1, limit = 100 } = req.query;
    
    // Get database connection
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

    if (location) {
      conditions.push(`(l.City LIKE @location OR l.State LIKE @location)`);
      parameters.location = `%${location}%`;
    }

    if (minPrice) {
      conditions.push(`p.AverageCost >= @minPrice`);
      parameters.minPrice = Number(minPrice);
    }

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

    // Add pagination parameters
    const offset = (Number(page) - 1) * Number(limit);
    parameters.offset = offset;
    parameters.limit = Number(limit);

    // Count query for pagination
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

    query += `
      ORDER BY p.ProcedureID
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    // Create request and add parameters
    const request = pool.request();
    Object.entries(parameters).forEach(([key, value]) => {
      request.input(key, value);
    });

    // Log queries for debugging
    console.log('Query:', query);
    console.log('Parameters:', parameters);

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

// Get specific clinic details with cached Google Places ratings
// Note: This endpoint only reads from the database cache and never calls Google Places API
// The scheduled job (runs daily at 2 AM) keeps the rating data fresh
app.get('/api/clinics/:clinicId', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    pool = await db.getConnection();

    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);

    // Query clinic with cached Google Places data
    const result = await request.query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        c.Address,
        c.Website,
        c.LocationID,
        c.PlaceID,
        c.GoogleRating,
        c.GoogleReviewCount,
        c.GoogleReviewsJSON,
        c.LastRatingUpdate
      FROM Clinics c
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

    // Return clinic info with cached rating data from database
    res.json({
      ClinicID: clinic.ClinicID,
      ClinicName: clinic.ClinicName,
      Address: clinic.Address,
      Website: clinic.Website,
      LocationID: clinic.LocationID,
      PlaceID: clinic.PlaceID,
      rating: clinic.GoogleRating || 0,
      reviewCount: clinic.GoogleReviewCount || 0,
      reviews: reviews,
      isOpen: null, // Opening hours would require real-time API call, kept null for performance
      lastRatingUpdate: clinic.LastRatingUpdate
    });
  } catch (error) {
    console.error('Error in /api/clinics/:clinicId:', error);
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

    // Use a non-reserved word as alias with brackets for safety
    const result = await request.query(`
      SELECT DISTINCT
        p.ProviderID,
        p.ProviderName,
        s.Specialty
      FROM Providers p
      JOIN Procedures [procs] ON p.ProviderID = [procs].ProviderID
      JOIN Specialties s ON [procs].SpecialtyID = s.SpecialtyID
      WHERE p.ClinicID = @clinicId;
    `);

    // TODO: Add provider images when image storage is implemented
    const providers = result.recordset.map(provider => ({
      ...provider,
      img: `/img/doctor/placeholder.png` // Temporary placeholder
    }));

    res.json(providers);
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

    console.log(`Starting rating refresh for ${clinicsToUpdate.length} clinic(s)`);

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

      console.log(`\n--- Processing clinic ${clinic.ClinicID} (${clinic.ClinicName}) ---`);
      console.log('API Result:', JSON.stringify(result, null, 2));

      if (result.data && !result.error) {
        console.log(`✓ Has valid data - Rating: ${result.data.rating}, Reviews: ${result.data.reviewCount}`);
        
        const reviewsJSON = JSON.stringify(result.data.reviews);
        
        const updateRequest = pool.request();
        updateRequest.input('clinicId', sql.Int, clinic.ClinicID);
        updateRequest.input('rating', sql.Decimal(2, 1), result.data.rating);
        updateRequest.input('reviewCount', sql.Int, result.data.reviewCount);
        updateRequest.input('reviewsJSON', sql.NVarChar(sql.MAX), reviewsJSON);
        updateRequest.input('lastUpdate', sql.DateTime, new Date());

        console.log('About to update database with:', {
          clinicId: clinic.ClinicID,
          rating: result.data.rating,
          reviewCount: result.data.reviewCount,
          reviewsLength: result.data.reviews.length
        });

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

    console.log(`Rating refresh completed: ${successCount} succeeded, ${failCount} failed`);

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
  console.log('Scheduled jobs initialized');
} catch (error) {
  console.error('Failed to initialize scheduled jobs:', error);
  // Continue without scheduled jobs rather than crashing
}

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});