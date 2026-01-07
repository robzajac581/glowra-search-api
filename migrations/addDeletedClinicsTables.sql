-- Migration: Add Deleted Clinics Tables
-- Purpose: Support soft deletion of clinics with restoration capability and automatic cleanup after 30 days
-- Date: January 2025

-- =====================================================
-- Part 1: Create DeletedClinics table
-- =====================================================

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'DeletedClinics'
)
BEGIN
  CREATE TABLE DeletedClinics (
    DeletedClinicID INT PRIMARY KEY IDENTITY(1,1),
    OriginalClinicID INT NOT NULL, -- Preserve original ID for restoration
    ClinicName NVARCHAR(255) NOT NULL,
    Address NVARCHAR(500) NOT NULL,
    Latitude DECIMAL(10,7) NULL,
    Longitude DECIMAL(11,7) NULL,
    PlaceID NVARCHAR(500) NULL,
    GoogleRating DECIMAL(2,1) NULL,
    GoogleReviewCount INT NULL,
    Phone NVARCHAR(50) NULL,
    Website NVARCHAR(500) NULL,
    LocationID INT NULL,
    Providers NVARCHAR(1000) NULL,
    GoogleReviewsJSON NVARCHAR(MAX) NULL,
    LastRatingUpdate DATETIME NULL,
    -- Deletion metadata
    DeletedAt DATETIME NOT NULL DEFAULT GETDATE(),
    DeletedBy NVARCHAR(255) NULL -- Admin email who deleted
  );
  
  -- Create indexes
  CREATE INDEX IX_DeletedClinics_OriginalClinicID ON DeletedClinics(OriginalClinicID);
  CREATE INDEX IX_DeletedClinics_DeletedAt ON DeletedClinics(DeletedAt);
  CREATE INDEX IX_DeletedClinics_DeletedBy ON DeletedClinics(DeletedBy);
  
  PRINT 'Created DeletedClinics table with indexes';
END
ELSE
BEGIN
  PRINT 'DeletedClinics table already exists';
END
GO

-- =====================================================
-- Part 2: Create DeletedGooglePlacesData table
-- =====================================================

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'DeletedGooglePlacesData'
)
BEGIN
  CREATE TABLE DeletedGooglePlacesData (
    DeletedGoogleDataID INT PRIMARY KEY IDENTITY(1,1),
    DeletedClinicID INT NOT NULL, -- References DeletedClinics
    OriginalClinicID INT NOT NULL, -- Preserve original ClinicID
    PlaceID NVARCHAR(255) NOT NULL,
    GoogleID NVARCHAR(255),
    CID BIGINT,
    BusinessName NVARCHAR(500),
    
    -- Location details
    FullAddress NVARCHAR(500),
    Street NVARCHAR(500),
    City NVARCHAR(100),
    PostalCode NVARCHAR(20),
    State NVARCHAR(100),
    Country NVARCHAR(100),
    
    -- Contact & Web
    Website NVARCHAR(500),
    Email NVARCHAR(255),
    Facebook NVARCHAR(500),
    Instagram NVARCHAR(500),
    LinkedIn NVARCHAR(500),
    Twitter NVARCHAR(500),
    YouTube NVARCHAR(500),
    
    -- Operational
    WorkingHours NVARCHAR(MAX),
    BusinessStatus NVARCHAR(50),
    Verified BIT,
    
    -- Visual assets
    Photo NVARCHAR(1000),
    Logo NVARCHAR(1000),
    StreetView NVARCHAR(1000),
    
    -- Rich content
    Description NVARCHAR(MAX),
    AboutJSON NVARCHAR(MAX),
    Subtypes NVARCHAR(500),
    Category NVARCHAR(200),
    
    -- Links
    GoogleProfileLink NVARCHAR(1000),
    ReviewsLink NVARCHAR(1000),
    BookingAppointmentLink NVARCHAR(1000),
    MenuLink NVARCHAR(1000),
    
    -- Metadata
    LastUpdated DATETIME,
    
    FOREIGN KEY (DeletedClinicID) REFERENCES DeletedClinics(DeletedClinicID) ON DELETE CASCADE
  );
  
  -- Create indexes
  CREATE INDEX IX_DeletedGooglePlacesData_DeletedClinicID ON DeletedGooglePlacesData(DeletedClinicID);
  CREATE INDEX IX_DeletedGooglePlacesData_OriginalClinicID ON DeletedGooglePlacesData(OriginalClinicID);
  CREATE INDEX IX_DeletedGooglePlacesData_PlaceID ON DeletedGooglePlacesData(PlaceID);
  
  PRINT 'Created DeletedGooglePlacesData table with indexes';
END
ELSE
BEGIN
  PRINT 'DeletedGooglePlacesData table already exists';
END
GO

-- =====================================================
-- Part 3: Create DeletedClinicPhotos table
-- =====================================================

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'DeletedClinicPhotos'
)
BEGIN
  CREATE TABLE DeletedClinicPhotos (
    DeletedPhotoID INT PRIMARY KEY IDENTITY(1,1),
    DeletedClinicID INT NOT NULL, -- References DeletedClinics
    OriginalClinicID INT NOT NULL, -- Preserve original ClinicID
    PhotoReference NVARCHAR(1000) NOT NULL,
    PhotoURL NVARCHAR(2000) NOT NULL,
    Width INT,
    Height INT,
    AttributionText NVARCHAR(500),
    AttributionURL NVARCHAR(1000),
    IsPrimary BIT DEFAULT 0,
    DisplayOrder INT DEFAULT 0,
    LastUpdated DATETIME,
    
    FOREIGN KEY (DeletedClinicID) REFERENCES DeletedClinics(DeletedClinicID) ON DELETE CASCADE
  );
  
  -- Create indexes
  CREATE INDEX IX_DeletedClinicPhotos_DeletedClinicID ON DeletedClinicPhotos(DeletedClinicID);
  CREATE INDEX IX_DeletedClinicPhotos_OriginalClinicID ON DeletedClinicPhotos(OriginalClinicID);
  
  PRINT 'Created DeletedClinicPhotos table with indexes';
END
ELSE
BEGIN
  PRINT 'DeletedClinicPhotos table already exists';
END
GO

PRINT 'Migration completed successfully';
PRINT 'Next steps:';
PRINT '1. Deleted clinics will be automatically cleaned up after 30 days';
PRINT '2. Use DELETE /admin/clinics/:clinicId to delete a clinic';
PRINT '3. Use POST /admin/clinics/deleted/:id/restore to restore a clinic';
PRINT '4. Use GET /admin/clinics/deleted to list deleted clinics';
GO

