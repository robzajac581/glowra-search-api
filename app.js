// app.js
const express = require('express');
const cors = require('cors');
const { sql, db } = require('./db');
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Get specific clinic details
app.get('/api/procedures', async (req, res) => {
  let pool;
  try {
    const { location, minPrice, maxPrice, specialty, category, page = 1, limit = 10 } = req.query;
    
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

    // TODO: Add review data when Reviews table is implemented
    // TODO: Add operating hours when business hours are implemented
    
    const conditions = [];
    const parameters = {};

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

app.get('/api/procedures', async (req, res) => {
  let pool;
  try {
    const { location, minPrice, maxPrice, specialty, category, page = 1, limit = 10 } = req.query;
    
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

// Get specific clinic details
app.get('/api/clinics/:clinicId', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    pool = await db.getConnection();

    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);

    const result = await request.query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        c.Address,
        c.Website,
        c.LocationID
      FROM Clinics c
      WHERE c.ClinicID = @clinicId;
    `);

    // TODO: Add review data when Reviews table is implemented
    // TODO: Add operating hours when business hours are implemented

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    const clinic = result.recordset[0];
    res.json({
      ...clinic,
      // Temporary hardcoded values until proper implementation
      isOpen: true,
      closeTime: '8pm',
      reviewCount: 0,
      rating: 0
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

// Get procedures for a specific clinic
app.get('/api/clinics/:clinicId/procedures', async (req, res) => {
  let pool;
  try {
    const { clinicId } = req.params;
    pool = await db.getConnection();

    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);

    const result = await request.query(`
      SELECT 
        p.ProcedureID,
        p.ProcedureName,
        p.AverageCost,
        c.Category,
        c.CategoryID
      FROM Procedures p
      JOIN Categories c ON p.CategoryID = c.CategoryID
      JOIN Providers pr ON p.ProviderID = pr.ProviderID
      WHERE pr.ClinicID = @clinicId
      ORDER BY c.Category, p.ProcedureName;
    `);

    // TODO: Implement city average price calculations when location-based pricing is added

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

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});