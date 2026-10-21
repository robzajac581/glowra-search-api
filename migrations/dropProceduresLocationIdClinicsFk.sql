-- GLO-87: drop the legacy Procedures.LocationID -> Clinics(ClinicID) foreign key
-- and put the clinic FK on the column that actually holds the clinic:
-- Procedures.ClinicID -> Clinics(ClinicID).
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- In prod, dbo.Procedures.LocationID carries TWO enabled foreign keys:
--
--   FK_Procedures_Clinics           (LocationID) -> Clinics(ClinicID)      WRONG, legacy
--   FK__Procedure__Locat__08B54D69  (LocationID) -> Locations(LocationID) correct
--
-- Clinic ownership lives in Procedures.ClinicID (NOT NULL, indexed by
-- IX_Procedures_ClinicID) but that column has NO foreign key at all.
--
-- migrations/addClinicIdToProcedures.sql meant to create FK_Procedures_Clinics
-- on ClinicID, but its guard is "IF NOT EXISTS ... name = 'FK_Procedures_Clinics'"
-- and prod already had a legacy constraint with that exact name on LocationID,
-- so the intended FK was silently never created.
--
-- The legacy FK blocks clinic deletes and merges (GLO-86): the ClinicID and
-- LocationID id spaces overlap by coincidence (both are small integers;
-- Locations has 255 rows), so deleting clinic N fails whenever any procedure has
-- LocationID = N, even when that procedure belongs to a different clinic.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES (single batch, single transaction, SET XACT_ABORT ON)
-- ---------------------------------------------------------------------------
--   a. Preconditions -- THROW (and change nothing) unless:
--        - FK_Procedures_Clinics exists with shape (LocationID) -> Clinics(ClinicID)
--        - it is the only Procedures -> Clinics FK
--        - an enabled (LocationID) -> Locations(LocationID) FK exists
--        - Procedures row count equals @ExpectedProcedureRows (captured below)
--        - 0 Procedures rows whose ClinicID has no Clinics row
--        - FK_Procedures_ClinicID and Procedures_GLO87_Backup do not exist yet
--   b. Backup: SELECT INTO dbo.Procedures_GLO87_Backup (every column, every row),
--      then assert backup row count and content checksum match the source.
--   c. DROP CONSTRAINT FK_Procedures_Clinics.
--   d. ADD CONSTRAINT FK_Procedures_ClinicID (ClinicID) -> Clinics(ClinicID)
--      WITH CHECK (existing rows validated, so the FK is trusted).
--      No ON DELETE CASCADE -- see "DELETE BEHAVIOUR" below.
--   e. Postconditions -- THROW (rolls everything back) unless:
--        - row count unchanged and content checksum still equals the backup
--          (i.e. no LocationID / ClinicID value was modified)
--        - FK_Procedures_Clinics is gone
--        - the Locations FK is still present and enabled
--        - FK_Procedures_ClinicID is present, enabled and trusted (is_not_trusted = 0)
--
-- No data values are modified. LocationID values are NOT reparented: rows whose
-- LocationID historically held a clinic id keep that value; it remains valid
-- against the Locations FK (prod enforces that FK today, trusted).
--
-- ---------------------------------------------------------------------------
-- DELETE BEHAVIOUR (why no ON DELETE CASCADE)
-- ---------------------------------------------------------------------------
-- - clinicMergeService.mergeClinics reparents Procedures.ClinicID (and
--   Providers, ClinicPhotos, GooglePlacesData, ClinicDrafts) to the canonical
--   clinic BEFORE deleting the duplicate, in the same transaction. With this
--   FK, merges keep working and no longer trip over unrelated LocationID values.
-- - clinicDeletionService.deleteClinic does NOT touch Procedures at all: it
--   archives Clinics / GooglePlacesData / ClinicPhotos into Deleted* tables and
--   deletes the clinic, but never archives or deletes procedures. Today
--   (no FK on ClinicID) a delete of a clinic that owns procedures would either
--   fail on the wrong FK by coincidence, or succeed and leave orphaned
--   procedures that restoreClinic cannot bring back.
--   After this migration that delete FAILS with an FK error whenever the clinic
--   still owns procedures. That is intentional: cascading would silently and
--   unrecoverably delete priced procedures. Callers must reparent (merge) or
--   explicitly remove procedures first.
--
-- ---------------------------------------------------------------------------
-- COST / LOCKING (Azure SQL Basic, 5 DTU)
-- ---------------------------------------------------------------------------
-- ~9.4k rows. One full read for the backup copy, two checksum scans, one FK
-- validation (seek per row on the Clinics PK). ADD CONSTRAINT takes a schema
-- modification lock on Procedures for the duration of the transaction, so API
-- reads of Procedures block briefly. LOCK_TIMEOUT caps the wait for that lock;
-- on timeout the whole transaction rolls back. Run in a quiet window.
--
-- ---------------------------------------------------------------------------
-- MANUAL STEPS
-- ---------------------------------------------------------------------------
-- 1. Re-capture the row count immediately before running and set
--    @ExpectedProcedureRows below if it changed (procedures are added by draft
--    approval and imports):
--        SELECT COUNT_BIG(*) FROM dbo.Procedures;
--    The value 9371 was read from prod on 2026-10-21.
-- 2. Take / confirm an Azure point-in-time restore point (automatic on Azure
--    SQL; note the UTC time you start).
-- 3. Run the whole file as ONE batch (it contains no GO separators; the
--    transaction must stay on a single connection):
--        node scripts/runMigration.js migrations/dropProceduresLocationIdClinicsFk.sql
--    Prefer scripts/runMigration.js over `npm run migrate:clinic-management`:
--    the latter swallows any error whose text contains "already exists" and
--    reports success. Note that runMigration.js does not print PRINT output;
--    success = exit code 0 and "Migration completed successfully!".
--    Running this file in SSMS / Azure Data Studio is equally fine and shows
--    the PRINT lines.
-- 4. Verify:
--        SELECT fk.name, COL_NAME(fc.parent_object_id, fc.parent_column_id) AS col,
--               OBJECT_NAME(fk.referenced_object_id) AS ref, fk.is_not_trusted
--        FROM sys.foreign_keys fk
--        JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
--        WHERE fk.parent_object_id = OBJECT_ID(N'dbo.Procedures');
--    Expect: FK_Procedures_ClinicID (ClinicID -> Clinics, trusted), the
--    Locations FK on LocationID, the Categories FK; no FK_Procedures_Clinics.
-- 5. The running API caches the FK shape for up to 5 minutes
--    (utils/proceduresClinicFkShape.js). Until it refreshes, new procedures are
--    inserted with LocationID = NULL (the old "both FKs" rule), which is valid.
--    After refresh they get LocationID = Clinics.LocationID, which is also valid
--    (every non-NULL Clinics.LocationID exists in Locations as of 2026-10-21).
-- 6. Keep dbo.Procedures_GLO87_Backup until GLO-86 deletes/merges have been
--    exercised successfully, then drop it manually:
--        DROP TABLE dbo.Procedures_GLO87_Backup;
--
-- ROLLBACK: see migrations/dropProceduresLocationIdClinicsFk.rollback.sql.
--
-- Not re-runnable by design: a second run fails the precondition that
-- FK_Procedures_Clinics exists and changes nothing.
-- ---------------------------------------------------------------------------

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 30000;

DECLARE @ExpectedProcedureRows BIGINT = 9371;  -- MANUAL STEP 1: re-capture before running

DECLARE @msg NVARCHAR(2048);
DECLARE @procRows BIGINT;
DECLARE @backupRows BIGINT;
DECLARE @orphans BIGINT;
DECLARE @srcChecksum INT;
DECLARE @backupChecksum INT;
DECLARE @locationsFkId INT;
DECLARE @locationsFkName SYSNAME;
DECLARE @newFkId INT;

BEGIN TRY
  BEGIN TRANSACTION;

  -- -------------------------------------------------------------------------
  -- a. Preconditions
  -- -------------------------------------------------------------------------

  -- FK_Procedures_Clinics must exist AND be the legacy LocationID -> Clinics(ClinicID)
  -- shape. If some environment has FK_Procedures_Clinics on ClinicID (the shape
  -- addClinicIdToProcedures.sql intended), this migration is not for it.
  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
    WHERE fk.name = N'FK_Procedures_Clinics'
      AND fk.parent_object_id = OBJECT_ID(N'dbo.Procedures')
      AND fk.referenced_object_id = OBJECT_ID(N'dbo.Clinics')
      AND COL_NAME(fc.parent_object_id, fc.parent_column_id) = N'LocationID'
      AND COL_NAME(fc.referenced_object_id, fc.referenced_column_id) = N'ClinicID'
  )
  BEGIN
    ;THROW 50001, N'GLO-87 precondition failed: FK_Procedures_Clinics with shape (LocationID) -> Clinics(ClinicID) not found on dbo.Procedures. Nothing changed.', 1;
  END

  IF (SELECT COUNT(*) FROM sys.foreign_key_columns fc
      WHERE fc.constraint_object_id = OBJECT_ID(N'dbo.FK_Procedures_Clinics')) <> 1
  BEGIN
    ;THROW 50002, N'GLO-87 precondition failed: FK_Procedures_Clinics is not a single-column FK. Nothing changed.', 1;
  END

  IF (SELECT COUNT(*) FROM sys.foreign_keys fk
      WHERE fk.parent_object_id = OBJECT_ID(N'dbo.Procedures')
        AND fk.referenced_object_id = OBJECT_ID(N'dbo.Clinics')) <> 1
  BEGIN
    ;THROW 50003, N'GLO-87 precondition failed: expected exactly one Procedures -> Clinics FK (FK_Procedures_Clinics). Nothing changed.', 1;
  END

  -- The Locations FK is matched by shape, not name: its name is system
  -- generated (FK__Procedure__Locat__08B54D69 in prod) and differs per database.
  SELECT TOP (1)
    @locationsFkId = fk.object_id,
    @locationsFkName = fk.name
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
  WHERE fk.parent_object_id = OBJECT_ID(N'dbo.Procedures')
    AND fk.referenced_object_id = OBJECT_ID(N'dbo.Locations')
    AND fk.is_disabled = 0
    AND COL_NAME(fc.parent_object_id, fc.parent_column_id) = N'LocationID'
    AND COL_NAME(fc.referenced_object_id, fc.referenced_column_id) = N'LocationID'
  ORDER BY fk.object_id;

  IF @locationsFkId IS NULL
  BEGIN
    ;THROW 50004, N'GLO-87 precondition failed: no enabled (LocationID) -> Locations(LocationID) FK on dbo.Procedures. Nothing changed.', 1;
  END

  SELECT @procRows = COUNT_BIG(*) FROM dbo.Procedures;
  IF @procRows <> @ExpectedProcedureRows
  BEGIN
    SET @msg = CONCAT(N'GLO-87 precondition failed: dbo.Procedures has ', @procRows,
                      N' rows, expected ', @ExpectedProcedureRows,
                      N'. Re-capture @ExpectedProcedureRows (manual step 1). Nothing changed.');
    THROW 50005, @msg, 1;
  END

  SELECT @orphans = COUNT_BIG(*)
  FROM dbo.Procedures p
  WHERE NOT EXISTS (SELECT 1 FROM dbo.Clinics c WHERE c.ClinicID = p.ClinicID);
  IF @orphans <> 0
  BEGIN
    SET @msg = CONCAT(N'GLO-87 precondition failed: ', @orphans,
                      N' Procedures row(s) reference a ClinicID with no Clinics row. Nothing changed.');
    THROW 50006, @msg, 1;
  END

  IF OBJECT_ID(N'dbo.FK_Procedures_ClinicID') IS NOT NULL
  BEGIN
    ;THROW 50007, N'GLO-87 precondition failed: an object named FK_Procedures_ClinicID is present. Nothing changed.', 1;
  END

  -- (Wording avoids the phrase "already exists": npm run migrate:clinic-management
  -- treats any error containing it as a harmless warning.)
  IF OBJECT_ID(N'dbo.Procedures_GLO87_Backup') IS NOT NULL
  BEGIN
    ;THROW 50008, N'GLO-87 precondition failed: dbo.Procedures_GLO87_Backup is present from an earlier run. Inspect it, drop or rename it, then retry. Nothing changed.', 1;
  END

  PRINT CONCAT(N'Preconditions OK: ', @procRows, N' procedures, 0 orphan ClinicIDs, Locations FK = ', @locationsFkName);

  -- -------------------------------------------------------------------------
  -- b. Backup (all columns, all rows). One-off copy, so SELECT * is deliberate
  --    here: it captures any column added after this file was written.
  -- -------------------------------------------------------------------------
  SELECT * INTO dbo.Procedures_GLO87_Backup FROM dbo.Procedures;

  SELECT @backupRows = COUNT_BIG(*) FROM dbo.Procedures_GLO87_Backup;
  IF @backupRows <> @procRows
  BEGIN
    SET @msg = CONCAT(N'GLO-87 backup check failed: backup has ', @backupRows,
                      N' rows, source has ', @procRows, N'. Rolled back.');
    THROW 50010, @msg, 1;
  END

  -- Content sanity check (not cryptographic). SELECT INTO preserves column
  -- order and types, so BINARY_CHECKSUM(*) is comparable across the two tables.
  SELECT @srcChecksum = CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Procedures;
  SELECT @backupChecksum = CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Procedures_GLO87_Backup;
  IF @srcChecksum <> @backupChecksum
  BEGIN
    ;THROW 50011, N'GLO-87 backup check failed: backup content checksum differs from source. Rolled back.', 1;
  END

  PRINT CONCAT(N'Backup OK: dbo.Procedures_GLO87_Backup holds ', @backupRows, N' rows');

  -- -------------------------------------------------------------------------
  -- c. Drop the legacy LocationID -> Clinics(ClinicID) FK
  -- -------------------------------------------------------------------------
  ALTER TABLE dbo.Procedures DROP CONSTRAINT FK_Procedures_Clinics;
  PRINT N'Dropped FK_Procedures_Clinics (LocationID -> Clinics.ClinicID)';

  -- -------------------------------------------------------------------------
  -- d. Add the correct ClinicID -> Clinics(ClinicID) FK, validated (trusted).
  --    Supporting index on the child side already exists: IX_Procedures_ClinicID.
  --    Default NO ACTION on delete/update: deleting a clinic that still owns
  --    procedures must fail (see DELETE BEHAVIOUR in the header).
  -- -------------------------------------------------------------------------
  ALTER TABLE dbo.Procedures WITH CHECK
    ADD CONSTRAINT FK_Procedures_ClinicID
    FOREIGN KEY (ClinicID) REFERENCES dbo.Clinics (ClinicID);
  PRINT N'Added FK_Procedures_ClinicID (ClinicID -> Clinics.ClinicID) WITH CHECK';

  -- -------------------------------------------------------------------------
  -- e. Postconditions
  -- -------------------------------------------------------------------------
  IF (SELECT COUNT_BIG(*) FROM dbo.Procedures) <> @procRows
  BEGIN
    ;THROW 50020, N'GLO-87 postcondition failed: Procedures row count changed. Rolled back.', 1;
  END

  IF (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Procedures) <> @backupChecksum
  BEGIN
    ;THROW 50021, N'GLO-87 postcondition failed: Procedures content checksum changed. Rolled back.', 1;
  END

  IF OBJECT_ID(N'dbo.FK_Procedures_Clinics') IS NOT NULL
  BEGIN
    ;THROW 50022, N'GLO-87 postcondition failed: FK_Procedures_Clinics is still present. Rolled back.', 1;
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE object_id = @locationsFkId AND is_disabled = 0
  )
  BEGIN
    ;THROW 50023, N'GLO-87 postcondition failed: the Locations FK on Procedures.LocationID is missing or disabled. Rolled back.', 1;
  END

  SELECT @newFkId = fk.object_id
  FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
  WHERE fk.name = N'FK_Procedures_ClinicID'
    AND fk.parent_object_id = OBJECT_ID(N'dbo.Procedures')
    AND fk.referenced_object_id = OBJECT_ID(N'dbo.Clinics')
    AND COL_NAME(fc.parent_object_id, fc.parent_column_id) = N'ClinicID'
    AND COL_NAME(fc.referenced_object_id, fc.referenced_column_id) = N'ClinicID'
    AND fk.is_disabled = 0
    AND fk.is_not_trusted = 0
    AND fk.delete_referential_action = 0;  -- NO_ACTION

  IF @newFkId IS NULL
  BEGIN
    ;THROW 50024, N'GLO-87 postcondition failed: FK_Procedures_ClinicID missing, wrong shape, disabled, untrusted, or not NO ACTION. Rolled back.', 1;
  END

  COMMIT TRANSACTION;
  PRINT N'GLO-87 committed. Keep dbo.Procedures_GLO87_Backup until GLO-86 is verified.';
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
