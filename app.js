// app.js
const express = require('express');
const cors = require('cors');
const { sql, db } = require('./db');
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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