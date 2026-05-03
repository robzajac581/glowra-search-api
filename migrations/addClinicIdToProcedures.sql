-- Migration: Clinic-centric Procedures — add ClinicID, nullable ProviderID
-- Purpose: Procedures belong to Clinics directly; ProviderID is optional attribution only.
-- Orphan procedures (ProviderID missing or no longer in Providers) are deleted in step 3;
-- re-import with scripts/importProceduresFromExcel.js if you need that data back.
-- Run on staging first; backup production before apply.
-- Pattern: node scripts/runMigration.js migrations/addClinicIdToProcedures.sql

-- 1) Add ClinicID (nullable until backfilled)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Procedures' AND COLUMN_NAME = 'ClinicID'
)
BEGIN
  ALTER TABLE Procedures ADD ClinicID INT NULL;
  PRINT 'Added Procedures.ClinicID';
END
ELSE
BEGIN
  PRINT 'Procedures.ClinicID already exists';
END
GO

-- 2) Backfill from Providers (historical link)
UPDATE p
SET ClinicID = pr.ClinicID
FROM Procedures p
INNER JOIN Providers pr ON pr.ProviderID = p.ProviderID
WHERE p.ClinicID IS NULL;
PRINT 'Backfilled Procedures.ClinicID from Providers';
GO

-- 3) Orphans: no matching Providers row (e.g. provider purged) or NULL ProviderID — cannot resolve ClinicID.
--    Remove them so NOT NULL + FK can apply. Re-import procedures from draft/Excel if needed.
DECLARE @orphanCount INT = (SELECT COUNT(*) FROM Procedures WHERE ClinicID IS NULL);
IF @orphanCount > 0
BEGIN
  PRINT CONCAT('Deleting ', @orphanCount, ' orphan Procedure(s) with no resolvable ClinicID (stale ProviderID or NULL ProviderID).');
  DELETE FROM Procedures WHERE ClinicID IS NULL;
END
ELSE
BEGIN
  PRINT 'No orphan procedures after backfill.';
END
GO

-- 4) NOT NULL + FK to Clinics
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Procedures' AND COLUMN_NAME = 'ClinicID' AND IS_NULLABLE = 'YES'
)
BEGIN
  ALTER TABLE Procedures ALTER COLUMN ClinicID INT NOT NULL;
  PRINT 'Procedures.ClinicID set to NOT NULL';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_Procedures_Clinics'
)
BEGIN
  ALTER TABLE Procedures ADD CONSTRAINT FK_Procedures_Clinics
    FOREIGN KEY (ClinicID) REFERENCES Clinics(ClinicID);
  PRINT 'Added FK_Procedures_Clinics';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Procedures_ClinicID' AND object_id = OBJECT_ID('Procedures')
)
BEGIN
  CREATE INDEX IX_Procedures_ClinicID ON Procedures(ClinicID);
  PRINT 'Created IX_Procedures_ClinicID';
END
GO

-- 5) Drop FK Procedures -> Providers (if any), then allow NULL ProviderID
DECLARE @fkName NVARCHAR(200);
SELECT @fkName = fk.name
FROM sys.foreign_keys fk
WHERE fk.parent_object_id = OBJECT_ID('Procedures')
  AND fk.referenced_object_id = OBJECT_ID('Providers');

IF @fkName IS NOT NULL
BEGIN
  DECLARE @dropFk NVARCHAR(500) = N'ALTER TABLE Procedures DROP CONSTRAINT ' + QUOTENAME(@fkName);
  EXEC sp_executesql @dropFk;
  PRINT N'Dropped FK from Procedures to Providers: ' + @fkName;
END
ELSE
BEGIN
  PRINT 'No FK found from Procedures to Providers';
END
GO

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Procedures' AND COLUMN_NAME = 'ProviderID' AND IS_NULLABLE = 'NO'
)
BEGIN
  ALTER TABLE Procedures ALTER COLUMN ProviderID INT NULL;
  PRINT 'Procedures.ProviderID is now nullable';
END
GO

PRINT 'Migration addClinicIdToProcedures completed.';
GO
