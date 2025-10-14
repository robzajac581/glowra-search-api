-- Fix 1: Make ClinicID an IDENTITY column (if not already)
-- This requires recreating the table, so we'll handle this differently
-- For now, we'll get the max ClinicID and manually assign IDs in the script

-- Fix 2: Expand GoogleProfileLink and other URL columns that might be too small
ALTER TABLE GooglePlacesData 
ALTER COLUMN GoogleProfileLink NVARCHAR(2000) NULL;

ALTER TABLE GooglePlacesData 
ALTER COLUMN ReviewsLink NVARCHAR(2000) NULL;

ALTER TABLE GooglePlacesData 
ALTER COLUMN GoogleID NVARCHAR(500) NULL;

PRINT 'URL columns expanded successfully';
GO

