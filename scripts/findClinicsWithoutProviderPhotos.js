/**
 * Find Clinics Without Provider Photos
 * 
 * Purpose: Identify clinics that have no provider photos yet
 * Useful for: Prioritizing photo scraping efforts
 * 
 * Author: System
 * Date: October 18, 2025
 */

const { sql, db } = require('../db');
const fs = require('fs').promises;
const path = require('path');

async function findClinicsWithoutProviderPhotos() {
  let pool;
  
  try {
    console.log('🔍 Finding clinics without provider photos...\n');
    
    pool = await db.getConnection();
    console.log('✅ Connected to database\n');
    
    // Query to find clinics with no provider photos
    const result = await pool.request().query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        c.Address,
        c.Website,
        COUNT(p.ProviderID) as TotalProviders,
        COUNT(CASE WHEN p.PhotoURL IS NOT NULL AND p.PhotoURL != '/img/doctor/placeholder.png' THEN 1 END) as ProvidersWithPhotos
      FROM Clinics c
      LEFT JOIN Providers p ON c.ClinicID = p.ClinicID
      GROUP BY c.ClinicID, c.ClinicName, c.Address, c.Website
      HAVING COUNT(p.ProviderID) > 0 
        AND COUNT(CASE WHEN p.PhotoURL IS NOT NULL AND p.PhotoURL != '/img/doctor/placeholder.png' THEN 1 END) = 0
      ORDER BY c.ClinicName;
    `);
    
    const clinicsWithoutPhotos = result.recordset;
    
    // Also get overall statistics
    const statsResult = await pool.request().query(`
      SELECT 
        COUNT(DISTINCT c.ClinicID) as TotalClinics,
        COUNT(DISTINCT CASE WHEN p.PhotoURL IS NOT NULL AND p.PhotoURL != '/img/doctor/placeholder.png' THEN c.ClinicID END) as ClinicsWithPhotos,
        COUNT(DISTINCT CASE WHEN p.PhotoURL IS NULL OR p.PhotoURL = '/img/doctor/placeholder.png' THEN c.ClinicID END) as ClinicsWithoutPhotos,
        COUNT(p.ProviderID) as TotalProviders,
        COUNT(CASE WHEN p.PhotoURL IS NOT NULL AND p.PhotoURL != '/img/doctor/placeholder.png' THEN 1 END) as ProvidersWithPhotos
      FROM Clinics c
      LEFT JOIN Providers p ON c.ClinicID = p.ClinicID
      WHERE p.ProviderID IS NOT NULL;
    `);
    
    const stats = statsResult.recordset[0];
    
    // Get list of providers for each clinic without photos
    const detailedClinics = [];
    
    for (const clinic of clinicsWithoutPhotos) {
      const providersResult = await pool.request()
        .input('clinicId', sql.Int, clinic.ClinicID)
        .query(`
          SELECT ProviderID, ProviderName
          FROM Providers
          WHERE ClinicID = @clinicId
          ORDER BY ProviderName;
        `);
      
      detailedClinics.push({
        ...clinic,
        Providers: providersResult.recordset
      });
    }
    
    // Display results
    console.log('📊 OVERALL STATISTICS');
    console.log('═══════════════════════════════════════');
    console.log(`Total Clinics: ${stats.TotalClinics}`);
    console.log(`Clinics WITH Provider Photos: ${stats.ClinicsWithPhotos} (${((stats.ClinicsWithPhotos / stats.TotalClinics) * 100).toFixed(1)}%)`);
    console.log(`Clinics WITHOUT Provider Photos: ${stats.ClinicsWithoutPhotos} (${((stats.ClinicsWithoutPhotos / stats.TotalClinics) * 100).toFixed(1)}%)`);
    console.log(`\nTotal Providers: ${stats.TotalProviders}`);
    console.log(`Providers WITH Photos: ${stats.ProvidersWithPhotos} (${((stats.ProvidersWithPhotos / stats.TotalProviders) * 100).toFixed(1)}%)`);
    console.log(`Providers WITHOUT Photos: ${stats.TotalProviders - stats.ProvidersWithPhotos} (${(((stats.TotalProviders - stats.ProvidersWithPhotos) / stats.TotalProviders) * 100).toFixed(1)}%)`);
    
    console.log('\n\n📋 CLINICS WITHOUT PROVIDER PHOTOS');
    console.log('═══════════════════════════════════════');
    console.log(`Found ${clinicsWithoutPhotos.length} clinics with no provider photos\n`);
    
    detailedClinics.forEach((clinic, index) => {
      console.log(`${index + 1}. ${clinic.ClinicName}`);
      console.log(`   Clinic ID: ${clinic.ClinicID}`);
      console.log(`   Providers: ${clinic.TotalProviders}`);
      console.log(`   Address: ${clinic.Address || 'N/A'}`);
      console.log(`   Website: ${clinic.Website || 'N/A'}`);
      console.log(`   Provider Names:`);
      clinic.Providers.forEach(p => {
        console.log(`      - ${p.ProviderName}`);
      });
      console.log('');
    });
    
    // Generate CSV report
    const csvLines = ['Clinic ID,Clinic Name,Address,Website,Total Providers,Provider Names'];
    detailedClinics.forEach(clinic => {
      const providerNames = clinic.Providers.map(p => p.ProviderName).join('; ');
      const address = (clinic.Address || '').replace(/,/g, ' ');
      const website = clinic.Website || '';
      csvLines.push(`${clinic.ClinicID},"${clinic.ClinicName}","${address}","${website}",${clinic.TotalProviders},"${providerNames}"`);
    });
    
    const csvPath = path.join(__dirname, 'clinics-without-provider-photos.csv');
    await fs.writeFile(csvPath, csvLines.join('\n'));
    console.log(`\n📄 CSV report saved to: ${csvPath}`);
    
    // Generate detailed JSON report
    const report = {
      timestamp: new Date().toISOString(),
      statistics: {
        totalClinics: stats.TotalClinics,
        clinicsWithPhotos: stats.ClinicsWithPhotos,
        clinicsWithoutPhotos: stats.ClinicsWithoutPhotos,
        totalProviders: stats.TotalProviders,
        providersWithPhotos: stats.ProvidersWithPhotos,
        providersWithoutPhotos: stats.TotalProviders - stats.ProvidersWithPhotos
      },
      clinicsWithoutPhotos: detailedClinics.map(c => ({
        clinicId: c.ClinicID,
        clinicName: c.ClinicName,
        address: c.Address,
        website: c.Website,
        totalProviders: c.TotalProviders,
        providers: c.Providers.map(p => ({
          providerId: p.ProviderID,
          providerName: p.ProviderName
        }))
      }))
    };
    
    const jsonPath = path.join(__dirname, 'clinics-without-provider-photos.json');
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
    console.log(`📄 JSON report saved to: ${jsonPath}`);
    
    // Generate simple text list for easy copying
    const textLines = [
      '# Clinics Without Provider Photos',
      `Generated: ${new Date().toISOString()}`,
      `Total: ${clinicsWithoutPhotos.length} clinics`,
      '',
      '## Clinic List (for photo scraping)',
      ''
    ];
    
    detailedClinics.forEach((clinic, index) => {
      textLines.push(`${index + 1}. ${clinic.ClinicName}`);
      textLines.push(`   Website: ${clinic.Website || 'N/A'}`);
      textLines.push(`   Providers (${clinic.TotalProviders}):`);
      clinic.Providers.forEach(p => {
        textLines.push(`   - ${p.ProviderName}`);
      });
      textLines.push('');
    });
    
    const textPath = path.join(__dirname, 'clinics-without-provider-photos.txt');
    await fs.writeFile(textPath, textLines.join('\n'));
    console.log(`📄 Text report saved to: ${textPath}`);
    
    console.log('\n✅ Analysis complete!');
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Review the reports in /scripts`);
    console.log(`   2. Scrape photos for these ${clinicsWithoutPhotos.length} clinics`);
    console.log(`   3. Run importProviderPhotos.js again to import new photos`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run the analysis
if (require.main === module) {
  findClinicsWithoutProviderPhotos()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { findClinicsWithoutProviderPhotos };

