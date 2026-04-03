#!/usr/bin/env node
/**
 * Bulk import from an .xlsx path — same logic as POST /api/clinic-management/bulk-import.
 *
 * Usage:
 *   node scripts/bulkImportFromFile.js <path-to.xlsx> [submittedBy]
 *   node scripts/bulkImportFromFile.js --validate <path-to.xlsx>
 *
 * --validate checks Excel only (no database). Full import needs DB_* in .env and
 * your IP allowed on the SQL server firewall (Azure: add your client IP).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const { db } = require('../db');
const bulkImportService = require('../clinic-management/services/bulkImportService');

async function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes('--validate');
  const positional = args.filter((a) => a !== '--validate');
  const filePath = positional[0];
  const submittedBy = positional[1] || 'bulkImportFromFile';

  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Usage: node scripts/bulkImportFromFile.js [--validate] <path-to.xlsx> [submittedBy]');
    process.exit(1);
  }

  const buf = fs.readFileSync(filePath);
  console.log(`File: ${filePath} (${buf.length} bytes)\n`);

  if (validateOnly) {
    const result = await bulkImportService.validateFile(buf);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.isValid ? 0 : 1);
  }

  console.log('Checking database connection...');
  await db.getConnection();
  console.log('OK\n');

  const result = await bulkImportService.processBulkImport(buf, submittedBy);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
