-- Migration: Remove Specialties Table and SpecialtyID from Procedures
-- 
-- This migration removes the Specialties table and SpecialtyID column from Procedures
-- as they are no longer used in the application. The specialty concept was redundant
-- with clinic categories, and was not being used by the frontend.
--
-- IMPORTANT: This is a DESTRUCTIVE migration. Run on staging first.
-- 
-- To execute this migration:
-- 1. Backup the database first
-- 2. Run: node scripts/runMigration.js migrations/removeSpecialties.sql
--
-- Date: 2024-12-30

-- Step 1: Drop the foreign key constraint from Procedures table (if it exists)
IF EXISTS (
    SELECT 1 FROM sys.foreign_keys 
    WHERE name = 'FK_Procedures_Specialties' 
    OR (parent_object_id = OBJECT_ID('Procedures') AND referenced_object_id = OBJECT_ID('Specialties'))
)
BEGIN
    -- Find and drop the actual constraint name
    DECLARE @constraintName NVARCHAR(200);
    SELECT @constraintName = fk.name
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = OBJECT_ID('Procedures')
    AND fk.referenced_object_id = OBJECT_ID('Specialties');
    
    IF @constraintName IS NOT NULL
    BEGIN
        DECLARE @sql NVARCHAR(500) = 'ALTER TABLE Procedures DROP CONSTRAINT ' + QUOTENAME(@constraintName);
        EXEC sp_executesql @sql;
        PRINT 'Dropped foreign key constraint: ' + @constraintName;
    END
END
ELSE
BEGIN
    PRINT 'No foreign key constraint found between Procedures and Specialties';
END
GO

-- Step 2: Drop the SpecialtyID column from Procedures table (if it exists)
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Procedures' AND COLUMN_NAME = 'SpecialtyID'
)
BEGIN
    ALTER TABLE Procedures DROP COLUMN SpecialtyID;
    PRINT 'Dropped SpecialtyID column from Procedures table';
END
ELSE
BEGIN
    PRINT 'SpecialtyID column does not exist in Procedures table';
END
GO

-- Step 3: Drop the Specialties table (if it exists)
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_NAME = 'Specialties'
)
BEGIN
    DROP TABLE Specialties;
    PRINT 'Dropped Specialties table';
END
ELSE
BEGIN
    PRINT 'Specialties table does not exist';
END
GO

PRINT 'Migration completed: Specialties table and SpecialtyID column removed';
GO

