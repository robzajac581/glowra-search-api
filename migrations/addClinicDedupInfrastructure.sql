-- Migration: addClinicDedupInfrastructure.sql
-- Purpose: Add durable clinic deduplication infrastructure
-- 1) Audit table for merges
-- 2) Review queue for non-automatic candidate groups
-- 3) Guarded unique index on Clinics.PlaceID (non-null, non-empty)

SET NOCOUNT ON;

PRINT '=== Clinic dedup infrastructure migration ===';

-- Part 1: Merge audit table
IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'ClinicMergeLog'
)
BEGIN
  CREATE TABLE ClinicMergeLog (
    MergeID INT IDENTITY(1,1) PRIMARY KEY,
    CanonicalClinicID INT NOT NULL,
    DuplicateClinicID INT NOT NULL,
    PlaceID NVARCHAR(500) NULL,
    MergeReason NVARCHAR(255) NOT NULL,
    MergeNotes NVARCHAR(MAX) NULL,
    MergedBy NVARCHAR(255) NULL,
    MergeSource NVARCHAR(50) NOT NULL DEFAULT 'manual',
    MergedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ReparentedProviders INT NOT NULL DEFAULT 0,
    ReparentedPhotos INT NOT NULL DEFAULT 0,
    RepointedDrafts INT NOT NULL DEFAULT 0
  );

  CREATE INDEX IX_ClinicMergeLog_CanonicalClinicID ON ClinicMergeLog(CanonicalClinicID);
  CREATE INDEX IX_ClinicMergeLog_DuplicateClinicID ON ClinicMergeLog(DuplicateClinicID);
  CREATE INDEX IX_ClinicMergeLog_PlaceID ON ClinicMergeLog(PlaceID);
  CREATE INDEX IX_ClinicMergeLog_MergedAt ON ClinicMergeLog(MergedAt DESC);

  PRINT 'Created table ClinicMergeLog and supporting indexes';
END
ELSE
BEGIN
  PRINT 'Table ClinicMergeLog already exists';
END

-- Part 2: Optional review queue for unresolved/low-confidence groups
IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'ClinicDedupReviewQueue'
)
BEGIN
  CREATE TABLE ClinicDedupReviewQueue (
    QueueID INT IDENTITY(1,1) PRIMARY KEY,
    CandidateType NVARCHAR(50) NOT NULL, -- e.g. PlaceID, NameAddress, Website
    CandidateKey NVARCHAR(500) NOT NULL, -- grouping key (PlaceID or normalized key)
    CandidateClinicIDs NVARCHAR(MAX) NOT NULL, -- JSON array of clinic IDs
    Status NVARCHAR(50) NOT NULL DEFAULT 'pending', -- pending|approved|rejected
    ReviewNotes NVARCHAR(MAX) NULL,
    ReviewedBy NVARCHAR(255) NULL,
    ReviewedAt DATETIME2 NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_ClinicDedupReviewQueue_Status ON ClinicDedupReviewQueue(Status);
  CREATE INDEX IX_ClinicDedupReviewQueue_CandidateType ON ClinicDedupReviewQueue(CandidateType);
  CREATE INDEX IX_ClinicDedupReviewQueue_CreatedAt ON ClinicDedupReviewQueue(CreatedAt DESC);

  PRINT 'Created table ClinicDedupReviewQueue and supporting indexes';
END
ELSE
BEGIN
  PRINT 'Table ClinicDedupReviewQueue already exists';
END

-- Part 3: Add guarded unique index on Clinics.PlaceID for active records.
-- IMPORTANT:
-- This index is only created when there are no duplicate non-empty PlaceIDs.
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_Clinics_PlaceID_NotNull'
    AND object_id = OBJECT_ID('Clinics')
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM Clinics
    WHERE PlaceID IS NOT NULL
      AND PlaceID <> ''
    GROUP BY PlaceID
    HAVING COUNT(*) > 1
  )
  BEGIN
    PRINT 'Skipped UX_Clinics_PlaceID_NotNull due to existing duplicate PlaceIDs.';
    PRINT 'Run dedup merge script first, then rerun this migration.';
  END
  ELSE
  BEGIN
    CREATE UNIQUE INDEX UX_Clinics_PlaceID_NotNull
      ON Clinics(PlaceID)
      WHERE PlaceID IS NOT NULL
        AND PlaceID <> '';

    PRINT 'Created unique index UX_Clinics_PlaceID_NotNull';
  END
END
ELSE
BEGIN
  PRINT 'Index UX_Clinics_PlaceID_NotNull already exists';
END

PRINT '=== Clinic dedup infrastructure migration complete ===';
