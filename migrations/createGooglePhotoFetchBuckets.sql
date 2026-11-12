-- GLO-76: persist the Google Places Photo spend budget across restarts.
--
-- The photo proxy counts billable Google photo fetches in a rolling window
-- (utils/googlePhotoBudget.js). That count was in memory only, so every
-- deploy reset it, and main auto-deploys. Each fetch now also increments an
-- hourly bucket here, and the app reloads the window from this table at boot
-- (utils/googlePhotoBudgetStore.js).
--
-- Size: at most ~24 rows/day; rows older than 7 days are purged at each boot.
--
-- Safe to deploy the code BEFORE running this: without the table the app logs
-- one warning and falls back to an in-memory count.
--
-- MANUAL STEP: run once against the prod database, e.g.
--   sqlcmd -S glowra.database.windows.net -d glowra -U <user> -i migrations/createGooglePhotoFetchBuckets.sql
--
-- Rollback: DROP TABLE dbo.GooglePhotoFetchBuckets;  (the app degrades to memory-only)

IF OBJECT_ID(N'dbo.GooglePhotoFetchBuckets', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.GooglePhotoFetchBuckets (
    BucketStart DATETIME2(0) NOT NULL CONSTRAINT PK_GooglePhotoFetchBuckets PRIMARY KEY, -- UTC hour start
    FetchCount  INT          NOT NULL CONSTRAINT DF_GooglePhotoFetchBuckets_FetchCount DEFAULT (0)
  );
END
