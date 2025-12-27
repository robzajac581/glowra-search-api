/**
 * Generate Admin Password Hash
 * 
 * Usage: node scripts/generateAdminPassword.js
 * 
 * This script generates a bcrypt hash for the admin password.
 * Update the migration file with the generated hash before running.
 */

const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

// The generated secure password for superadmin@glowra.com
// IMPORTANT: Keep this secure and change in production!
const ADMIN_PASSWORD = 'GlowraAdmin2024!Secure';

async function generateHash() {
  console.log('Generating bcrypt hash for admin password...\n');
  
  const hash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  
  console.log('Password:', ADMIN_PASSWORD);
  console.log('Bcrypt Hash:', hash);
  console.log('\n--- Copy the hash above into the migration file ---\n');
  console.log('File: migrations/addAdminUsers.sql');
  console.log('Replace the placeholder hash with the generated hash.\n');
  
  // Verify the hash works
  const isValid = await bcrypt.compare(ADMIN_PASSWORD, hash);
  console.log('Verification:', isValid ? '✓ Hash is valid' : '✗ Hash verification failed');
  
  return hash;
}

generateHash().catch(console.error);

