/**
 * Import Provider Photos Script
 * 
 * Purpose: Match provider photos in /photos/Provider Pictures/ to providers in database
 * and update the PhotoURL field in the Providers table.
 * 
 * Matching Strategy:
 * 1. Match clinic folder names to ClinicName in database (fuzzy matching)
 * 2. Match photo filenames to ProviderName in database (fuzzy matching)
 * 3. Store relative URL path for static serving
 * 
 * Author: System
 * Date: October 18, 2025
 */

const fs = require('fs').promises;
const path = require('path');
const { sql, db } = require('../db');

// Fuzzy matching helper - normalizes strings for comparison
function normalizeString(str) {
  return str
    .toLowerCase()
    .replace(/[.,\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/dr\.?|md|facs|m\.d\./gi, '')
    .trim();
}

// Calculate similarity between two strings (Levenshtein distance)
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Find best matching clinic for a folder name
function findBestClinicMatch(folderName, clinics) {
  const normalizedFolder = normalizeString(folderName);
  let bestMatch = null;
  let bestScore = 0;
  
  for (const clinic of clinics) {
    const normalizedClinic = normalizeString(clinic.ClinicName);
    const score = similarity(normalizedFolder, normalizedClinic);
    
    if (score > bestScore && score > 0.6) { // 60% similarity threshold
      bestScore = score;
      bestMatch = clinic;
    }
  }
  
  return { match: bestMatch, score: bestScore };
}

// Find best matching provider for a filename
function findBestProviderMatch(filename, providers) {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  const normalizedFilename = normalizeString(nameWithoutExt);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const provider of providers) {
    const normalizedProvider = normalizeString(provider.ProviderName);
    const score = similarity(normalizedFilename, normalizedProvider);
    
    if (score > bestScore && score > 0.5) { // 50% similarity threshold
      bestScore = score;
      bestMatch = provider;
    }
  }
  
  return { match: bestMatch, score: bestScore };
}

// Main import function
async function importProviderPhotos() {
  let pool;
  
  try {
    console.log('🚀 Starting Provider Photo Import...\n');
    
    // Connect to database
    pool = await db.getConnection();
    console.log('✅ Connected to database');
    
    // Get all clinics
    const clinicsResult = await pool.request().query(`
      SELECT ClinicID, ClinicName FROM Clinics
    `);
    const clinics = clinicsResult.recordset;
    console.log(`📊 Found ${clinics.length} clinics in database\n`);
    
    // Get all providers
    const providersResult = await pool.request().query(`
      SELECT p.ProviderID, p.ProviderName, p.ClinicID, c.ClinicName
      FROM Providers p
      JOIN Clinics c ON p.ClinicID = c.ClinicID
    `);
    const providers = providersResult.recordset;
    console.log(`👥 Found ${providers.length} providers in database\n`);
    
    // Read photo directory
    const photosDir = path.join(__dirname, '../photos/Provider Pictures');
    const clinicFolders = await fs.readdir(photosDir);
    
    let matchedPhotos = 0;
    let unmatchedPhotos = 0;
    const matches = [];
    const unmatchedFiles = [];
    
    console.log('🔍 Processing provider photos...\n');
    
    // Process each clinic folder
    for (const folderName of clinicFolders) {
      const folderPath = path.join(photosDir, folderName);
      const stat = await fs.stat(folderPath);
      
      if (!stat.isDirectory()) continue;
      
      // Find matching clinic
      const { match: clinic, score: clinicScore } = findBestClinicMatch(folderName, clinics);
      
      if (!clinic) {
        console.log(`⚠️  No clinic match for folder: "${folderName}"`);
        continue;
      }
      
      console.log(`✓ Matched folder "${folderName}" → Clinic "${clinic.ClinicName}" (${(clinicScore * 100).toFixed(0)}% match)`);
      
      // Get providers for this clinic
      const clinicProviders = providers.filter(p => p.ClinicID === clinic.ClinicID);
      
      if (clinicProviders.length === 0) {
        console.log(`  ⚠️  No providers found for clinic ${clinic.ClinicName}`);
        continue;
      }
      
      // Read photos in this clinic folder
      const files = await fs.readdir(folderPath);
      const photoFiles = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
      
      // Match each photo to a provider
      for (const photoFile of photoFiles) {
        const { match: provider, score: providerScore } = findBestProviderMatch(photoFile, clinicProviders);
        
        if (provider) {
          // Store relative URL path
          const photoURL = `/api/provider-photos/${encodeURIComponent(folderName)}/${encodeURIComponent(photoFile)}`;
          
          matches.push({
            providerID: provider.ProviderID,
            providerName: provider.ProviderName,
            clinicName: clinic.ClinicName,
            photoFile,
            photoURL,
            matchScore: providerScore
          });
          
          console.log(`  ✓ Matched "${photoFile}" → Provider "${provider.ProviderName}" (${(providerScore * 100).toFixed(0)}% match)`);
          matchedPhotos++;
        } else {
          unmatchedFiles.push({ folder: folderName, file: photoFile });
          console.log(`  ✗ No provider match for "${photoFile}"`);
          unmatchedPhotos++;
        }
      }
      
      console.log('');
    }
    
    console.log('\n📊 MATCHING SUMMARY');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Matched photos: ${matchedPhotos}`);
    console.log(`❌ Unmatched photos: ${unmatchedPhotos}`);
    console.log(`📈 Success rate: ${((matchedPhotos / (matchedPhotos + unmatchedPhotos)) * 100).toFixed(1)}%\n`);
    
    // Ask for confirmation before updating database
    if (matches.length === 0) {
      console.log('⚠️  No matches found. Exiting without updating database.');
      return;
    }
    
    console.log('💾 Updating database...\n');
    
    // Update database with matched photos
    let updated = 0;
    let failed = 0;
    
    for (const match of matches) {
      try {
        const request = pool.request();
        request.input('providerID', sql.Int, match.providerID);
        request.input('photoURL', sql.NVarChar(500), match.photoURL);
        
        await request.query(`
          UPDATE Providers 
          SET PhotoURL = @photoURL 
          WHERE ProviderID = @providerID
        `);
        
        updated++;
      } catch (error) {
        console.error(`Failed to update provider ${match.providerID}:`, error.message);
        failed++;
      }
    }
    
    console.log('\n✅ DATABASE UPDATE COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Successfully updated: ${updated} providers`);
    console.log(`❌ Failed updates: ${failed}`);
    
    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalPhotos: matchedPhotos + unmatchedPhotos,
        matched: matchedPhotos,
        unmatched: unmatchedPhotos,
        updated,
        failed
      },
      matches,
      unmatchedFiles
    };
    
    const reportPath = path.join(__dirname, 'provider-photo-import-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    // Show unmatched files if any
    if (unmatchedFiles.length > 0) {
      console.log('\n⚠️  UNMATCHED PHOTOS:');
      console.log('═══════════════════════════════════════');
      unmatchedFiles.forEach(({ folder, file }) => {
        console.log(`  ${folder}/${file}`);
      });
      console.log('\nThese photos need to be matched manually or provider names updated in database.');
    }
    
    console.log('\n🎉 Import complete!\n');
    
  } catch (error) {
    console.error('❌ Error importing provider photos:', error);
    throw error;
  }
}

// Run the import
if (require.main === module) {
  importProviderPhotos()
    .then(() => {
      console.log('✅ Provider photo import completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Provider photo import failed:', error);
      process.exit(1);
    });
}

module.exports = { importProviderPhotos };

