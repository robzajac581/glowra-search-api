const db = require('../db');

// TODO: edit this to work!
const clinicSearchService = {
  async searchClinics({ procedure, minCost, maxCost, location, page, limit }) {
    const offset = (page - 1) * limit;
    const values = [];
    let query = `
      SELECT c.*, p.name AS procedure_name, l.city, l.state
      FROM clinics c
      JOIN procedures p ON c.id = p.clinic_id
      JOIN locations l ON c.location_id = l.id
      WHERE 1=1
    `;

    if (procedure) {
      values.push(`%${procedure}%`);
      query += ` AND p.name ILIKE $${values.length}`;
    }

    if (minCost) {
      values.push(minCost);
      query += ` AND c.cost >= $${values.length}`;
    }

    if (maxCost) {
      values.push(maxCost);
      query += ` AND c.cost <= $${values.length}`;
    }

    if (location) {
      values.push(`%${location}%`);
      query += ` AND (l.city ILIKE $${values.length} OR l.state ILIKE $${values.length})`;
    }

    query += ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await db.query(query, values);
    return result.rows;
  },

  async getClinicById(id) {
    const query = `
      SELECT c.*, p.name AS procedure_name, l.city, l.state
      FROM clinics c
      JOIN procedures p ON c.id = p.clinic_id
      JOIN locations l ON c.location_id = l.id
      WHERE c.id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
};

module.exports = clinicSearchService;