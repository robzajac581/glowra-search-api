-- APPLY: null the junk values in Procedures.PriceUnit (GLO-69).
--
-- DO NOT RUN THIS UNTIL cleanProceduresPriceUnitJunk.preview.sql HAS BEEN
-- REVIEWED. Run the preview first and confirm the SAFE rows look right.
--
-- Pattern: node scripts/runMigration.js migrations/cleanProceduresPriceUnitJunk.apply.sql
--
-- Scope: only rows whose PriceUnit contains a digit AND whose number equals
-- AverageCost -- i.e. the unit is a duplicate of a price already stored, so
-- dropping it loses no information. Rows whose number is NOT accounted for are
-- deliberately left alone; they need a human to fix the price first, because
-- for those the junk unit may hold the only surviving copy of the number.
--
-- This migration is re-runnable: after it succeeds the matched rows no longer
-- contain a digit, so a second run updates nothing.
--
-- MANUAL STEP: take a backup of the affected rows before applying. The SELECT
-- below writes them to Procedures_PriceUnitJunkBackup so the change can be
-- reversed; keep that table until the cleanup has been verified in the API.

BEGIN TRANSACTION;

BEGIN TRY

  IF OBJECT_ID('Procedures_PriceUnitJunkBackup', 'U') IS NULL
  BEGIN
    CREATE TABLE Procedures_PriceUnitJunkBackup (
      ProcedureID INT NOT NULL,
      OldPriceUnit NVARCHAR(50) NULL,
      AverageCost DECIMAL(10, 2) NULL,
      BackedUpAt DATETIME NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT 'Created Procedures_PriceUnitJunkBackup';
  END

  -- Back up exactly the rows the UPDATE below will touch.
  INSERT INTO Procedures_PriceUnitJunkBackup (ProcedureID, OldPriceUnit, AverageCost)
  SELECT
    p.ProcedureID,
    p.PriceUnit,
    p.AverageCost
  FROM Procedures p
  WHERE p.PriceUnit IS NOT NULL
    AND LTRIM(RTRIM(p.PriceUnit)) <> ''
    AND p.PriceUnit LIKE '%[0-9]%'
    AND p.AverageCost IS NOT NULL
    AND REPLACE(LTRIM(RTRIM(p.PriceUnit)), '/', '') NOT LIKE '%[^0-9.]%'
    AND TRY_CONVERT(DECIMAL(10, 2), REPLACE(LTRIM(RTRIM(p.PriceUnit)), '/', '')) = p.AverageCost
    AND NOT EXISTS (
      SELECT 1 FROM Procedures_PriceUnitJunkBackup b WHERE b.ProcedureID = p.ProcedureID
    );

  PRINT CONCAT('Backed up ', @@ROWCOUNT, ' row(s)');

  UPDATE p
  SET p.PriceUnit = NULL
  FROM Procedures p
  WHERE p.PriceUnit IS NOT NULL
    AND LTRIM(RTRIM(p.PriceUnit)) <> ''
    AND p.PriceUnit LIKE '%[0-9]%'
    AND p.AverageCost IS NOT NULL
    AND REPLACE(LTRIM(RTRIM(p.PriceUnit)), '/', '') NOT LIKE '%[^0-9.]%'
    AND TRY_CONVERT(DECIMAL(10, 2), REPLACE(LTRIM(RTRIM(p.PriceUnit)), '/', '')) = p.AverageCost;

  PRINT CONCAT('Nulled PriceUnit on ', @@ROWCOUNT, ' row(s)');

  -- Report what is left for manual attention.
  SELECT
    ProcedureID,
    ProcedureName,
    PriceUnit,
    AverageCost
  FROM Procedures
  WHERE PriceUnit IS NOT NULL
    AND LTRIM(RTRIM(PriceUnit)) <> ''
    AND PriceUnit LIKE '%[0-9]%'
  ORDER BY ProcedureID;

  COMMIT TRANSACTION;
  PRINT 'Committed. Rows still containing a digit (listed above) need manual review.';

END TRY
BEGIN CATCH
  ROLLBACK TRANSACTION;
  PRINT CONCAT('Rolled back: ', ERROR_MESSAGE());
  THROW;
END CATCH

-- Rollback, if the cleanup turns out to be wrong:
--
--   UPDATE p
--   SET p.PriceUnit = b.OldPriceUnit
--   FROM Procedures p
--   INNER JOIN Procedures_PriceUnitJunkBackup b ON b.ProcedureID = p.ProcedureID;
