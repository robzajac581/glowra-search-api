-- Migration: Add Clinic Management Tables
-- Purpose: Support draft/approval workflow for clinic submissions
-- Date: January 2025

-- Create ClinicDrafts table
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'ClinicDrafts'
)
BEGIN
  CREATE TABLE ClinicDrafts (
    DraftID INT PRIMARY KEY IDENTITY(1,1),
    RequestID UNIQUEIDENTIFIER NULL, -- Links to ClinicListingRequests if from form
    ClinicName NVARCHAR(255) NOT NULL,
    Address NVARCHAR(500) NOT NULL,
    City NVARCHAR(100) NOT NULL,
    State NVARCHAR(100) NOT NULL,
    Website NVARCHAR(500) NULL, -- Required for approval
    Phone NVARCHAR(50) NULL, -- Required for approval
    Email NVARCHAR(255) NULL, -- Required for approval
    Latitude DECIMAL(10,7) NULL,
    Longitude DECIMAL(11,7) NULL,
    PlaceID NVARCHAR(500) NULL, -- Required for approval
    Category NVARCHAR(200) NULL, -- Required for approval
    Status NVARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'pending_review', 'approved', 'rejected', 'merged'
    Source NVARCHAR(50) NOT NULL, -- 'form', 'bulk_import', 'manual'
    SubmittedBy NVARCHAR(255) NULL, -- User/teammate identifier
    SubmittedAt DATETIME NOT NULL DEFAULT GETDATE(),
    ReviewedBy NVARCHAR(255) NULL,
    ReviewedAt DATETIME NULL,
    Notes NVARCHAR(MAX) NULL,
    DuplicateClinicID INT NULL, -- If merged with existing clinic
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    
    FOREIGN KEY (DuplicateClinicID) REFERENCES Clinics(ClinicID)
  );
  
  -- Create indexes
  CREATE INDEX IX_ClinicDrafts_Status ON ClinicDrafts(Status);
  CREATE INDEX IX_ClinicDrafts_Source ON ClinicDrafts(Source);
  CREATE INDEX IX_ClinicDrafts_RequestID ON ClinicDrafts(RequestID);
  CREATE INDEX IX_ClinicDrafts_DuplicateClinicID ON ClinicDrafts(DuplicateClinicID);
  
  PRINT 'Created ClinicDrafts table with indexes';
END
ELSE
BEGIN
  PRINT 'ClinicDrafts table already exists';
END
GO

-- Create DraftProviders table
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'DraftProviders'
)
BEGIN
  CREATE TABLE DraftProviders (
    DraftProviderID INT PRIMARY KEY IDENTITY(1,1),
    DraftID INT NOT NULL,
    ProviderName NVARCHAR(255) NOT NULL,
    Specialty NVARCHAR(255) NULL,
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    
    FOREIGN KEY (DraftID) REFERENCES ClinicDrafts(DraftID) ON DELETE CASCADE
  );
  
  -- Create index
  CREATE INDEX IX_DraftProviders_DraftID ON DraftProviders(DraftID);
  
  PRINT 'Created DraftProviders table with index';
END
ELSE
BEGIN
  PRINT 'DraftProviders table already exists';
END
GO

-- Create DraftProcedures table
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'DraftProcedures'
)
BEGIN
  CREATE TABLE DraftProcedures (
    DraftProcedureID INT PRIMARY KEY IDENTITY(1,1),
    DraftID INT NOT NULL,
    ProcedureName NVARCHAR(255) NOT NULL,
    Category NVARCHAR(255) NOT NULL,
    AverageCost DECIMAL(10,2) NULL,
    ProviderName NVARCHAR(255) NULL, -- Links to DraftProviders
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    
    FOREIGN KEY (DraftID) REFERENCES ClinicDrafts(DraftID) ON DELETE CASCADE
  );
  
  -- Create index
  CREATE INDEX IX_DraftProcedures_DraftID ON DraftProcedures(DraftID);
  
  PRINT 'Created DraftProcedures table with index';
END
ELSE
BEGIN
  PRINT 'DraftProcedures table already exists';
END
GO

PRINT 'Migration completed successfully';
GO

