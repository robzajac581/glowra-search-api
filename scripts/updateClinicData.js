/**
 * Update Clinic Data Script
 * 
 * Purpose: Update clinic URLs and deactivate closed clinics
 * Based on feedback from photo repo update
 * 
 * Author: System
 * Date: October 18, 2025
 */

const { sql, db } = require('../db');

async function updateClinicData() {
  let pool;
  
  try {
    console.log('🔄 Starting clinic data updates...\n');
    
    pool = await db.getConnection();
    console.log('✅ Connected to database\n');
    
    // 1. Update MIAMI LIFE PLASTIC SURGERY URL
    console.log('1. Updating MIAMI LIFE PLASTIC SURGERY URL...');
    const miamiResult = await pool.request()
      .input('oldURL', sql.NVarChar(500), 'https://miamilifeplasticsurgery.com/%')
      .input('newURL', sql.NVarChar(500), 'https://miamilifecosmetic.com/')
      .query(`
        UPDATE Clinics
        SET Website = @newURL
        WHERE ClinicName LIKE '%MIAMI LIFE PLASTIC SURGERY%'
          OR Website LIKE @oldURL
      `);
    
    console.log(`   ✓ Updated ${miamiResult.rowsAffected[0]} clinic(s)\n`);
    
    // 2. Update New Face MD URL
    console.log('2. Updating New Face MD URL...');
    const newFaceResult = await pool.request()
      .input('newURL', sql.NVarChar(500), 'https://newfacemd.com/')
      .query(`
        UPDATE Clinics
        SET Website = @newURL
        WHERE ClinicName LIKE '%New Face MD%'
          OR ClinicName LIKE '%NewFace MD%'
      `);
    
    console.log(`   ✓ Updated ${newFaceResult.rowsAffected[0]} clinic(s)\n`);
    
    // 3. Deactivate Blooming Beauty
    console.log('3. Deactivating Blooming Beauty clinic...');
    
    // First, check if there's an "IsActive" or "Status" column
    const checkResult = await pool.request().query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'Clinics' 
        AND (COLUMN_NAME = 'IsActive' OR COLUMN_NAME = 'Status')
    `);
    
    if (checkResult.recordset.length > 0) {
      // Column exists, update it
      const hasIsActive = checkResult.recordset.some(r => r.COLUMN_NAME === 'IsActive');
      const hasStatus = checkResult.recordset.some(r => r.COLUMN_NAME === 'Status');
      
      if (hasIsActive) {
        await pool.request().query(`
          UPDATE Clinics
          SET IsActive = 0
          WHERE ClinicName LIKE '%Blooming Beauty%'
        `);
        console.log('   ✓ Set IsActive = 0 for Blooming Beauty\n');
      } else if (hasStatus) {
        await pool.request().query(`
          UPDATE Clinics
          SET Status = 'Inactive'
          WHERE ClinicName LIKE '%Blooming Beauty%'
        `);
        console.log('   ✓ Set Status = Inactive for Blooming Beauty\n');
      }
    } else {
      // Column doesn't exist, add note to clinic name
      const bloomingResult = await pool.request().query(`
        UPDATE Clinics
        SET ClinicName = ClinicName + ' (CLOSED)'
        WHERE ClinicName LIKE '%Blooming Beauty%'
          AND ClinicName NOT LIKE '%(CLOSED)%'
      `);
      console.log(`   ✓ Marked ${bloomingResult.rowsAffected[0]} clinic(s) as CLOSED\n`);
    }
    
    // 4. Fix "Jr." parsing issue - merge split provider records
    console.log('4. Fixing provider name suffixes (Jr., Sr., etc.)...');
    
    // Find providers that are just suffixes
    const suffixProviders = await pool.request().query(`
      SELECT ProviderID, ProviderName, ClinicID
      FROM Providers
      WHERE ProviderName IN ('Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV', 'V', 'MD', 'DO', 'FACS')
    `);
    
    if (suffixProviders.recordset.length > 0) {
      console.log(`   Found ${suffixProviders.recordset.length} suffix-only provider record(s)`);
      
      for (const suffix of suffixProviders.recordset) {
        // Find the provider in same clinic that should have this suffix
        const mainProviderResult = await pool.request()
          .input('clinicID', sql.Int, suffix.ClinicID)
          .input('suffixID', sql.Int, suffix.ProviderID)
          .query(`
            SELECT TOP 1 ProviderID, ProviderName
            FROM Providers
            WHERE ClinicID = @clinicID
              AND ProviderID != @suffixID
              AND ProviderName NOT IN ('Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV', 'V', 'MD', 'DO', 'FACS')
            ORDER BY ProviderID DESC
          `);
        
        if (mainProviderResult.recordset.length > 0) {
          const mainProvider = mainProviderResult.recordset[0];
          const newName = `${mainProvider.ProviderName} ${suffix.ProviderName}`;
          
          // Update main provider name
          await pool.request()
            .input('providerID', sql.Int, mainProvider.ProviderID)
            .input('newName', sql.NVarChar(255), newName)
            .query(`
              UPDATE Providers
              SET ProviderName = @newName
              WHERE ProviderID = @providerID
            `);
          
          console.log(`   ✓ Merged: "${mainProvider.ProviderName}" + "${suffix.ProviderName}" → "${newName}"`);
          
          // Move any procedures/data from suffix record to main record
          await pool.request()
            .input('fromID', sql.Int, suffix.ProviderID)
            .input('toID', sql.Int, mainProvider.ProviderID)
            .query(`
              UPDATE Procedures
              SET ProviderID = @toID
              WHERE ProviderID = @fromID
            `);
          
          // Delete the suffix-only record
          await pool.request()
            .input('providerID', sql.Int, suffix.ProviderID)
            .query(`
              DELETE FROM Providers WHERE ProviderID = @providerID
            `);
          
          console.log(`   ✓ Deleted suffix-only record (ID: ${suffix.ProviderID})`);
        }
      }
      console.log('');
    } else {
      console.log('   ✓ No suffix-only provider records found\n');
    }
    
    // Summary
    console.log('\n✅ DATA UPDATE COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log('✓ Updated MIAMI LIFE PLASTIC SURGERY URL');
    console.log('✓ Updated New Face MD URL');
    console.log('✓ Deactivated Blooming Beauty');
    console.log('✓ Fixed provider name suffixes');
    console.log('\n🎉 All updates completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Error updating clinic data:', error);
    throw error;
  }
}

// Run the updates
if (require.main === module) {
  updateClinicData()
    .then(() => {
      console.log('✅ Clinic data update completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Clinic data update failed:', error);
      process.exit(1);
    });
}

module.exports = { updateClinicData };

