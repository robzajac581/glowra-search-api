const { db, sql } = require('../../db');
const fuzzball = require('fuzzball');

/**
 * Multi-strategy duplicate detection service
 * Checks for duplicates using PlaceID, fuzzy name+address matching, phone, and website
 */
class DuplicateDetectionService {
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
  async checkPlaceIDMatch(placeID) {
    try {
      const pool = await db.getConnection();
      const request = pool.request();
      request.input('placeID', sql.NVarChar, placeID);

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
        const stateMatch = clinic.State && 
          state.toLowerCase() === clinic.State.toLowerCase();

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

