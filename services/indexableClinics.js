/**
 * Indexable clinics: every clinic that meets the complete-data bar, with the
 * fields glowra-FE needs to prerender static HTML for /clinic/:id (GLO-98).
 *
 * The complete-data bar (same definition as scripts/auditDataQuality.js):
 *   - at least 3 priced procedures (AverageCost > 0)
 *   - at least 1 row in ClinicPhotos
 *   - a Google rating (Clinics.GoogleRating IS NOT NULL)
 * Soft-deleted clinics (present in DeletedClinics) are excluded.
 *
 * DB only. Reads cached columns; never calls Google. The photo URL is built
 * by resolvePrimaryPhotoUrl, which only formats a URL on our own proxy and
 * fetches nothing. Two set-based queries, not one per clinic: the database is
 * Azure SQL Basic (5 DTU).
 */

const { mergeAddressForResponse } = require('../utils/addressUtils');
const { normalizeCategory } = require('../utils/categoryNormalizer');
const { resolvePrimaryPhotoUrl } = require('../utils/photoUrl');
const {
  proceduresTableHasPriceUnitColumn,
  innerProcedurePriceUnitSelectSql
} = require('../utils/procedurePriceUnitColumn');

const MIN_PRICED_PROCEDURES = 3;
const MIN_PHOTOS = 1;

// Clinics that have enough priced procedures. Shared by both queries.
const PRICED_CLINICS_SQL = `
  SELECT ClinicID
  FROM Procedures
  WHERE ClinicID IS NOT NULL AND AverageCost IS NOT NULL AND AverageCost > 0
  GROUP BY ClinicID
  HAVING COUNT(*) >= ${MIN_PRICED_PROCEDURES}`;

const CLINICS_SQL = `
  WITH photos AS (
    SELECT ClinicID, COUNT(*) AS n FROM ClinicPhotos GROUP BY ClinicID
  ),
  primaryPhoto AS (
    SELECT ClinicID, PhotoID, PhotoReference, PhotoURL,
      ROW_NUMBER() OVER (PARTITION BY ClinicID ORDER BY IsPrimary DESC, DisplayOrder ASC) AS RowNum
    FROM ClinicPhotos
  )
  SELECT
    c.ClinicID,
    c.ClinicName,
    c.Address,
    c.City,
    c.State,
    c.PostalCode,
    c.Phone,
    c.Website,
    c.Latitude,
    c.Longitude,
    c.GoogleRating,
    c.GoogleReviewCount,
    g.Street,
    g.City AS GpCity,
    g.State AS GpState,
    g.PostalCode AS GpPostalCode,
    g.Category,
    g.Description,
    g.Photo AS GooglePhoto,
    l.City AS LCity,
    l.State AS LState,
    cp.PhotoID AS PrimaryPhotoID,
    cp.PhotoReference AS PrimaryPhotoReference,
    cp.PhotoURL AS PrimaryPhotoURL
  FROM Clinics c
  JOIN (${PRICED_CLINICS_SQL}) priced ON priced.ClinicID = c.ClinicID
  JOIN photos ON photos.ClinicID = c.ClinicID AND photos.n >= ${MIN_PHOTOS}
  LEFT JOIN GooglePlacesData g ON g.ClinicID = c.ClinicID
  LEFT JOIN Locations l ON l.LocationID = c.LocationID
  LEFT JOIN primaryPhoto cp ON cp.ClinicID = c.ClinicID AND cp.RowNum = 1
  WHERE c.GoogleRating IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM DeletedClinics dc WHERE dc.OriginalClinicID = c.ClinicID
    )
  ORDER BY c.ClinicID`;

// Same de-duplication as GET /api/clinics/:clinicId/procedures (one row per
// name + category), restricted to clinics that can pass the bar.
function proceduresSql(priceUnitSelect) {
  return `
  SELECT ClinicID, ProcedureID, ProcedureName, AverageCost, PriceUnit, Category
  FROM (
    SELECT
      p.ClinicID,
      p.ProcedureID,
      p.ProcedureName,
      p.AverageCost,
      ${priceUnitSelect},
      cat.Category,
      ROW_NUMBER() OVER (
        PARTITION BY p.ClinicID, p.ProcedureName, cat.Category ORDER BY p.ProcedureID
      ) AS RowNum
    FROM Procedures p
    JOIN Categories cat ON cat.CategoryID = p.CategoryID
    WHERE p.ClinicID IN (${PRICED_CLINICS_SQL})
  ) ranked
  WHERE RowNum = 1
  ORDER BY ClinicID, Category, ProcedureName`;
}

function trimOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shape DB rows into the API response. Pure, so it is unit-tested without a DB.
 *
 * @param {object[]} clinicRows rows from CLINICS_SQL
 * @param {object[]} procedureRows rows from proceduresSql()
 * @param {{ baseURL: string }} options
 */
function buildIndexableClinics(clinicRows, procedureRows, { baseURL } = {}) {
  const proceduresByClinic = new Map();
  for (const p of procedureRows || []) {
    if (!proceduresByClinic.has(p.ClinicID)) proceduresByClinic.set(p.ClinicID, []);
    const priceUnit = trimOrNull(p.PriceUnit);
    proceduresByClinic.get(p.ClinicID).push({
      procedureId: p.ProcedureID,
      procedureName: trimOrNull(p.ProcedureName),
      category: trimOrNull(p.Category),
      price: toNumberOrNull(p.AverageCost),
      ...(priceUnit ? { priceUnit } : {})
    });
  }

  const seen = new Set();
  const clinics = [];
  for (const c of clinicRows || []) {
    // A clinic with two GooglePlacesData rows would appear twice; keep the first.
    if (seen.has(c.ClinicID)) continue;
    seen.add(c.ClinicID);

    const procedures = proceduresByClinic.get(c.ClinicID) || [];
    const pricedCount = procedures.filter(p => p.price !== null && p.price > 0).length;
    // The SQL already enforces the bar; this keeps the response honest if the
    // de-duplicated list drops below it (duplicate names counted twice in SQL).
    if (pricedCount < MIN_PRICED_PROCEDURES) continue;

    const { address, city, state, zipCode } = mergeAddressForResponse(
      { Address: c.Address, City: c.City, State: c.State, PostalCode: c.PostalCode },
      { Street: c.Street, City: c.GpCity, State: c.GpState, PostalCode: c.GpPostalCode },
      { City: c.LCity, State: c.LState }
    );

    clinics.push({
      clinicId: c.ClinicID,
      clinicName: trimOrNull(c.ClinicName),
      address,
      city,
      state,
      zipCode,
      phone: trimOrNull(c.Phone),
      website: trimOrNull(c.Website),
      latitude: toNumberOrNull(c.Latitude),
      longitude: toNumberOrNull(c.Longitude),
      rating: toNumberOrNull(c.GoogleRating),
      reviewCount: toNumberOrNull(c.GoogleReviewCount) || 0,
      category: normalizeCategory(c.Category),
      description: trimOrNull(c.Description),
      // A URL on our photo proxy (or a stored non-Google URL). Formatting it
      // calls nothing; whoever fetches it pays for a cache miss.
      photoUrl: resolvePrimaryPhotoUrl({
        baseURL,
        photoId: c.PrimaryPhotoID,
        photoReference: c.PrimaryPhotoReference,
        photoUrl: c.PrimaryPhotoURL,
        googlePhoto: c.GooglePhoto,
        size: 'medium'
      }),
      procedures
    });
  }
  return clinics;
}

async function fetchIndexableClinics(pool, { baseURL } = {}) {
  const hasPriceUnit = await proceduresTableHasPriceUnitColumn(pool);
  // Sequential, not parallel: two queries, one at a time, on a 5-DTU database.
  const clinicResult = await pool.request().query(CLINICS_SQL);
  const procedureResult = await pool
    .request()
    .query(proceduresSql(innerProcedurePriceUnitSelectSql(hasPriceUnit)));
  return buildIndexableClinics(clinicResult.recordset, procedureResult.recordset, { baseURL });
}

module.exports = {
  MIN_PRICED_PROCEDURES,
  MIN_PHOTOS,
  CLINICS_SQL,
  proceduresSql,
  buildIndexableClinics,
  fetchIndexableClinics
};
