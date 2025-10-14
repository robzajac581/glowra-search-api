const fs = require('fs');
const { sql, db } = require('../db');

async function verifyMatches() {
  let pool;
  
  try {
    const badMatches = JSON.parse(fs.readFileSync('./scripts/bad-matches.json', 'utf8')).badMatches;
    
    pool = await db.getConnection();
    
    console.log('=== VERIFYING SUSPICIOUS MATCHES ===\n');
    console.log('Checking locations to confirm if matches are correct or wrong...\n');
    
    const definitelyWrong = [];
    const probablyCorrect = [];
    
    for (const match of badMatches) {
      // Get DB clinic details
      const dbResult = await pool.request()
        .input('clinicId', sql.Int, match.dbId)
        .query('SELECT Address, Latitude, Longitude FROM Clinics WHERE ClinicID = @clinicId');
      
      const dbClinic = dbResult.recordset[0];
      const excelRow = match.excelRow;
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Checking: "${match.excelName}"`);
      console.log(`Matched to: "${match.dbName}" (ID: ${match.dbId})`);
      console.log(`Confidence: ${match.confidence}%, Name similarity: ${match.nameScore}%`);
      console.log();
      
      console.log('Excel location:');
      console.log(`  Address: ${excelRow.full_address}`);
      console.log(`  City: ${excelRow.city}, ${excelRow.state}`);
      console.log(`  Coordinates: ${excelRow.latitude}, ${excelRow.longitude}`);
      console.log();
      
      console.log('Database location:');
      console.log(`  Address: ${dbClinic.Address}`);
      console.log(`  Coordinates: ${dbClinic.Latitude}, ${dbClinic.Longitude}`);
      console.log();
      
      // Calculate distance
      let distance = null;
      if (excelRow.latitude && excelRow.longitude && dbClinic.Latitude && dbClinic.Longitude) {
        const R = 6371; // Earth's radius in km
        const dLat = (dbClinic.Latitude - excelRow.latitude) * Math.PI / 180;
        const dLon = (dbClinic.Longitude - excelRow.longitude) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(excelRow.latitude * Math.PI / 180) * Math.cos(dbClinic.Latitude * Math.PI / 180) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        distance = R * c;
      }
      
      // Determine if match is correct
      let verdict = '';
      let isWrong = false;
      
      if (match.nameScore === 100 && distance !== null && distance < 50) {
        verdict = '✅ CORRECT - 100% name match, same general area';
      } else if (match.nameScore >= 95 && distance !== null && distance < 50) {
        verdict = '✅ CORRECT - Very high name match, same area';
      } else if (distance !== null && distance > 100) {
        verdict = `❌ WRONG - ${distance.toFixed(0)}km apart! Different locations!`;
        isWrong = true;
      } else if (match.nameScore < 85) {
        verdict = '❌ WRONG - Low name similarity, likely different clinics';
        isWrong = true;
      } else if (distance !== null && distance < 10) {
        verdict = '✅ CORRECT - Same location (within 10km)';
      } else {
        verdict = `⚠️  UNCERTAIN - Distance: ${distance ? distance.toFixed(1) + 'km' : 'unknown'}`;
        // For uncertain, use name match as tiebreaker
        if (match.nameScore >= 95) {
          verdict += ' - but 95%+ name match, probably correct';
        } else {
          verdict += ' - treat as WRONG to be safe';
          isWrong = true;
        }
      }
      
      console.log(`Distance: ${distance ? distance.toFixed(1) + ' km' : 'Cannot calculate'}`);
      console.log(`VERDICT: ${verdict}`);
      
      if (isWrong) {
        definitelyWrong.push({
          ...match,
          distance,
          verdict
        });
      } else {
        probablyCorrect.push({
          ...match,
          distance,
          verdict
        });
      }
    }
    
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 FINAL ANALYSIS');
    console.log('='.repeat(80));
    console.log(`\n❌ DEFINITELY WRONG (need to revert): ${definitelyWrong.length}`);
    definitelyWrong.forEach(m => {
      console.log(`   - "${m.excelName}" → "${m.dbName}" (ID: ${m.dbId})`);
    });
    
    console.log(`\n✅ PROBABLY CORRECT (keep as-is): ${probablyCorrect.length}`);
    probablyCorrect.forEach(m => {
      console.log(`   - "${m.excelName}" → "${m.dbName}" (ID: ${m.dbId})`);
    });
    
    // Save results
    fs.writeFileSync(
      './scripts/matches-to-revert.json',
      JSON.stringify({ definitelyWrong, probablyCorrect }, null, 2)
    );
    
    console.log('\n✅ Results saved to: scripts/matches-to-revert.json');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (pool) await db.close();
  }
}

verifyMatches();

