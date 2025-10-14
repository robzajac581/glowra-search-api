-- Update Clinics with frequently-queried essentials
ALTER TABLE Clinics ADD
  PlaceID NVARCHAR(255) NULL,
  GoogleRating DECIMAL(2,1) NULL,
  GoogleReviewCount INT NULL,
  Latitude DECIMAL(10,7) NULL,
  Longitude DECIMAL(11,7) NULL,
  Phone NVARCHAR(50) NULL,
  LastRatingUpdate DATETIME NULL;

-- Store rich Google data separately
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
  
  FOREIGN KEY (ClinicID) REFERENCES Clinics(ClinicID),
  INDEX IX_GooglePlacesData_PlaceID (PlaceID),
  INDEX IX_GooglePlacesData_ClinicID (ClinicID)
);