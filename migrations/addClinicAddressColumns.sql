-- Migration: Add City, State, PostalCode to Clinics table
-- Purpose: Store address components separately to prevent duplication in API responses
--          Address field will contain only street; city/state/zip in their own columns
-- Date: March 2025
--
-- After running this migration, run the data normalization script to parse existing
-- full addresses and populate the new columns:
--   node scripts/normalizeClinicAddresses.js --dry-run   (preview)
--   node scripts/normalizeClinicAddresses.js             (apply)

-- Add City column if it doesn't exist
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'Clinics' AND COLUMN_NAME = 'City'
)
BEGIN
  ALTER TABLE Clinics ADD City NVARCHAR(100) NULL;
  PRINT 'Added City column to Clinics table';
END
ELSE
BEGIN
  PRINT 'City column already exists in Clinics table';
END
GO

-- Add State column if it doesn't exist
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'Clinics' AND COLUMN_NAME = 'State'
)
BEGIN
  ALTER TABLE Clinics ADD State NVARCHAR(100) NULL;
  PRINT 'Added State column to Clinics table';
END
ELSE
BEGIN
  PRINT 'State column already exists in Clinics table';
END
GO

-- Add PostalCode column if it doesn't exist
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'Clinics' AND COLUMN_NAME = 'PostalCode'
)
BEGIN
  ALTER TABLE Clinics ADD PostalCode NVARCHAR(20) NULL;
  PRINT 'Added PostalCode column to Clinics table';
END
ELSE
BEGIN
  PRINT 'PostalCode column already exists in Clinics table';
END
GO

PRINT 'Migration addClinicAddressColumns completed successfully';
GO
