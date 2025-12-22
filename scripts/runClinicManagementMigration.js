// Load environment variables first
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { db, sql } = require('../db');

/**
 * Run clinic management migration
 * Executes the SQL migration file using the existing database connection
 * 
 * Usage:
 *   node scripts/runClinicManagementMigration.js                    # runs addClinicManagementTables.sql
 *   node scripts/runClinicManagementMigration.js updateClinicSubmissions  # runs updateClinicSubmissions.sql
 */
async function runMigration(migrationFile = 'addClinicManagementTables.sql') {
  let pool;
  try {
    console.log(`Reading migration file: ${migrationFile}...`);
    const migrationPath = path.join(__dirname, '../migrations/', migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Connecting to database...');
    pool = await db.getConnection();

    // Split SQL by GO statements (SQL Server batch separator)
    const batches = migrationSQL
      .split(/^\s*GO\s*$/gim)
      .map(batch => batch.trim())
      .filter(batch => batch.length > 0);

    console.log(`Executing ${batches.length} SQL batches...\n`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // Skip PRINT statements (they're informational)
      if (batch.trim().toUpperCase().startsWith('PRINT')) {
        const message = batch.match(/PRINT\s+['"](.*?)['"]/i);
        if (message) {
          console.log(`  ${message[1]}`);
        }
        continue;
      }

      try {
        const request = pool.request();
        await request.query(batch);
        console.log(`  ✓ Batch ${i + 1} executed successfully`);
      } catch (error) {
        // Some errors are expected (e.g., table already exists)
        if (error.message.includes('already exists') || 
            error.message.includes('already exist')) {
          console.log(`  ⚠ Batch ${i + 1}: ${error.message.split('\n')[0]}`);
        } else {
          throw error;
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Set CLINIC_MANAGEMENT_API_KEY in your .env file');
    console.log('2. Restart your server');
    console.log('3. Test the health endpoint: GET /api/clinic-management/health');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    if (pool) {
      try {
        await db.close();
      } catch (err) {
        // Ignore close errors
      }
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  // Get migration file from command line args
  const args = process.argv.slice(2);
  let migrationFile = 'addClinicManagementTables.sql';
  
  if (args[0]) {
    // Allow passing just the name without .sql extension
    migrationFile = args[0].endsWith('.sql') ? args[0] : `${args[0]}.sql`;
  }
  
  runMigration(migrationFile)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };

