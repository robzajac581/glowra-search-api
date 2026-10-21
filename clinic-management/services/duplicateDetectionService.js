const { db, sql } = require('../../db');
const fuzzball = require('fuzzball');
const { toCanonicalState } = require('../../utils/stateNormalizer');
const {
  CLASSIFICATIONS: ADDRESS_CLASSIFICATIONS,
  classifyAddressPair,
  findAddressCandidatePairs
} = require('../../utils/addressDuplicateUtils');

// Same-address candidates are review hints only. likely_duplicate maps to
// 'medium' (never 'high': only an exact PlaceID match is high, and only
// PlaceID ever drives automatic linking). review_only maps to 'low'.
const ADDRESS_CONFIDENCE = {
  [ADDRESS_CLASSIFICATIONS.LIKELY_DUPLICATE]: { confidence: 'medium', score: 0.85 },
  [ADDRESS_CLASSIFICATIONS.REVIEW_ONLY]: { confidence: 'low', score: 0.6 }
};

/** Canonical two-letter code when resolvable, else the tidied raw value. */
function canonicalOrRaw(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return toCanonicalState(trimmed) || trimmed.toLowerCase();
}

/**
 * Multi-strategy duplicate detection service
 * Checks for duplicates using PlaceID, fuzzy name+address matching, phone,
 * website, fuzzy name+city/state, and same normalized street address (GLO-86).
 */
class DuplicateDetectionService {
  constructor() {
    // Short-lived cache of the address comparison rows so a bulk import of N
    // clinics does not run N full-table loads against the 5-DTU database.
    this._addressRowsCache = null;
  }

  /**
   * Check for duplicates of a clinic
   * @param {Object} clinicData - Clinic data to check
   * @returns {Promise<Object>} Duplicate detection results
   */
  async checkDuplicates(clinicData) {
    const matches = [];
    
    // Strategy 1: Exact PlaceID match (highest confidence)
    if (clinicData.placeID) {
      const placeIdMatch = await this.checkPlaceIDMatch(clinicData.placeID);
      if (placeIdMatch) {
        matches.push({
          ...placeIdMatch,
          confidence: 'high',
          matchReason: 'PlaceID match',
          similarityScore: 1.0
        });
      }
    }

    // Strategy 2: Fuzzy name + address match
    if (clinicData.clinicName && clinicData.address) {
      const nameAddressMatches = await this.checkFuzzyNameAddressMatch(
        clinicData.clinicName,
        clinicData.address
      );
      matches.push(...nameAddressMatches);
    }

    // Strategy 3: Phone number match
    if (clinicData.phone) {
      const phoneMatch = await this.checkPhoneMatch(clinicData.phone);
      if (phoneMatch && !matches.some(m => m.clinicId === phoneMatch.clinicId)) {
        matches.push({
          ...phoneMatch,
          confidence: 'medium',
          matchReason: 'Phone number match',
          similarityScore: 0.9
        });
      }
    }

    // Strategy 4: Website domain match
    if (clinicData.website) {
      const websiteMatch = await this.checkWebsiteMatch(clinicData.website);
      if (websiteMatch && !matches.some(m => m.clinicId === websiteMatch.clinicId)) {
        matches.push({
          ...websiteMatch,
          confidence: 'low',
          matchReason: 'Website domain match',
          similarityScore: 0.7
        });
      }
    }

    // Strategy 5: Fuzzy name + city/state match (lower confidence)
    if (clinicData.clinicName && clinicData.city && clinicData.state) {
      const nameLocationMatches = await this.checkFuzzyNameLocationMatch(
        clinicData.clinicName,
        clinicData.city,
        clinicData.state
      );
      // Only add if not already matched
      nameLocationMatches.forEach(match => {
        if (!matches.some(m => m.clinicId === match.clinicId)) {
          matches.push(match);
        }
      });
    }

    // Strategy 6: Same normalized street address + ZIP (GLO-86). Catches the
    // historical paired half-rows whose names and PlaceIDs differ. Evidence is
    // attached to an existing match for the same clinic rather than adding a
    // second entry. Suite mismatches ('excluded') are not returned here.
    if (clinicData.address) {
      const addressMatches = await this.checkSameAddressMatch(clinicData);
      for (const match of addressMatches) {
        const existing = matches.find(m => m.clinicId === match.clinicId);
        if (existing) {
          existing.addressClassification = match.addressClassification;
          existing.addressEvidence = match.addressEvidence;
        } else {
          matches.push(match);
        }
      }
    }

    // Sort by confidence and similarity score
    matches.sort((a, b) => {
      const confidenceOrder = { high: 3, medium: 2, low: 1 };
      if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
      }
      return b.similarityScore - a.similarityScore;
    });

    return {
      hasDuplicates: matches.length > 0,
      confidence: matches.length > 0 ? matches[0].confidence : null,
      matches: matches.map(match => ({
        clinicId: match.clinicId,
        clinicName: match.clinicName,
        address: match.address,
        city: match.city,
        state: match.state,
        phone: match.phone,
        website: match.website,
        placeID: match.placeID,
        matchReason: match.matchReason,
        confidence: match.confidence,
        similarityScore: match.similarityScore,
        addressClassification: match.addressClassification,
        addressEvidence: match.addressEvidence,
        existingData: {
          clinicId: match.clinicId,
          clinicName: match.clinicName,
          address: match.address,
          city: match.city,
          state: match.state,
          phone: match.phone,
          website: match.website,
          placeID: match.placeID
        }
      })),
      newClinicData: clinicData
    };
  }

  /**
   * Check for exact PlaceID match
   */
  async checkPlaceIDMatch(placeID, options = {}) {
    try {
      const { excludeClinicId = null } = options;
      const pool = await db.getConnection();
      const request = pool.request();
      request.input('placeID', sql.NVarChar, placeID);
      let excludeClause = '';
      if (Number.isInteger(excludeClinicId)) {
        request.input('excludeClinicId', sql.Int, excludeClinicId);
        excludeClause = ' AND ClinicID <> @excludeClinicId';
      }

      const result = await request.query(`
        SELECT TOP 1
          ClinicID,
          ClinicName,
          Address,
          Phone,
          Website,
          PlaceID,
          Latitude,
          Longitude
        FROM Clinics
        WHERE PlaceID = @placeID
        ${excludeClause}
      `);

      if (result.recordset.length > 0) {
        const clinic = result.recordset[0];
        // Get city/state from Locations table if available
        const locationResult = await pool.request()
          .input('clinicId', sql.Int, clinic.ClinicID)
          .query(`
            SELECT City, State
            FROM Locations
            WHERE LocationID = (SELECT LocationID FROM Clinics WHERE ClinicID = @clinicId)
          `);

        return {
          clinicId: clinic.ClinicID,
          clinicName: clinic.ClinicName,
          address: clinic.Address,
          city: locationResult.recordset[0]?.City || null,
          state: locationResult.recordset[0]?.State || null,
          phone: clinic.Phone,
          website: clinic.Website,
          placeID: clinic.PlaceID
        };
      }

      return null;
    } catch (error) {
      console.error('Error checking PlaceID match:', error);
      return null;
    }
  }

  /**
   * Find exact PlaceID duplicate candidate.
   * Returns a clinic object from checkPlaceIDMatch or null.
   */
  async findExactPlaceIdDuplicate(placeID, options = {}) {
    if (!placeID || !String(placeID).trim()) {
      return null;
    }
    return this.checkPlaceIDMatch(String(placeID).trim(), options);
  }

  /**
   * Check for fuzzy name + address match
   */
  async checkFuzzyNameAddressMatch(clinicName, address) {
    try {
      const pool = await db.getConnection();
      const result = await pool.request().query(`
        SELECT
          ClinicID,
          ClinicName,
          Address,
          Phone,
          Website,
          PlaceID,
          Latitude,
          Longitude,
          LocationID
        FROM Clinics
        WHERE ClinicName IS NOT NULL AND Address IS NOT NULL
      `);

      const matches = [];
      const normalizedAddress = this.normalizeAddress(address);

      for (const clinic of result.recordset) {
        // Get city/state
        let city = null, state = null;
        if (clinic.LocationID) {
          const locationResult = await pool.request()
            .input('locationId', sql.Int, clinic.LocationID)
            .query(`SELECT City, State FROM Locations WHERE LocationID = @locationId`);
          if (locationResult.recordset.length > 0) {
            city = locationResult.recordset[0].City;
            state = locationResult.recordset[0].State;
          }
        }

        // Fuzzy match on name
        const nameScore = fuzzball.ratio(clinicName.toLowerCase(), clinic.ClinicName.toLowerCase());
        
        // Fuzzy match on address
        const normalizedClinicAddress = this.normalizeAddress(clinic.Address);
        const addressScore = fuzzball.ratio(normalizedAddress, normalizedClinicAddress);

        // Combined score (weighted: name 60%, address 40%)
        const combinedScore = (nameScore * 0.6 + addressScore * 0.4) / 100;

        if (combinedScore >= 0.75) { // 75% similarity threshold
          matches.push({
            clinicId: clinic.ClinicID,
            clinicName: clinic.ClinicName,
            address: clinic.Address,
            city,
            state,
            phone: clinic.Phone,
            website: clinic.Website,
            placeID: clinic.PlaceID,
            confidence: combinedScore >= 0.9 ? 'high' : 'medium',
            matchReason: 'Fuzzy name + address match',
            similarityScore: combinedScore
          });
        }
      }

      return matches;
    } catch (error) {
      console.error('Error checking fuzzy name+address match:', error);
      return [];
    }
  }

  /**
   * Check for phone number match
   */
  async checkPhoneMatch(phone) {
    try {
      const normalizedPhone = this.normalizePhone(phone);
      const pool = await db.getConnection();
      const result = await pool.request().query(`
        SELECT
          ClinicID,
          ClinicName,
          Address,
          Phone,
          Website,
          PlaceID,
          LocationID
        FROM Clinics
        WHERE Phone IS NOT NULL
      `);

      for (const clinic of result.recordset) {
        const normalizedClinicPhone = this.normalizePhone(clinic.Phone);
        if (normalizedPhone === normalizedClinicPhone) {
          // Get city/state
          let city = null, state = null;
          if (clinic.LocationID) {
            const locationResult = await pool.request()
              .input('locationId', sql.Int, clinic.LocationID)
              .query(`SELECT City, State FROM Locations WHERE LocationID = @locationId`);
            if (locationResult.recordset.length > 0) {
              city = locationResult.recordset[0].City;
              state = locationResult.recordset[0].State;
            }
          }

          return {
            clinicId: clinic.ClinicID,
            clinicName: clinic.ClinicName,
            address: clinic.Address,
            city,
            state,
            phone: clinic.Phone,
            website: clinic.Website,
            placeID: clinic.PlaceID
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking phone match:', error);
      return null;
    }
  }

  /**
   * Check for website domain match
   */
  async checkWebsiteMatch(website) {
    try {
      const domain = this.extractDomain(website);
      if (!domain) return null;

      const pool = await db.getConnection();
      const result = await pool.request().query(`
        SELECT
          ClinicID,
          ClinicName,
          Address,
          Phone,
          Website,
          PlaceID,
          LocationID
        FROM Clinics
        WHERE Website IS NOT NULL
      `);

      for (const clinic of result.recordset) {
        const clinicDomain = this.extractDomain(clinic.Website);
        if (clinicDomain && clinicDomain === domain) {
          // Get city/state
          let city = null, state = null;
          if (clinic.LocationID) {
            const locationResult = await pool.request()
              .input('locationId', sql.Int, clinic.LocationID)
              .query(`SELECT City, State FROM Locations WHERE LocationID = @locationId`);
            if (locationResult.recordset.length > 0) {
              city = locationResult.recordset[0].City;
              state = locationResult.recordset[0].State;
            }
          }

          return {
            clinicId: clinic.ClinicID,
            clinicName: clinic.ClinicName,
            address: clinic.Address,
            city,
            state,
            phone: clinic.Phone,
            website: clinic.Website,
            placeID: clinic.PlaceID
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking website match:', error);
      return null;
    }
  }

  /**
   * Check for fuzzy name + location match
   */
  async checkFuzzyNameLocationMatch(clinicName, city, state) {
    try {
      const pool = await db.getConnection();
      const result = await pool.request().query(`
        SELECT
          c.ClinicID,
          c.ClinicName,
          c.Address,
          c.Phone,
          c.Website,
          c.PlaceID,
          l.City,
          l.State
        FROM Clinics c
        LEFT JOIN Locations l ON c.LocationID = l.LocationID
        WHERE c.ClinicName IS NOT NULL
          AND (l.City IS NOT NULL OR l.State IS NOT NULL)
      `);

      const matches = [];

      for (const clinic of result.recordset) {
        // Check city/state match
        const cityMatch = clinic.City && 
          fuzzball.ratio(city.toLowerCase(), clinic.City.toLowerCase()) >= 80;
        // Compare canonical forms, not raw strings. Locations.State holds a
        // mix of 'FL' and 'Florida' (92 of 255 rows are not two-letter codes
        // as of 2026-10-05) and the incoming submission may use either, so a
        // plain lowercase equality test silently misses real duplicates.
        const stateMatch = clinic.State &&
          canonicalOrRaw(state) === canonicalOrRaw(clinic.State);

        if (cityMatch && stateMatch) {
          // Fuzzy match on name
          const nameScore = fuzzball.ratio(clinicName.toLowerCase(), clinic.ClinicName.toLowerCase()) / 100;

          if (nameScore >= 0.7) {
            matches.push({
              clinicId: clinic.ClinicID,
              clinicName: clinic.ClinicName,
              address: clinic.Address,
              city: clinic.City,
              state: clinic.State,
              phone: clinic.Phone,
              website: clinic.Website,
              placeID: clinic.PlaceID,
              confidence: nameScore >= 0.85 ? 'medium' : 'low',
              matchReason: 'Fuzzy name + city/state match',
              similarityScore: nameScore
            });
          }
        }
      }

      return matches;
    } catch (error) {
      console.error('Error checking fuzzy name+location match:', error);
      return [];
    }
  }

  /**
   * Load the columns the same-address check compares, for every clinic.
   * GooglePlacesData supplies street/ZIP when Clinics.Address is empty, and the
   * priced-procedure count distinguishes two practices sharing one website.
   * @returns {Promise<Object[]>} rows in the shape utils/addressDuplicateUtils expects
   */
  async loadAddressComparableClinics() {
    const pool = await db.getConnection();
    const result = await pool.request().query(`
      SELECT
        c.ClinicID, c.ClinicName, c.Address, c.City, c.State, c.PostalCode, c.Website,
        g.Street AS GoogleStreet, g.City AS GoogleCity, g.State AS GoogleState,
        g.PostalCode AS GooglePostalCode, g.Website AS GoogleWebsite,
        ISNULL(p.PricedProcedures, 0) AS PricedProcedures
      FROM Clinics c
      OUTER APPLY (
        SELECT TOP 1 Street, City, State, PostalCode, Website
        FROM GooglePlacesData gp
        WHERE gp.ClinicID = c.ClinicID
        ORDER BY gp.GoogleDataID DESC
      ) g
      LEFT JOIN (
        SELECT ClinicID, COUNT(*) AS PricedProcedures
        FROM Procedures
        WHERE AverageCost IS NOT NULL
        GROUP BY ClinicID
      ) p ON p.ClinicID = c.ClinicID
      WHERE (c.Address IS NOT NULL AND LTRIM(RTRIM(c.Address)) <> '')
         OR g.Street IS NOT NULL
    `);
    return result.recordset.map(r => ({
      clinicId: r.ClinicID,
      clinicName: r.ClinicName,
      address: r.Address,
      city: r.City,
      state: r.State,
      postalCode: r.PostalCode,
      website: r.Website,
      googleStreet: r.GoogleStreet,
      googleCity: r.GoogleCity,
      googleState: r.GoogleState,
      googlePostalCode: r.GooglePostalCode,
      googleWebsite: r.GoogleWebsite,
      pricedProcedures: r.PricedProcedures
    }));
  }

  /**
   * Same-address candidates for one incoming clinic (GLO-86).
   * Returns likely_duplicate and review_only matches; never excluded ones.
   */
  async checkSameAddressMatch(clinicData) {
    try {
      const incoming = {
        clinicId: null,
        clinicName: clinicData.clinicName,
        address: clinicData.address,
        city: clinicData.city,
        state: clinicData.state,
        postalCode: clinicData.zipCode || clinicData.postalCode || null,
        website: clinicData.website,
        pricedProcedures: clinicData.pricedProcedures ?? null
      };
      const now = Date.now();
      if (!this._addressRowsCache || now - this._addressRowsCache.at > 30000) {
        this._addressRowsCache = { at: now, rows: await this.loadAddressComparableClinics() };
      }
      const rows = this._addressRowsCache.rows;
      const matches = [];
      for (const row of rows) {
        const pair = classifyAddressPair(incoming, row);
        if (!pair || !ADDRESS_CONFIDENCE[pair.classification]) continue;
        const { confidence, score } = ADDRESS_CONFIDENCE[pair.classification];
        matches.push({
          clinicId: row.clinicId,
          clinicName: row.clinicName,
          address: row.address || row.googleStreet,
          city: row.city || row.googleCity || null,
          state: row.state || row.googleState || null,
          phone: null,
          website: row.website,
          placeID: null,
          confidence,
          matchReason: `Same address (${pair.classification}: ${pair.reason})`,
          similarityScore: score,
          addressClassification: pair.classification,
          addressEvidence: { reason: pair.reason, ...pair.evidence }
        });
      }
      return matches;
    } catch (error) {
      console.error('Error checking same-address match:', error);
      return [];
    }
  }

  /**
   * Scan every clinic for same-address candidate pairs (GLO-86). Read-only:
   * this only surfaces candidates for a human to review, it never merges.
   * @param {Object} [options]
   * @param {boolean} [options.includeExcluded=false] include suite-mismatch pairs
   */
  async findAddressDuplicateCandidates(options = {}) {
    const { includeExcluded = false } = options;
    const rows = await this.loadAddressComparableClinics();
    const pairs = findAddressCandidatePairs(rows);
    const candidates = includeExcluded
      ? pairs
      : pairs.filter(p => p.classification !== ADDRESS_CLASSIFICATIONS.EXCLUDED);
    const counts = {};
    for (const c of Object.values(ADDRESS_CLASSIFICATIONS)) counts[c] = 0;
    for (const p of pairs) counts[p.classification]++;
    return { clinicsScanned: rows.length, counts, candidates };
  }

  /**
   * Normalize address for comparison
   */
  normalizeAddress(address) {
    if (!address) return '';
    return address
      .toLowerCase()
      .replace(/[.,#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize phone for comparison
   */
  normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/[\s\-\(\)\.]/g, '');
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    if (!url) return null;
    try {
      // Add protocol if missing
      let urlStr = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        urlStr = 'https://' + url;
      }
      const urlObj = new URL(urlStr);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }
}

module.exports = new DuplicateDetectionService();

