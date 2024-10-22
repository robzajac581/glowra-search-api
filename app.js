// server.js
const express = require('express');
const cors = require('cors');
const { sql, poolPromise } = require('./db');
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/procedures', async (req, res) => {
  try {
    const { location, minPrice, maxPrice, specialty, category, page = 1, limit = 10 } = req.query;
    
    const pool = await poolPromise;
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
    const values = [];

    if (location) {
      conditions.push(`(l.City LIKE @location OR l.State LIKE @location)`);
      values.push({ name: 'location', value: `%${location}%` });
    }

    if (minPrice) {
      conditions.push(`p.AverageCost >= @minPrice`);
      values.push({ name: 'minPrice', value: Number(minPrice) });
    }

    if (maxPrice) {
      conditions.push(`p.AverageCost <= @maxPrice`);
      values.push({ name: 'maxPrice', value: Number(maxPrice) });
    }

    if (specialty) {
      conditions.push(`s.Specialty LIKE @specialty`);
      values.push({ name: 'specialty', value: `%${specialty}%` });
    }

    if (category) {
      conditions.push(`c.Category LIKE @category`);
      values.push({ name: 'category', value: `%${category}%` });
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    // Add total count query for pagination
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
    
    const offset = (Number(page) - 1) * Number(limit);
    values.push({ name: 'offset', value: offset });
    values.push({ name: 'limit', value: Number(limit) });

    const request = pool.request();
    values.forEach(param => request.input(param.name, param.value));
    
    // Log the constructed SQL query
    console.log('Constructed SQL Query:', query);
    console.log('Query Parameters:', values);

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});