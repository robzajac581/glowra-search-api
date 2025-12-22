-- Migration: Add Draft Photos and Advanced Fields
-- Purpose: Support photo uploads and advanced information in the List Your Clinic wizard
-- Date: December 2024

-- =====================================================
-- Part 1: Create DraftPhotos table for clinic photos
-- =====================================================

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'DraftPhotos'
)
BEGIN
  CREATE TABLE DraftPhotos (
    DraftPhotoID INT PRIMARY KEY IDENTITY(1,1),
    DraftID INT NOT NULL,
    PhotoType NVARCHAR(50) NOT NULL,         -- 'clinic', 'icon'
    PhotoData NVARCHAR(MAX) NULL,            -- Base64 encoded image data (for upload)
    PhotoURL NVARCHAR(2000) NULL,            -- URL if externally hosted
    FileName NVARCHAR(255) NULL,             -- Original filename
    MimeType NVARCHAR(100) NULL,             -- e.g., 'image/jpeg', 'image/png'
    FileSize INT NULL,                       -- Size in bytes
    IsPrimary BIT DEFAULT 0,                 -- True for the primary/featured photo
    DisplayOrder INT DEFAULT 0,              -- Order for displaying (0 = first)
    Caption NVARCHAR(500) NULL,              -- Optional caption/alt text
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    
    FOREIGN KEY (DraftID) REFERENCES ClinicDrafts(DraftID) ON DELETE CASCADE
  );
  
  CREATE INDEX IX_DraftPhotos_DraftID ON DraftPhotos(DraftID);
  CREATE INDEX IX_DraftPhotos_PhotoType ON DraftPhotos(PhotoType);
  CREATE INDEX IX_DraftPhotos_IsPrimary ON DraftPhotos(IsPrimary);
  
  PRINT 'Created DraftPhotos table with indexes';
END
ELSE
BEGIN
  PRINT 'DraftPhotos table already exists';
END
GO

-- =====================================================
-- Part 2: Add PhotoURL to DraftProviders
-- =====================================================

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProviders' AND COLUMN_NAME = 'PhotoURL'
)
BEGIN
  ALTER TABLE DraftProviders ADD PhotoURL NVARCHAR(2000) NULL;
  PRINT 'Added PhotoURL column to DraftProviders';
END
ELSE
BEGIN
  PRINT 'PhotoURL column already exists in DraftProviders';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'DraftProviders' AND COLUMN_NAME = 'PhotoData'
)
BEGIN
  ALTER TABLE DraftProviders ADD PhotoData NVARCHAR(MAX) NULL;
  PRINT 'Added PhotoData column to DraftProviders';
END
ELSE
BEGIN
  PRINT 'PhotoData column already exists in DraftProviders';
END
GO

-- =====================================================
-- Part 3: Add Advanced Fields to ClinicDrafts
-- =====================================================

-- Social Media Links
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'Facebook'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD Facebook NVARCHAR(500) NULL;
  PRINT 'Added Facebook column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'Instagram'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD Instagram NVARCHAR(500) NULL;
  PRINT 'Added Instagram column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'LinkedIn'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD LinkedIn NVARCHAR(500) NULL;
  PRINT 'Added LinkedIn column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'Twitter'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD Twitter NVARCHAR(500) NULL;
  PRINT 'Added Twitter column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'YouTube'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD YouTube NVARCHAR(500) NULL;
  PRINT 'Added YouTube column to ClinicDrafts';
END
GO

-- Operational Details
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'Description'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD Description NVARCHAR(MAX) NULL;
  PRINT 'Added Description column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'WorkingHours'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD WorkingHours NVARCHAR(MAX) NULL; -- JSON
  PRINT 'Added WorkingHours column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'BookingURL'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD BookingURL NVARCHAR(1000) NULL;
  PRINT 'Added BookingURL column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'GoogleProfileLink'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD GoogleProfileLink NVARCHAR(1000) NULL;
  PRINT 'Added GoogleProfileLink column to ClinicDrafts';
END
GO

PRINT 'Migration completed successfully';
GO

