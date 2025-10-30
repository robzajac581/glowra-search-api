/**
 * Setup Provider Photos Script
 * 
 * This script automates the complete setup process for provider photos:
 * 1. Runs the database migration to add PhotoData and PhotoContentType columns
 * 2. Imports all provider photos from the filesystem to the database
 * 3. Generates a summary report
 * 
 * Run this script once to migrate from filesystem-based photos to database-stored photos.
 * 
 * Usage: node scripts/setupProviderPhotos.js
 * 
 * Author: System
 * Date: October 30, 2025
 */

const fs = require('fs').promises;
const path = require('path');
const { sql, db } = require('../db');
const { importProviderPhotosToDB } = require('./importProviderPhotosToDB');

async function runMigration() {
  console.log('📋 Running database migration...\n');
  
  const pool = await db.getConnection();
  const migrationPath = path.join(__dirname, '../migrations/addProviderPhotoBinary.sql');
  const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
  
  // Split by GO statements and execute each batch
  const batches = migrationSQL
    .split(/\nGO\n/i)
    .filter(batch => batch.trim().length > 0);
  
  for (const batch of batches) {
    if (batch.trim()) {
      await pool.request().query(batch);
    }
  }
  
  console.log('✅ Database migration completed\n');
}

async function main() {
  try {
    console.log('🚀 Starting Provider Photos Setup\n');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Step 1: Run migration
    await runMigration();
    
    // Step 2: Import photos
    console.log('═══════════════════════════════════════════════════════════\n');
    await importProviderPhotosToDB();
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ PROVIDER PHOTOS SETUP COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Next steps:');
    console.log('1. ✅ Database migration: COMPLETE');
    console.log('2. ✅ Photos imported: COMPLETE');
    console.log('3. ⏭️  Deploy updated app.js to production');
    console.log('4. ⏭️  Test /api/provider-photos/:providerId endpoint');
    console.log('5. ⏭️  Update frontend to use new PhotoURL format\n');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the setup
if (require.main === module) {
  main()
    .then(() => {
      console.log('✅ Setup completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };

