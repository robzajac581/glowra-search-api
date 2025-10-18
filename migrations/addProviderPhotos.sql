-- Migration: Add Provider Photos Support
-- Purpose: Add PhotoURL column to Providers table for storing provider images
-- Author: System
-- Date: October 18, 2025

-- Add PhotoURL column to Providers table
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'Providers' AND COLUMN_NAME = 'PhotoURL'
)
BEGIN
  ALTER TABLE Providers ADD PhotoURL NVARCHAR(500) NULL;
  PRINT 'PhotoURL column added to Providers table';
END
ELSE
BEGIN
  PRINT 'PhotoURL column already exists in Providers table';
END
GO

-- Add index for faster queries when filtering by providers with photos
IF NOT EXISTS (
  SELECT * FROM sys.indexes 
  WHERE name = 'IX_Providers_PhotoURL' 
  AND object_id = OBJECT_ID('Providers')
)
BEGIN
  CREATE INDEX IX_Providers_PhotoURL ON Providers(PhotoURL) 
  WHERE PhotoURL IS NOT NULL;
  PRINT 'Index IX_Providers_PhotoURL created';
END
GO

PRINT 'Migration completed successfully';
PRINT 'Next steps:';
PRINT '1. Run the provider photo matching script to populate PhotoURLs';
PRINT '2. Photos will be served via /api/providers/photos/:filename';
PRINT '3. Frontend can display photos using the PhotoURL field';
GO

