-- PREVIEW ONLY: junk values in Procedures.PriceUnit (GLO-69).
-- Nothing here writes. See cleanProceduresPriceUnitJunk.apply.sql for the UPDATE,
-- and prefer scripts/cleanPriceUnitJunk.js, which classifies the same rows with
-- the shared normaliser and reports which ones are unsafe to null.
--
-- Pattern: node scripts/runMigration.js migrations/cleanProceduresPriceUnitJunk.preview.sql
--
-- Background: the write paths stored the price unit as free text, so the column
-- holds prices that leaked out of the price cell ('/650', '/2 vials'). The five
-- real-but-unlisted units (/procedure, /package, /cycle, /thread, /graft) were
-- added to the enum in GLO-69 and are NOT touched here.
--
-- Safety rule below: a junk unit is safe to null only when the number it
-- contains already appears in AverageCost. Procedures has no PriceMin/PriceMax
-- (those exist only on DraftProcedures), so AverageCost is the only cross-check
-- available on live data -- expect a meaningful number of rows to need review.

;WITH Junk AS (
  SELECT
    p.ProcedureID,
    p.ProcedureName,
    p.AverageCost,
    LTRIM(RTRIM(p.PriceUnit)) AS PriceUnit
  FROM Procedures p
  WHERE p.PriceUnit IS NOT NULL
    AND LTRIM(RTRIM(p.PriceUnit)) <> ''
    -- A digit anywhere in the unit means a number is where only a noun belongs.
    -- No canonical unit or accepted alias contains a digit.
    AND p.PriceUnit LIKE '%[0-9]%'
)
SELECT
  ProcedureID,
  ProcedureName,
  PriceUnit,
  AverageCost,
  CASE
    -- The whole unit is one number that matches AverageCost: pure duplication.
    WHEN AverageCost IS NOT NULL
     AND REPLACE(PriceUnit, '/', '') NOT LIKE '%[^0-9.]%'
     AND TRY_CONVERT(DECIMAL(10, 2), REPLACE(PriceUnit, '/', '')) = AverageCost
      THEN 'SAFE: number equals AverageCost'
    -- A number we cannot account for: nulling would lose the only copy.
    ELSE 'REVIEW: number not accounted for by AverageCost'
  END AS Verdict
FROM Junk
ORDER BY Verdict, ProcedureID;

-- Summary counts.
;WITH Junk AS (
  SELECT
    p.AverageCost,
    LTRIM(RTRIM(p.PriceUnit)) AS PriceUnit
  FROM Procedures p
  WHERE p.PriceUnit IS NOT NULL
    AND LTRIM(RTRIM(p.PriceUnit)) <> ''
    AND p.PriceUnit LIKE '%[0-9]%'
)
SELECT
  COUNT(*) AS JunkRows,
  SUM(CASE
        WHEN AverageCost IS NOT NULL
         AND REPLACE(PriceUnit, '/', '') NOT LIKE '%[^0-9.]%'
         AND TRY_CONVERT(DECIMAL(10, 2), REPLACE(PriceUnit, '/', '')) = AverageCost
        THEN 1 ELSE 0
      END) AS SafeToNull,
  COUNT(DISTINCT PriceUnit) AS DistinctJunkValues
FROM Junk;

-- Also list every distinct non-blank unit with its count, so any real unit still
-- missing from the enum shows up rather than being assumed absent.
SELECT
  LTRIM(RTRIM(PriceUnit)) AS PriceUnit,
  COUNT(*) AS Occurrences
FROM Procedures
WHERE PriceUnit IS NOT NULL AND LTRIM(RTRIM(PriceUnit)) <> ''
GROUP BY LTRIM(RTRIM(PriceUnit))
ORDER BY Occurrences DESC, PriceUnit;
