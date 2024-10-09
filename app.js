const express = require('express');
const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

const clinicSearchService = require('./services/clinicSearchService');

// app.get('/api/clinics', async (req, res) => {
//   try {
//     const { procedure, minCost, maxCost, location, page = 1, limit = 10 } = req.query;
    
//     // Input validation (you might want to use a validation library like Joi)
//     if (minCost && isNaN(minCost)) {
//       return res.status(400).json({ error: 'Invalid minCost' });
//     }
//     if (maxCost && isNaN(maxCost)) {
//       return res.status(400).json({ error: 'Invalid maxCost' });
//     }

//     const clinics = await clinicSearchService.searchClinics({
//       procedure,
//       minCost: minCost ? Number(minCost) : undefined,
//       maxCost: maxCost ? Number(maxCost) : undefined,
//       location,
//       page: Number(page),
//       limit: Number(limit)
//     });

//     res.json({
//       data: clinics,
//       page: Number(page),
//       limit: Number(limit)
//     });
//   } catch (error) {
//     console.error('Error in /api/clinics:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// app.get('/api/clinics/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const clinic = await clinicSearchService.getClinicById(id);
    
//     if (!clinic) {
//       return res.status(404).json({ error: 'Clinic not found' });
//     }

//     res.json(clinic);
//   } catch (error) {
//     console.error('Error in /api/clinics/:id:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

app.get('/api/clinics', (req, res) => {
  try {
    const { procedure, minCost, maxCost, location, page = 1, limit = 10 } = req.query;
    
    // Input validation
    if (minCost && isNaN(minCost)) {
      return res.status(400).json({ error: 'Invalid minCost' });
    }
    if (maxCost && isNaN(maxCost)) {
      return res.status(400).json({ error: 'Invalid maxCost' });
    }

    // Build the SQL query
    let query = `
      SELECT c.*, p.name AS procedure_name, l.city, l.state
      FROM clinics c
      JOIN procedures p ON c.id = p.clinic_id
      JOIN locations l ON c.location_id = l.id
      WHERE 1=1
    `;
    const conditions = [];
    const values = [];

    if (procedure) {
      conditions.push(`p.name ILIKE $${values.length + 1}`);
      values.push(`%${procedure}%`);
    }

    if (minCost) {
      conditions.push(`c.cost >= $${values.length + 1}`);
      values.push(Number(minCost));
    }

    if (maxCost) {
      conditions.push(`c.cost <= $${values.length + 1}`);
      values.push(Number(maxCost));
    }

    if (location) {
      conditions.push(`(l.city ILIKE $${values.length + 1} OR l.state ILIKE $${values.length + 1})`);
      values.push(`%${location}%`);
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    query += `
      ORDER BY c.id
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;
    values.push(Number(limit), (Number(page) - 1) * Number(limit));

    // For demonstration, we'll return the query and values
    res.json({
      message: "This is the SQL query that would be executed",
      query: query,
      values: values
    });
  } catch (error) {
    console.error('Error in /api/clinics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/clinics/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT c.*, p.name AS procedure_name, l.city, l.state
      FROM clinics c
      JOIN procedures p ON c.id = p.clinic_id
      JOIN locations l ON c.location_id = l.id
      WHERE c.id = $1
    `;

    res.json({
      message: "This is the SQL query that would be executed",
      query: query,
      values: [id]
    });
  } catch (error) {
    console.error('Error in /api/clinics/:id:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});