/**
 * Import Provider Photos Script V2
 * 
 * Improvements over V1:
 * - Normalized string matching (trim, lowercase, collapse whitespace)
 * - Better suffix handling (Jr., Sr., MD, DO, FACS, etc.)
 * - Handles multiple providers per clinic better
 * - Works with updated photo folder structure
 * 
 * Author: System
 * Date: October 18, 2025
 */

const fs = require('fs').promises;
const path = require('path');
const { sql, db } = require('../db');

// Normalize strings for better matching
function normalizeString(str) {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .trim()
    // Replace multiple spaces with single space
    .replace(/\s+/g, ' ')
    // Remove special characters but keep spaces and hyphens
    .replace(/[^\w\s-]/g, '')
    // Remove common prefixes/titles
    .replace(/^(dr\.?|doctor|md|do)\s+/i, '')
    // Normalize Unicode (NFKD)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
}

// Suffixes that should stay with the name
const SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'md', 'do', 'facs', 'phd', 'dds', 'dmd', 'pa', 'np', 'rn'];

// Extract and normalize provider name, keeping suffixes
function normalizeProviderName(name) {
  if (!name) return { normalized: '', hasSuffix: false, suffix: '' };
  
  const normalized = normalizeString(name);
  const words = normalized.split(' ');
  
  // Check if last word is a suffix
  const lastWord = words[words.length - 1];
  const hasSuffix = SUFFIXES.includes(lastWord);
  
  return {
    normalized,
    hasSuffix,
    suffix: hasSuffix ? lastWord : '',
    withoutSuffix: hasSuffix ? words.slice(0, -1).join(' ') : normalized
  };
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
    
    if (score > bestScore && score > 0.5) { // 50% similarity threshold
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
  const fileNameData = normalizeProviderName(nameWithoutExt);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const provider of providers) {
    // Skip "Please Request Consult" providers
    if (provider.ProviderName && provider.ProviderName.includes('Please Request Consult')) {
      continue;
    }
    
    const providerNameData = normalizeProviderName(provider.ProviderName);
    
    // Try matching with and without suffixes
    const score1 = similarity(fileNameData.normalized, providerNameData.normalized);
    const score2 = similarity(fileNameData.withoutSuffix, providerNameData.withoutSuffix);
    const score = Math.max(score1, score2);
    
    if (score > bestScore && score > 0.45) { // Slightly lower threshold for better matching
      bestScore = score;
      bestMatch = provider;
    }
  }
  
  return { match: bestMatch, score: bestScore };
}

// Main import function
async function importProviderPhotos(sourceDir = null) {
  let pool;
  
  try {
    console.log('🚀 Starting Provider Photo Import V2...\n');
    
    // Connect to database
    pool = await db.getConnection();
    console.log('✅ Connected to database');
    
    // Get all clinics
    const clinicsResult = await pool.request().query(`
      SELECT ClinicID, ClinicName FROM Clinics
      WHERE ClinicName IS NOT NULL AND ClinicName != ''
    `);
    const clinics = clinicsResult.recordset;
    console.log(`📊 Found ${clinics.length} clinics in database\n`);
    
    // Get all providers (excluding "Please Request Consult" ones for matching)
    const providersResult = await pool.request().query(`
      SELECT p.ProviderID, p.ProviderName, p.ClinicID, c.ClinicName
      FROM Providers p
      JOIN Clinics c ON p.ClinicID = c.ClinicID
      WHERE p.ProviderName IS NOT NULL 
        AND p.ProviderName != ''
    `);
    const providers = providersResult.recordset;
    console.log(`👥 Found ${providers.length} providers in database\n`);
    
    // Determine photo directory
    const photosDir = sourceDir || path.join(__dirname, '../photos/Updated/Glowra Photo Repo V_10_18_25/Provider Pictures');
    console.log(`📁 Reading from: ${photosDir}\n`);
    
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
      
      if (clinicScore < 0.9) {
        console.log(`⚡ Fuzzy match: "${folderName}" → "${clinic.ClinicName}" (${(clinicScore * 100).toFixed(0)}% match)`);
      }
      
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
          
          if (providerScore < 0.9) {
            console.log(`  ⚡ Fuzzy match: "${photoFile}" → "${provider.ProviderName}" (${(providerScore * 100).toFixed(0)}%)`);
          } else {
            console.log(`  ✓ Matched: "${photoFile}" → "${provider.ProviderName}"`);
          }
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
      version: 2,
      summary: {
        totalPhotos: matchedPhotos + unmatchedPhotos,
        matched: matchedPhotos,
        unmatched: unmatchedPhotos,
        updated,
        failed
      },
      matches,
      unmatchedFiles,
      improvements: [
        'Normalized string matching (trim, lowercase, collapse whitespace)',
        'Better suffix handling (Jr., Sr., MD, etc.)',
        'Lower threshold for better fuzzy matching (0.45 vs 0.50)',
        'Skip "Please Request Consult" providers in matching'
      ]
    };
    
    const reportPath = path.join(__dirname, 'provider-photo-import-report-v2.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    // Show unmatched files if any
    if (unmatchedFiles.length > 0) {
      console.log('\n⚠️  UNMATCHED PHOTOS:');
      console.log('═══════════════════════════════════════');
      unmatchedFiles.slice(0, 20).forEach(({ folder, file }) => {
        console.log(`  ${folder}/${file}`);
      });
      if (unmatchedFiles.length > 20) {
        console.log(`  ... and ${unmatchedFiles.length - 20} more (see report)`);
      }
      console.log('\nThese photos need to be matched manually or provider names updated in database.');
    }
    
    console.log('\n🎉 Import complete!\n');
    
    return report;
    
  } catch (error) {
    console.error('❌ Error importing provider photos:', error);
    throw error;
  }
}

// Run the import
if (require.main === module) {
  importProviderPhotos()
    .then(() => {
      console.log('✅ Provider photo import V2 completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Provider photo import V2 failed:', error);
      process.exit(1);
    });
}

module.exports = { importProviderPhotos };

