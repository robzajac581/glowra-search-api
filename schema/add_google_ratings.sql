-- Add Google Places rating columns to Clinics table
-- Run this script to add the necessary columns for caching Google Places API data

USE glowra; -- Replace with your actual database name
GO

-- Check if columns exist and add them if they don't
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clinics') AND name = 'PlaceID')
BEGIN
    ALTER TABLE Clinics ADD PlaceID NVARCHAR(255) NULL;
    PRINT 'Added PlaceID column';
END
ELSE
BEGIN
    PRINT 'PlaceID column already exists';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clinics') AND name = 'GoogleRating')
BEGIN
    ALTER TABLE Clinics ADD GoogleRating DECIMAL(2,1) NULL;
    PRINT 'Added GoogleRating column';
END
ELSE
BEGIN
    PRINT 'GoogleRating column already exists';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clinics') AND name = 'GoogleReviewCount')
BEGIN
    ALTER TABLE Clinics ADD GoogleReviewCount INT NULL;
    PRINT 'Added GoogleReviewCount column';
END
ELSE
BEGIN
    PRINT 'GoogleReviewCount column already exists';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clinics') AND name = 'GoogleReviewsJSON')
BEGIN
    ALTER TABLE Clinics ADD GoogleReviewsJSON NVARCHAR(MAX) NULL;
    PRINT 'Added GoogleReviewsJSON column';
END
ELSE
BEGIN
    PRINT 'GoogleReviewsJSON column already exists';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clinics') AND name = 'LastRatingUpdate')
BEGIN
    ALTER TABLE Clinics ADD LastRatingUpdate DATETIME NULL;
    PRINT 'Added LastRatingUpdate column';
END
ELSE
BEGIN
    PRINT 'LastRatingUpdate column already exists';
END

GO

-- Create an index on PlaceID for better query performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Clinics_PlaceID')
BEGIN
    CREATE INDEX IX_Clinics_PlaceID ON Clinics(PlaceID);
    PRINT 'Created index on PlaceID';
END
ELSE
BEGIN
    PRINT 'Index on PlaceID already exists';
END

GO

PRINT 'Schema update completed successfully!';

