-- Migration: Update Clinic Submissions for List Your Clinic Portal
-- Purpose: Add price ranges, units, and submitter tracking for the new wizard flow
-- Date: December 2024

-- =====================================================
-- Part 1: Update DraftProcedures for price ranges
-- =====================================================

-- Add PriceMin column
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProcedures' AND COLUMN_NAME = 'PriceMin'
)
BEGIN
  ALTER TABLE DraftProcedures ADD PriceMin DECIMAL(10,2) NULL;
  PRINT 'Added PriceMin column to DraftProcedures';
END
ELSE
BEGIN
  PRINT 'PriceMin column already exists in DraftProcedures';
END
GO

-- Add PriceMax column
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProcedures' AND COLUMN_NAME = 'PriceMax'
)
BEGIN
  ALTER TABLE DraftProcedures ADD PriceMax DECIMAL(10,2) NULL;
  PRINT 'Added PriceMax column to DraftProcedures';
END
ELSE
BEGIN
  PRINT 'PriceMax column already exists in DraftProcedures';
END
GO

-- Add PriceUnit column
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProcedures' AND COLUMN_NAME = 'PriceUnit'
)
BEGIN
  ALTER TABLE DraftProcedures ADD PriceUnit NVARCHAR(50) NULL;
  PRINT 'Added PriceUnit column to DraftProcedures';
END
ELSE
BEGIN
  PRINT 'PriceUnit column already exists in DraftProcedures';
END
GO

-- Add ProviderNames column (JSON array of provider names linked to this procedure)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProcedures' AND COLUMN_NAME = 'ProviderNames'
)
BEGIN
  ALTER TABLE DraftProcedures ADD ProviderNames NVARCHAR(MAX) NULL;
  PRINT 'Added ProviderNames column to DraftProcedures';
END
ELSE
BEGIN
  PRINT 'ProviderNames column already exists in DraftProcedures';
END
GO

-- =====================================================
-- Part 2: Update ClinicDrafts for submission tracking
-- =====================================================

-- Add SubmitterKey column (optional key for tracking who submitted)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'SubmitterKey'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD SubmitterKey NVARCHAR(100) NULL;
  PRINT 'Added SubmitterKey column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'SubmitterKey column already exists in ClinicDrafts';
END
GO

-- Add SubmissionFlow column ('new_clinic' or 'add_to_existing')
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'SubmissionFlow'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD SubmissionFlow NVARCHAR(50) NULL;
  PRINT 'Added SubmissionFlow column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'SubmissionFlow column already exists in ClinicDrafts';
END
GO

-- Add SubmissionId column (human-readable ID like GLW-2024-0042)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'SubmissionId'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD SubmissionId NVARCHAR(50) NULL;
  PRINT 'Added SubmissionId column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'SubmissionId column already exists in ClinicDrafts';
END
GO

-- Add ZipCode column (was missing from original draft table)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'ZipCode'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD ZipCode NVARCHAR(20) NULL;
  PRINT 'Added ZipCode column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'ZipCode column already exists in ClinicDrafts';
END
GO

-- Create index on SubmitterKey for filtering
IF NOT EXISTS (
  SELECT * FROM sys.indexes 
  WHERE name = 'IX_ClinicDrafts_SubmitterKey' AND object_id = OBJECT_ID('ClinicDrafts')
)
BEGIN
  CREATE INDEX IX_ClinicDrafts_SubmitterKey ON ClinicDrafts(SubmitterKey);
  PRINT 'Created index IX_ClinicDrafts_SubmitterKey';
END
ELSE
BEGIN
  PRINT 'Index IX_ClinicDrafts_SubmitterKey already exists';
END
GO

-- Create index on SubmissionId for lookups
IF NOT EXISTS (
  SELECT * FROM sys.indexes 
  WHERE name = 'IX_ClinicDrafts_SubmissionId' AND object_id = OBJECT_ID('ClinicDrafts')
)
BEGIN
  CREATE INDEX IX_ClinicDrafts_SubmissionId ON ClinicDrafts(SubmissionId);
  PRINT 'Created index IX_ClinicDrafts_SubmissionId';
END
ELSE
BEGIN
  PRINT 'Index IX_ClinicDrafts_SubmissionId already exists';
END
GO

-- =====================================================
-- Part 3: Add Advanced Information Fields
-- =====================================================

-- Add Latitude column
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'Latitude'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD Latitude DECIMAL(10,7) NULL;
  PRINT 'Added Latitude column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'Latitude column already exists in ClinicDrafts';
END
GO

-- Add Longitude column
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'Longitude'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD Longitude DECIMAL(11,7) NULL;
  PRINT 'Added Longitude column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'Longitude column already exists in ClinicDrafts';
END
GO

-- Add PlaceID column (Google Places ID)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'PlaceID'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD PlaceID NVARCHAR(500) NULL;
  PRINT 'Added PlaceID column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'PlaceID column already exists in ClinicDrafts';
END
GO

-- =====================================================
-- Part 4: Add Photo Fields
-- =====================================================

-- Add IconPhotoURL column (clinic logo/icon)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'IconPhotoURL'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD IconPhotoURL NVARCHAR(1000) NULL;
  PRINT 'Added IconPhotoURL column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'IconPhotoURL column already exists in ClinicDrafts';
END
GO

-- Add PrimaryPhotoURL column (main clinic photo for search cards)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'PrimaryPhotoURL'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD PrimaryPhotoURL NVARCHAR(1000) NULL;
  PRINT 'Added PrimaryPhotoURL column to ClinicDrafts';
END
ELSE
BEGIN
  PRINT 'PrimaryPhotoURL column already exists in ClinicDrafts';
END
GO

-- =====================================================
-- Part 5: Create DraftPhotos Table
-- =====================================================

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'DraftPhotos') AND type in (N'U'))
BEGIN
  CREATE TABLE DraftPhotos (
    DraftPhotoID INT PRIMARY KEY IDENTITY(1,1),
    DraftID INT NOT NULL,
    PhotoURL NVARCHAR(2000) NOT NULL,
    IsPrimary BIT DEFAULT 0,
    PhotoType NVARCHAR(50) NOT NULL, -- 'clinic', 'provider', 'icon'
    ProviderName NVARCHAR(255) NULL, -- If PhotoType is 'provider', links to provider
    Caption NVARCHAR(500) NULL,
    DisplayOrder INT DEFAULT 0,
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_DraftPhotos_ClinicDrafts FOREIGN KEY (DraftID) 
      REFERENCES ClinicDrafts(DraftID) ON DELETE CASCADE
  );
  PRINT 'Created DraftPhotos table';
END
ELSE
BEGIN
  PRINT 'DraftPhotos table already exists';
END
GO

-- Create index on DraftID for faster lookups
IF NOT EXISTS (
  SELECT * FROM sys.indexes 
  WHERE name = 'IX_DraftPhotos_DraftID' AND object_id = OBJECT_ID('DraftPhotos')
)
BEGIN
  CREATE INDEX IX_DraftPhotos_DraftID ON DraftPhotos(DraftID);
  PRINT 'Created index IX_DraftPhotos_DraftID';
END
ELSE
BEGIN
  PRINT 'Index IX_DraftPhotos_DraftID already exists';
END
GO

-- Add missing columns to DraftPhotos if table already exists
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftPhotos' AND COLUMN_NAME = 'PhotoData'
)
BEGIN
  ALTER TABLE DraftPhotos ADD PhotoData NVARCHAR(MAX) NULL;
  PRINT 'Added PhotoData column to DraftPhotos';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftPhotos' AND COLUMN_NAME = 'FileName'
)
BEGIN
  ALTER TABLE DraftPhotos ADD FileName NVARCHAR(255) NULL;
  PRINT 'Added FileName column to DraftPhotos';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftPhotos' AND COLUMN_NAME = 'MimeType'
)
BEGIN
  ALTER TABLE DraftPhotos ADD MimeType NVARCHAR(100) NULL;
  PRINT 'Added MimeType column to DraftPhotos';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftPhotos' AND COLUMN_NAME = 'FileSize'
)
BEGIN
  ALTER TABLE DraftPhotos ADD FileSize INT NULL;
  PRINT 'Added FileSize column to DraftPhotos';
END
GO

-- Make PhotoURL nullable (it was NOT NULL but we allow PhotoData instead)
-- Note: This is safe to run multiple times
BEGIN TRY
  ALTER TABLE DraftPhotos ALTER COLUMN PhotoURL NVARCHAR(2000) NULL;
  PRINT 'Made PhotoURL column nullable in DraftPhotos';
END TRY
BEGIN CATCH
  PRINT 'PhotoURL column already nullable or does not exist';
END CATCH
GO

-- =====================================================
-- Part 6: Add PhotoURL to DraftProviders
-- =====================================================

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProviders' AND COLUMN_NAME = 'PhotoURL'
)
BEGIN
  ALTER TABLE DraftProviders ADD PhotoURL NVARCHAR(1000) NULL;
  PRINT 'Added PhotoURL column to DraftProviders';
END
ELSE
BEGIN
  PRINT 'PhotoURL column already exists in DraftProviders';
END
GO

PRINT 'Migration completed successfully';
GO

