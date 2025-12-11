-- Migration: Consolidate Clinic Categories
-- Purpose: Standardize clinic categories into 5 buckets
-- Date: January 2025
-- 
-- Categories:
--   1. Plastic Surgery
--   2. Medspa / Aesthetics
--   3. Medical
--   4. Dermatology
--   5. Other

-- First, let's see what categories we currently have
PRINT '=== Current Category Distribution ==='
SELECT 
  Category,
  COUNT(*) as Count
FROM GooglePlacesData
WHERE Category IS NOT NULL
GROUP BY Category
ORDER BY COUNT(*) DESC;

PRINT ''
PRINT '=== Starting Category Consolidation ==='
PRINT ''

-- Update GooglePlacesData Categories
-- Plastic Surgery
UPDATE GooglePlacesData
SET Category = 'Plastic Surgery'
WHERE Category IS NOT NULL
  AND (
    LOWER(Category) LIKE '%plastic surgeon%'
    OR LOWER(Category) LIKE '%plastic surgery%'
    OR LOWER(Category) LIKE '%cosmetic surgeon%'
    OR LOWER(Category) LIKE '%cosmetic surgery%'
    OR LOWER(Category) LIKE '%reconstructive surgery%'
    OR LOWER(Category) LIKE '%reconstructive surgeon%'
    OR LOWER(REPLACE(Category, ' ', '')) LIKE '%plastic%'
  );

PRINT 'Updated Plastic Surgery categories in GooglePlacesData';

-- Dermatology (check BEFORE Medspa to avoid misclassification)
UPDATE GooglePlacesData
SET Category = 'Dermatology'
WHERE Category IS NOT NULL
  AND Category != 'Plastic Surgery'  -- Don't overwrite already updated
  AND (
    LOWER(Category) LIKE '%dermatolog%'
    OR LOWER(Category) LIKE '%skin care%'
    OR LOWER(Category) LIKE '%skincare%'
    OR LOWER(Category) LIKE '%skin clinic%'
  );

PRINT 'Updated Dermatology categories in GooglePlacesData';

-- Medspa / Aesthetics
UPDATE GooglePlacesData
SET Category = 'Medspa / Aesthetics'
WHERE Category IS NOT NULL
  AND Category NOT IN ('Plastic Surgery', 'Dermatology')  -- Don't overwrite already updated
  AND (
    LOWER(Category) LIKE '%med spa%'
    OR LOWER(Category) LIKE '%medical spa%'
    OR LOWER(Category) LIKE '%medspa%'
    OR LOWER(Category) LIKE '%aesthetic%'
    OR LOWER(Category) LIKE '%beauty clinic%'
    OR LOWER(Category) LIKE '%beauty center%'
    OR LOWER(Category) LIKE '%spa%'
  );

PRINT 'Updated Medspa / Aesthetics categories in GooglePlacesData';

-- Medical
UPDATE GooglePlacesData
SET Category = 'Medical'
WHERE Category IS NOT NULL
  AND Category NOT IN ('Plastic Surgery', 'Dermatology', 'Medspa / Aesthetics')  -- Don't overwrite already updated
  AND (
    LOWER(Category) LIKE '%hospital%'
    OR LOWER(Category) LIKE '%medical center%'
    OR LOWER(Category) LIKE '%health center%'
    OR LOWER(Category) LIKE '%healthcare%'
    OR LOWER(Category) LIKE '%surgical center%'
    OR LOWER(Category) LIKE '%surgery center%'
    OR LOWER(Category) LIKE '%doctor%'
    OR LOWER(Category) LIKE '%physician%'
    OR LOWER(Category) LIKE '%nurse practitioner%'
    OR LOWER(Category) LIKE '%family medicine%'
    OR LOWER(Category) LIKE '%primary care%'
    OR LOWER(Category) LIKE '%urgent care%'
    OR LOWER(Category) LIKE '%medical clinic%'
    OR LOWER(Category) LIKE '%health clinic%'
    OR LOWER(Category) LIKE '%clinic%'
  );

PRINT 'Updated Medical categories in GooglePlacesData';

-- Other (everything else)
UPDATE GooglePlacesData
SET Category = 'Other'
WHERE Category IS NOT NULL
  AND Category NOT IN ('Plastic Surgery', 'Dermatology', 'Medspa / Aesthetics', 'Medical');

PRINT 'Updated remaining categories to Other in GooglePlacesData';

-- Handle NULL categories - default to Other
UPDATE GooglePlacesData
SET Category = 'Other'
WHERE Category IS NULL;

PRINT 'Set NULL categories to Other in GooglePlacesData';

-- Now update ClinicDrafts table
PRINT ''
PRINT '=== Updating ClinicDrafts Categories ==='

-- Plastic Surgery
UPDATE ClinicDrafts
SET Category = 'Plastic Surgery'
WHERE Category IS NOT NULL
  AND (
    LOWER(Category) LIKE '%plastic surgeon%'
    OR LOWER(Category) LIKE '%plastic surgery%'
    OR LOWER(Category) LIKE '%cosmetic surgeon%'
    OR LOWER(Category) LIKE '%cosmetic surgery%'
    OR LOWER(Category) LIKE '%reconstructive surgery%'
    OR LOWER(Category) LIKE '%reconstructive surgeon%'
    OR LOWER(REPLACE(Category, ' ', '')) LIKE '%plastic%'
  );

PRINT 'Updated Plastic Surgery categories in ClinicDrafts';

-- Dermatology
UPDATE ClinicDrafts
SET Category = 'Dermatology'
WHERE Category IS NOT NULL
  AND Category != 'Plastic Surgery'
  AND (
    LOWER(Category) LIKE '%dermatolog%'
    OR LOWER(Category) LIKE '%skin care%'
    OR LOWER(Category) LIKE '%skincare%'
    OR LOWER(Category) LIKE '%skin clinic%'
  );

PRINT 'Updated Dermatology categories in ClinicDrafts';

-- Medspa / Aesthetics
UPDATE ClinicDrafts
SET Category = 'Medspa / Aesthetics'
WHERE Category IS NOT NULL
  AND Category NOT IN ('Plastic Surgery', 'Dermatology')
  AND (
    LOWER(Category) LIKE '%med spa%'
    OR LOWER(Category) LIKE '%medical spa%'
    OR LOWER(Category) LIKE '%medspa%'
    OR LOWER(Category) LIKE '%aesthetic%'
    OR LOWER(Category) LIKE '%beauty clinic%'
    OR LOWER(Category) LIKE '%beauty center%'
    OR LOWER(Category) LIKE '%spa%'
  );

PRINT 'Updated Medspa / Aesthetics categories in ClinicDrafts';

-- Medical
UPDATE ClinicDrafts
SET Category = 'Medical'
WHERE Category IS NOT NULL
  AND Category NOT IN ('Plastic Surgery', 'Dermatology', 'Medspa / Aesthetics')
  AND (
    LOWER(Category) LIKE '%hospital%'
    OR LOWER(Category) LIKE '%medical center%'
    OR LOWER(Category) LIKE '%health center%'
    OR LOWER(Category) LIKE '%healthcare%'
    OR LOWER(Category) LIKE '%surgical center%'
    OR LOWER(Category) LIKE '%surgery center%'
    OR LOWER(Category) LIKE '%doctor%'
    OR LOWER(Category) LIKE '%physician%'
    OR LOWER(Category) LIKE '%nurse practitioner%'
    OR LOWER(Category) LIKE '%family medicine%'
    OR LOWER(Category) LIKE '%primary care%'
    OR LOWER(Category) LIKE '%urgent care%'
    OR LOWER(Category) LIKE '%medical clinic%'
    OR LOWER(Category) LIKE '%health clinic%'
    OR LOWER(Category) LIKE '%clinic%'
  );

PRINT 'Updated Medical categories in ClinicDrafts';

-- Other
UPDATE ClinicDrafts
SET Category = 'Other'
WHERE Category IS NOT NULL
  AND Category NOT IN ('Plastic Surgery', 'Dermatology', 'Medspa / Aesthetics', 'Medical');

PRINT 'Updated remaining categories to Other in ClinicDrafts';

-- Handle NULL categories in ClinicDrafts - default to Other
UPDATE ClinicDrafts
SET Category = 'Other'
WHERE Category IS NULL;

PRINT 'Set NULL categories to Other in ClinicDrafts';

-- Show final distribution
PRINT ''
PRINT '=== Final Category Distribution ==='
SELECT 
  Category,
  COUNT(*) as Count
FROM GooglePlacesData
GROUP BY Category
ORDER BY COUNT(*) DESC;

PRINT ''
PRINT '=== ClinicDrafts Category Distribution ==='
SELECT 
  Category,
  COUNT(*) as Count
FROM ClinicDrafts
GROUP BY Category
ORDER BY COUNT(*) DESC;

PRINT ''
PRINT '=== Category Consolidation Complete ==='
