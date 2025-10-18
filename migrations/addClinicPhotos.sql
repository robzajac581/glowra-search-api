-- Migration: Add Clinic Photos Table
-- Purpose: Store Google Places photo references for each clinic
-- Author: System
-- Date: October 17, 2025

-- Create ClinicPhotos table
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'ClinicPhotos'
)
BEGIN
  CREATE TABLE ClinicPhotos (
    PhotoID INT PRIMARY KEY IDENTITY(1,1),
    ClinicID INT NOT NULL,
    PhotoReference NVARCHAR(1000) NOT NULL,  -- Google photo reference
    PhotoURL NVARCHAR(2000) NOT NULL,        -- Pre-constructed URL for fast serving
    Width INT,                               -- Original photo width
    Height INT,                              -- Original photo height
    AttributionText NVARCHAR(500),           -- Photographer/source attribution (required by Google)
    AttributionURL NVARCHAR(1000),           -- Attribution link
    IsPrimary BIT DEFAULT 0,                 -- True for the featured/main photo
    DisplayOrder INT DEFAULT 0,              -- Order for displaying photos (0 = first)
    LastUpdated DATETIME DEFAULT GETDATE(),
    
    FOREIGN KEY (ClinicID) REFERENCES Clinics(ClinicID) ON DELETE CASCADE,
    INDEX IX_ClinicPhotos_ClinicID (ClinicID),
    INDEX IX_ClinicPhotos_IsPrimary (IsPrimary),
    INDEX IX_ClinicPhotos_DisplayOrder (DisplayOrder)
  );
  
  PRINT 'ClinicPhotos table created successfully';
END
ELSE
BEGIN
  PRINT 'ClinicPhotos table already exists';
END
GO

-- Optional: Add a computed column for optimized thumbnail URL (400px wide)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicPhotos' AND COLUMN_NAME = 'ThumbnailURL'
)
BEGIN
  ALTER TABLE ClinicPhotos ADD ThumbnailURL AS (
    CASE 
      WHEN PhotoURL LIKE '%maxwidth=%' 
      THEN REPLACE(PhotoURL, 'maxwidth=1600', 'maxwidth=400')
      ELSE PhotoURL + '&maxwidth=400'
    END
  );
  
  PRINT 'ThumbnailURL computed column added';
END
GO

PRINT 'Migration completed successfully';
PRINT 'Next steps:';
PRINT '1. Run the photo refresh script to populate photos for all clinics';
PRINT '2. Use GET /api/clinics/:id/photos to retrieve photos in your frontend';
PRINT '3. Photos will be automatically refreshed daily with the existing cron job';
GO

