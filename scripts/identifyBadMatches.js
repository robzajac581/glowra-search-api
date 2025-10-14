const fs = require('fs');

// Read the matching report
const report = JSON.parse(fs.readFileSync('./scripts/matching-report.json', 'utf8'));

console.log('=== IDENTIFYING POTENTIALLY BAD MATCHES ===\n');
console.log('Matches with <60% confidence should probably be separate clinics:\n');

const badMatches = [];
const goodMatches = [];

report.matches.forEach(match => {
  const confidence = match.bestMatch.confidence;
  const excelName = match.excelName;
  const dbName = match.bestMatch.dbClinic.ClinicName;
  const dbId = match.bestMatch.dbClinic.ClinicID;
  const nameScore = match.bestMatch.nameScore;
  
  if (confidence < 60) {
    console.log(`❌ BAD MATCH (${confidence}% confidence):`);
    console.log(`   Excel: "${excelName}"`);
    console.log(`   DB: "${dbName}" (ID: ${dbId})`);
    console.log(`   Name similarity: ${nameScore}%`);
    console.log(`   Reasons: ${match.bestMatch.reasons}`);
    console.log();
    
    badMatches.push({
      excelName,
      dbName,
      dbId,
      confidence,
      nameScore,
      excelRow: match.excelRow
    });
  } else {
    goodMatches.push(match);
  }
});

console.log('\n' + '='.repeat(80));
console.log('📊 SUMMARY');
console.log('='.repeat(80));
console.log(`Good matches (≥60% confidence): ${goodMatches.length}`);
console.log(`Bad matches (<60% confidence): ${badMatches.length}`);
console.log(`Should be reverted and created as new clinics: ${badMatches.length}`);

// Save bad matches for reversion
fs.writeFileSync(
  './scripts/bad-matches.json',
  JSON.stringify({ badMatches, goodMatches }, null, 2)
);

console.log('\n✅ Analysis saved to: scripts/bad-matches.json');

