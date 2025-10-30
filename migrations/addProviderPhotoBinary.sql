-- Migration: Add Provider Photo Binary Storage
-- Purpose: Store provider photos as binary data in database for production deployment
-- Author: System
-- Date: October 30, 2025

-- Add PhotoData column to store binary photo data
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'Providers' AND COLUMN_NAME = 'PhotoData'
)
BEGIN
  ALTER TABLE Providers ADD PhotoData VARBINARY(MAX) NULL;
  PRINT 'PhotoData column added to Providers table';
END
ELSE
BEGIN
  PRINT 'PhotoData column already exists in Providers table';
END
GO

-- Add PhotoContentType column to store MIME type
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'Providers' AND COLUMN_NAME = 'PhotoContentType'
)
BEGIN
  ALTER TABLE Providers ADD PhotoContentType NVARCHAR(50) NULL;
  PRINT 'PhotoContentType column added to Providers table';
END
ELSE
BEGIN
  PRINT 'PhotoContentType column already exists in Providers table';
END
GO

-- Note: Cannot create index on VARBINARY(MAX) column
-- Queries will still be fast as they use ProviderID (primary key)
PRINT 'PhotoData column is VARBINARY(MAX) - no index needed (queries use ProviderID)';
GO

PRINT 'Migration completed successfully';
PRINT 'Next steps:';
PRINT '1. Run the photo import script to store photos in database';
PRINT '2. Photos will be served via /api/provider-photos/:providerId endpoint';
PRINT '3. PhotoURL field will be deprecated but kept for backward compatibility';
GO

