-- Migration: Add Source column to DraftPhotos and FileName/MimeType to DraftProviders
-- Purpose: Track the source of photos (user upload vs google) and preserve provider photo metadata
-- Date: December 2024

-- =====================================================
-- Part 1: Add Source column to DraftPhotos
-- =====================================================
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftPhotos' AND COLUMN_NAME = 'Source'
)
BEGIN
  ALTER TABLE DraftPhotos ADD Source NVARCHAR(50) NULL DEFAULT 'user';
  PRINT 'Added Source column to DraftPhotos';
END
ELSE
BEGIN
  PRINT 'Source column already exists in DraftPhotos';
END
GO

-- =====================================================
-- Part 2: Add FileName column to DraftProviders
-- =====================================================
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProviders' AND COLUMN_NAME = 'FileName'
)
BEGIN
  ALTER TABLE DraftProviders ADD FileName NVARCHAR(255) NULL;
  PRINT 'Added FileName column to DraftProviders';
END
ELSE
BEGIN
  PRINT 'FileName column already exists in DraftProviders';
END
GO

-- =====================================================
-- Part 3: Add MimeType column to DraftProviders
-- =====================================================
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProviders' AND COLUMN_NAME = 'MimeType'
)
BEGIN
  ALTER TABLE DraftProviders ADD MimeType NVARCHAR(100) NULL;
  PRINT 'Added MimeType column to DraftProviders';
END
ELSE
BEGIN
  PRINT 'MimeType column already exists in DraftProviders';
END
GO

-- To run this migration:
-- 1. Connect to your database
-- 2. Execute this script
-- OR use: node scripts/runMigration.js migrations/addSourceToDraftPhotos.sql

PRINT 'Migration completed successfully';
GO

