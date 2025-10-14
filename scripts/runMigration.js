const fs = require('fs');
const path = require('path');
const { sql, db } = require('../db');

async function runMigration(migrationFile) {
  let pool;
  
  try {
    console.log(`Reading migration file: ${migrationFile}`);
    const sqlContent = fs.readFileSync(migrationFile, 'utf8');
    
    console.log('Connecting to database...');
    pool = await db.getConnection();
    
    // Split by GO statements (SQL Server batch separator)
    const batches = sqlContent
      .split(/^\s*GO\s*$/mi)
      .map(batch => batch.trim())
      .filter(batch => batch.length > 0);
    
    console.log(`Executing ${batches.length} SQL batch(es)...`);
    
    for (let i = 0; i < batches.length; i++) {
      console.log(`Executing batch ${i + 1}/${batches.length}...`);
      await pool.request().query(batches[i]);
    }
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    if (pool) {
      await db.close();
    }
  }
}

// Usage
const migrationFile = process.argv[2] || './migrations/addGooglePlacesData.sql';
const fullPath = path.resolve(migrationFile);

if (!fs.existsSync(fullPath)) {
  console.error(`Migration file not found: ${fullPath}`);
  process.exit(1);
}

runMigration(fullPath);

