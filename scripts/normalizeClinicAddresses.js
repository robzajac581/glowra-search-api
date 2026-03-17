#!/usr/bin/env node
/**
 * Data migration: Normalize clinic addresses
 *
 * For clinics where Address contains a full address (e.g., "6545 N Wickham Rd Suite C-101, Melbourne, FL 32940"):
 * - Parse the address into street, city, state, postalCode
 * - Update Clinics: set Address to street only, populate City, State, PostalCode
 * - Update GooglePlacesData: set Street when empty
 *
 * Prerequisites:
 * - Run migrations/addClinicAddressColumns.sql first to add City, State, PostalCode to Clinics
 *
 * Usage: node scripts/normalizeClinicAddresses.js [--dry-run]
 */

const { db, sql } = require('../db');
const { isFullAddress, parseFullAddress } = require('../utils/addressUtils');

async function normalizeClinicAddresses() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('DRY RUN - No changes will be made\n');
  }

  let pool;
  try {
    pool = await db.getConnection();
    if (!pool) throw new Error('Could not connect to database');

    // Fetch all clinics with their Address and GooglePlacesData
    const result = await pool.request().query(`
      SELECT 
        c.ClinicID,
        c.ClinicName,
        c.Address,
        c.City,
        c.State,
        c.PostalCode,
        g.GoogleDataID,
        g.Street as GpStreet
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      WHERE c.Address IS NOT NULL AND LEN(TRIM(c.Address)) > 0
    `);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    console.log(`Found ${result.recordset.length} clinics with addresses\n`);
    console.log('='.repeat(80));

    for (const row of result.recordset) {
      const { ClinicID, ClinicName, Address, City, State, PostalCode, GoogleDataID, GpStreet } = row;

      if (!isFullAddress(Address)) {
        skipped++;
        continue;
      }

      const parsed = parseFullAddress(Address);
      if (!parsed) {
        console.log(`⚠️  SKIP (parse failed): Clinic ${ClinicID} - ${ClinicName}`);
        console.log(`   Address: ${Address}\n`);
        failed++;
        continue;
      }

      console.log(`✓ Clinic ${ClinicID}: ${ClinicName}`);
      console.log(`  Before: ${Address}`);
      console.log(`  After:  Street="${parsed.street}" City="${parsed.city}" State="${parsed.state}" Zip="${parsed.postalCode}"`);

      if (!dryRun) {
        try {
          await pool.request()
            .input('clinicId', sql.Int, ClinicID)
            .input('street', sql.NVarChar, parsed.street)
            .input('city', sql.NVarChar, parsed.city || null)
            .input('state', sql.NVarChar, parsed.state || null)
            .input('postalCode', sql.NVarChar, parsed.postalCode || null)
            .query(`
              UPDATE Clinics
              SET Address = @street,
                  City = @city,
                  State = @state,
                  PostalCode = @postalCode
              WHERE ClinicID = @clinicId
            `);

          // Update GooglePlacesData.Street if empty and we have parsed street
          if (GoogleDataID && !GpStreet && parsed.street) {
            await pool.request()
              .input('clinicId', sql.Int, ClinicID)
              .input('street', sql.NVarChar, parsed.street)
              .query(`
                UPDATE GooglePlacesData
                SET Street = @street
                WHERE ClinicID = @clinicId
              `);
          }

          updated++;
        } catch (err) {
          console.error(`  ERROR: ${err.message}`);
          failed++;
        }
      } else {
        updated++;
      }
      console.log('');
    }

    console.log('='.repeat(80));
    console.log(`\nSummary:`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped (not full address): ${skipped}`);
    console.log(`  Failed: ${failed}`);
    if (dryRun) {
      console.log(`\nRun without --dry-run to apply changes.`);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    if (pool) {
      try {
        await pool.close?.();
      } catch (_) {}
    }
  }
}

normalizeClinicAddresses();
