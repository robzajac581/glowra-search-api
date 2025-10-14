-- Add missing Phone column to Clinics (if it doesn't exist)
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'Clinics' AND COLUMN_NAME = 'Phone'
)
BEGIN
  ALTER TABLE Clinics ADD Phone NVARCHAR(50) NULL;
  PRINT 'Added Phone column to Clinics table';
END
ELSE
BEGIN
  PRINT 'Phone column already exists in Clinics table';
END
GO

-- Create GooglePlacesData table for rich Google data
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'GooglePlacesData'
)
BEGIN
  CREATE TABLE GooglePlacesData (
    GoogleDataID INT PRIMARY KEY IDENTITY(1,1),
    ClinicID INT NOT NULL,
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
    WorkingHours NVARCHAR(MAX), -- Store as JSON
    BusinessStatus NVARCHAR(50),
    Verified BIT,
    
    -- Visual assets
    Photo NVARCHAR(1000),
    Logo NVARCHAR(1000),
    StreetView NVARCHAR(1000),
    
    -- Rich content
    Description NVARCHAR(MAX),
    AboutJSON NVARCHAR(MAX), -- Store JSON
    Subtypes NVARCHAR(500),
    Category NVARCHAR(200),
    
    -- Links
    GoogleProfileLink NVARCHAR(1000),
    ReviewsLink NVARCHAR(1000),
    BookingAppointmentLink NVARCHAR(1000),
    MenuLink NVARCHAR(1000),
    
    -- Metadata
    LastUpdated DATETIME DEFAULT GETDATE(),
    
    FOREIGN KEY (ClinicID) REFERENCES Clinics(ClinicID)
  );
  
  -- Create indexes
  CREATE INDEX IX_GooglePlacesData_PlaceID ON GooglePlacesData(PlaceID);
  CREATE INDEX IX_GooglePlacesData_ClinicID ON GooglePlacesData(ClinicID);
  
  PRINT 'Created GooglePlacesData table with indexes';
END
ELSE
BEGIN
  PRINT 'GooglePlacesData table already exists';
END
GO

