-- GLO-87 ROLLBACK for migrations/dropProceduresLocationIdClinicsFk.sql.
--
-- Do NOT run as part of the migration. Run only to return dbo.Procedures to
-- its pre-GLO-87 constraint set:
--
--   - drop FK_Procedures_ClinicID   (ClinicID)   -> Clinics(ClinicID)
--   - re-add FK_Procedures_Clinics  (LocationID) -> Clinics(ClinicID)  WITH NOCHECK
--
-- Pattern (single batch, no GO; same runner caveats as the forward migration):
--   node scripts/runMigration.js migrations/dropProceduresLocationIdClinicsFk.rollback.sql
--
-- WHY WITH NOCHECK
-- After the forward migration, clinic merges and deletes succeed without the
-- legacy FK in the way. A clinic whose ClinicID coincidentally equals some
-- procedure's LocationID (e.g. LocationID = 3 is a valid Locations row) can be
-- merged away, leaving Procedures.LocationID = 3 with no Clinics row 3. Re-adding
-- the legacy FK WITH CHECK would then fail on those rows. WITH NOCHECK skips
-- validating existing rows; the FK is still enforced for future INSERT/UPDATE
-- of Procedures.LocationID and for DELETEs of Clinics rows, exactly as before.
-- Consequence: the restored FK is marked is_not_trusted = 1 (it was trusted
-- before GLO-87), and the query optimiser will not rely on it. That is
-- acceptable for a rollback; the legacy FK was never semantically correct.
--
-- Do NOT "fix" orphaned LocationID values to make WITH CHECK pass: LocationID
-- values must not be reparented or modified as part of GLO-87.
--
-- APP CACHE: utils/proceduresClinicFkShape.js caches the FK shape for up to
-- 5 minutes. Until it refreshes after a rollback, new procedures are inserted
-- with LocationID = Clinics.LocationID, which may violate the restored legacy
-- FK (LocationID -> Clinics.ClinicID) and fail the insert. Either restart the
-- API process after rolling back (note: boot triggers the Google refresh job,
-- which bills), or run the rollback in a quiet window and wait 5 minutes before
-- approving drafts / importing procedures.
--
-- BACKUP TABLE: this rollback does not touch dbo.Procedures_GLO87_Backup. The
-- forward migration changes no data, so the backup is only needed if Procedures
-- data is damaged by something else. Keep it until GLO-86 is verified, then:
--     DROP TABLE dbo.Procedures_GLO87_Backup;
-- To compare live data against it (read-only):
--     SELECT COUNT_BIG(*) FROM dbo.Procedures_GLO87_Backup;
--     SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Procedures_GLO87_Backup;
--     SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Procedures;
-- (they will differ once procedures are added/edited after the migration.)

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 30000;

BEGIN TRY
  BEGIN TRANSACTION;

  -- Preconditions
  IF OBJECT_ID(N'dbo.FK_Procedures_ClinicID') IS NULL
  BEGIN
    ;THROW 50101, N'GLO-87 rollback precondition failed: FK_Procedures_ClinicID not found. Nothing changed.', 1;
  END

  IF OBJECT_ID(N'dbo.FK_Procedures_Clinics') IS NOT NULL
  BEGIN
    ;THROW 50102, N'GLO-87 rollback precondition failed: FK_Procedures_Clinics is present; the forward migration does not look applied. Nothing changed.', 1;
  END

  ALTER TABLE dbo.Procedures DROP CONSTRAINT FK_Procedures_ClinicID;
  PRINT N'Dropped FK_Procedures_ClinicID';

  ALTER TABLE dbo.Procedures WITH NOCHECK
    ADD CONSTRAINT FK_Procedures_Clinics
    FOREIGN KEY (LocationID) REFERENCES dbo.Clinics (ClinicID);
  PRINT N'Re-added FK_Procedures_Clinics (LocationID -> Clinics.ClinicID) WITH NOCHECK (untrusted)';

  -- Postconditions
  IF OBJECT_ID(N'dbo.FK_Procedures_ClinicID') IS NOT NULL
  BEGIN
    ;THROW 50110, N'GLO-87 rollback postcondition failed: FK_Procedures_ClinicID still present. Rolled back.', 1;
  END

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
    WHERE fk.name = N'FK_Procedures_Clinics'
      AND fk.parent_object_id = OBJECT_ID(N'dbo.Procedures')
      AND fk.referenced_object_id = OBJECT_ID(N'dbo.Clinics')
      AND COL_NAME(fc.parent_object_id, fc.parent_column_id) = N'LocationID'
      AND fk.is_disabled = 0
  )
  BEGIN
    ;THROW 50111, N'GLO-87 rollback postcondition failed: FK_Procedures_Clinics not restored on LocationID. Rolled back.', 1;
  END

  COMMIT TRANSACTION;
  PRINT N'GLO-87 rollback committed. dbo.Procedures_GLO87_Backup left in place.';
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
