const XLSX = require('xlsx');
const fuzz = require('fuzzball');
const { sql, db } = require('../db');

// Helper function to calculate distance between two lat/lng points (in km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Clean and normalize string for comparison
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize spaces
    .trim();
}

// Extract city/state from address
function extractLocation(address) {
  if (!address) return { city: '', state: '' };
  
  // Common patterns: "City, State ZIP" or "Street, City, State"
  const parts = address.split(',').map(p => p.trim());
  
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const secondLastPart = parts[parts.length - 2];
    
    // Extract state (usually 2-letter code or full name)
    const stateMatch = lastPart.match(/\b([A-Z]{2})\b/) || 
                       secondLastPart.match(/\b([A-Z]{2})\b/);
    const state = stateMatch ? stateMatch[1] : '';
    
    // City is usually second to last, or before the state
    const city = secondLastPart.replace(/\b[A-Z]{2}\b/, '').trim();
    
    return { city: city.toLowerCase(), state: state.toLowerCase() };
  }
  
  return { city: '', state: '' };
}

async function analyzeUnmatched(excelFilePath) {
  let pool;
  
  try {
    console.log('Reading Excel file...');
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const allData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    
    console.log('Connecting to database...');
    pool = await db.getConnection();
    
    // Get all clinics from database
    const dbResult = await pool.request().query(`
      SELECT 
        ClinicID,
        ClinicName,
        Address,
        Latitude,
        Longitude,
        PlaceID,
        Phone,
        Website
      FROM Clinics
      ORDER BY ClinicID
    `);
    
    const dbClinics = dbResult.recordset;
    console.log(`Found ${dbClinics.length} clinics in database\n`);
    
    // Filter to only unmatched Excel rows (those without a match in first import)
    const unmatchedExcel = allData.filter(row => {
      if (!row['business name']) return false;
      
      // Check if this clinic was already matched (has PlaceID in database)
      const alreadyMatched = dbClinics.some(db => 
        db.PlaceID === row.place_id
      );
      
      return !alreadyMatched;
    });
    
    console.log(`Analyzing ${unmatchedExcel.length} unmatched Excel rows...\n`);
    console.log('='.repeat(80));
    
    const matches = [];
    const noMatches = [];
    
    for (const excelRow of unmatchedExcel) {
      const excelName = excelRow['business name'];
      const excelAddress = excelRow.full_address || excelRow['Provided Address'];
      const excelLat = parseFloat(excelRow.latitude);
      const excelLon = parseFloat(excelRow.longitude);
      const excelCity = excelRow.city?.toLowerCase();
      const excelState = excelRow.state?.toLowerCase();
      
      console.log(`\n📋 EXCEL: ${excelName}`);
      console.log(`   Address: ${excelAddress}`);
      console.log(`   Location: ${excelCity}, ${excelState}`);
      
      // Find potential matches using multiple strategies
      const potentialMatches = [];
      
      for (const dbClinic of dbClinics) {
        const dbLocation = extractLocation(dbClinic.Address);
        
        // Strategy 1: Fuzzy name matching
        const nameScore = fuzz.ratio(
          normalizeString(excelName), 
          normalizeString(dbClinic.ClinicName)
        );
        
        // Strategy 2: Partial name matching (handles "Dr. Name" vs "Name, MD" cases)
        const partialScore = fuzz.partial_ratio(
          normalizeString(excelName), 
          normalizeString(dbClinic.ClinicName)
        );
        
        // Strategy 3: Token sort (handles word order differences)
        const tokenScore = fuzz.token_sort_ratio(
          normalizeString(excelName), 
          normalizeString(dbClinic.ClinicName)
        );
        
        const bestNameScore = Math.max(nameScore, partialScore, tokenScore);
        
        // Strategy 4: Geographic distance
        const distance = calculateDistance(
          excelLat, excelLon, 
          dbClinic.Latitude, dbClinic.Longitude
        );
        
        // Strategy 5: Same city/state
        const sameCity = excelCity && dbLocation.city && 
                         excelCity.includes(dbLocation.city) || 
                         dbLocation.city.includes(excelCity);
        const sameState = excelState && dbLocation.state && 
                          excelState === dbLocation.state;
        
        // Determine match confidence
        let matchConfidence = 0;
        let reasons = [];
        
        if (bestNameScore >= 90) {
          matchConfidence += 50;
          reasons.push(`Name match: ${bestNameScore}%`);
        } else if (bestNameScore >= 75) {
          matchConfidence += 30;
          reasons.push(`Name similar: ${bestNameScore}%`);
        } else if (bestNameScore >= 60) {
          matchConfidence += 15;
          reasons.push(`Name partial: ${bestNameScore}%`);
        }
        
        if (distance !== null && distance < 0.5) { // Same location (within 500m)
          matchConfidence += 40;
          reasons.push(`Same location: ${distance.toFixed(2)}km`);
        } else if (distance !== null && distance < 5) { // Same area
          matchConfidence += 20;
          reasons.push(`Nearby: ${distance.toFixed(2)}km`);
        }
        
        if (sameState) {
          matchConfidence += 10;
          reasons.push('Same state');
        }
        
        if (sameCity) {
          matchConfidence += 10;
          reasons.push('Same city');
        }
        
        // Only consider if there's some confidence
        if (matchConfidence >= 40 || (bestNameScore >= 70 && sameState)) {
          potentialMatches.push({
            dbClinic,
            confidence: matchConfidence,
            nameScore: bestNameScore,
            distance,
            reasons: reasons.join(', ')
          });
        }
      }
      
      // Sort by confidence
      potentialMatches.sort((a, b) => b.confidence - a.confidence);
      
      if (potentialMatches.length > 0) {
        const best = potentialMatches[0];
        console.log(`\n   ✅ LIKELY MATCH (${best.confidence}% confidence):`);
        console.log(`   DB: ${best.dbClinic.ClinicName} (ID: ${best.dbClinic.ClinicID})`);
        console.log(`   Address: ${best.dbClinic.Address}`);
        console.log(`   Reasons: ${best.reasons}`);
        
        if (potentialMatches.length > 1 && potentialMatches[1].confidence >= 40) {
          console.log(`\n   ⚠️  Alternative matches:`);
          for (let i = 1; i < Math.min(3, potentialMatches.length); i++) {
            const alt = potentialMatches[i];
            console.log(`   - ${alt.dbClinic.ClinicName} (ID: ${alt.dbClinic.ClinicID}) - ${alt.confidence}%`);
            console.log(`     ${alt.reasons}`);
          }
        }
        
        matches.push({
          excelRow,
          excelName,
          bestMatch: best,
          alternativeMatches: potentialMatches.slice(1, 3)
        });
      } else {
        console.log(`\n   ❌ NO MATCH FOUND - Will create new clinic`);
        noMatches.push({
          excelRow,
          excelName,
          excelAddress,
          city: excelCity,
          state: excelState
        });
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total unmatched Excel rows: ${unmatchedExcel.length}`);
    console.log(`Potential duplicates found: ${matches.length}`);
    console.log(`New clinics to create: ${noMatches.length}`);
    
    // Save results to JSON for review
    const results = {
      timestamp: new Date().toISOString(),
      summary: {
        totalUnmatched: unmatchedExcel.length,
        duplicatesFound: matches.length,
        newClinics: noMatches.length
      },
      matches,
      noMatches
    };
    
    const fs = require('fs');
    fs.writeFileSync(
      './scripts/matching-report.json',
      JSON.stringify(results, null, 2)
    );
    
    console.log('\n✅ Analysis complete! Report saved to: scripts/matching-report.json');
    
    return results;
    
  } catch (error) {
    console.error('Analysis failed:', error);
    throw error;
  } finally {
    if (pool) {
      await db.close();
    }
  }
}

// Usage
const excelPath = process.argv[2] || './scripts/data/google_places_data.xlsx';
analyzeUnmatched(excelPath);

