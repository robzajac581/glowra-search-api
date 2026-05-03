-- PREVIEW ONLY: how many Procedures rows would get PriceUnit from approved DraftProcedures.
-- See backfillProceduresPriceUnitFromDrafts.apply.sql for the UPDATE (after you verify samples).

;WITH DraftProcRaw AS (
  SELECT
    c.ClinicID,
    dp.ProcedureName,
    dp.Category AS DraftCategory,
    LTRIM(RTRIM(dp.PriceUnit)) AS NewPriceUnit,
    cd.DraftID,
    COALESCE(cd.ReviewedAt, cd.SubmittedAt) AS DraftSortTime
  FROM Clinics c
  INNER JOIN ClinicDrafts cd
    ON cd.Status = 'approved'
   AND (
        (cd.DuplicateClinicID IS NOT NULL AND cd.DuplicateClinicID = c.ClinicID)
     OR (
          cd.PlaceID IS NOT NULL
          AND LTRIM(RTRIM(cd.PlaceID)) <> ''
          AND c.PlaceID IS NOT NULL
          AND LTRIM(RTRIM(c.PlaceID)) <> ''
          AND cd.PlaceID = c.PlaceID
        )
     OR (
          (cd.PlaceID IS NULL OR LTRIM(RTRIM(cd.PlaceID)) = '')
          AND LOWER(LTRIM(RTRIM(ISNULL(cd.ClinicName, '')))) = LOWER(LTRIM(RTRIM(ISNULL(c.ClinicName, ''))))
          AND LOWER(LTRIM(RTRIM(ISNULL(cd.City, '')))) = LOWER(LTRIM(RTRIM(ISNULL(c.City, ''))))
          AND LOWER(LTRIM(RTRIM(ISNULL(cd.State, '')))) = LOWER(LTRIM(RTRIM(ISNULL(c.State, ''))))
        )
      )
  INNER JOIN DraftProcedures dp ON dp.DraftID = cd.DraftID
  WHERE dp.PriceUnit IS NOT NULL
    AND LTRIM(RTRIM(dp.PriceUnit)) <> ''
),
Ranked AS (
  SELECT
    ClinicID,
    ProcedureName,
    DraftCategory,
    NewPriceUnit,
    ROW_NUMBER() OVER (
      PARTITION BY ClinicID, ProcedureName, DraftCategory
      ORDER BY DraftSortTime DESC, DraftID DESC
    ) AS rn
  FROM DraftProcRaw
),
BestDraft AS (
  SELECT ClinicID, ProcedureName, DraftCategory, NewPriceUnit
  FROM Ranked
  WHERE rn = 1
)
SELECT
  COUNT(*) AS procedure_rows_to_update
FROM Procedures p
INNER JOIN Categories cat ON cat.CategoryID = p.CategoryID
INNER JOIN BestDraft bd
  ON bd.ClinicID = p.ClinicID
 AND bd.ProcedureName = p.ProcedureName
 AND bd.DraftCategory = cat.Category
WHERE (p.PriceUnit IS NULL OR LTRIM(RTRIM(p.PriceUnit)) = '');

;WITH DraftProcRaw AS (
  SELECT
    c.ClinicID,
    dp.ProcedureName,
    dp.Category AS DraftCategory,
    LTRIM(RTRIM(dp.PriceUnit)) AS NewPriceUnit,
    cd.DraftID,
    COALESCE(cd.ReviewedAt, cd.SubmittedAt) AS DraftSortTime
  FROM Clinics c
  INNER JOIN ClinicDrafts cd
    ON cd.Status = 'approved'
   AND (
        (cd.DuplicateClinicID IS NOT NULL AND cd.DuplicateClinicID = c.ClinicID)
     OR (
          cd.PlaceID IS NOT NULL
          AND LTRIM(RTRIM(cd.PlaceID)) <> ''
          AND c.PlaceID IS NOT NULL
          AND LTRIM(RTRIM(c.PlaceID)) <> ''
          AND cd.PlaceID = c.PlaceID
        )
     OR (
          (cd.PlaceID IS NULL OR LTRIM(RTRIM(cd.PlaceID)) = '')
          AND LOWER(LTRIM(RTRIM(ISNULL(cd.ClinicName, '')))) = LOWER(LTRIM(RTRIM(ISNULL(c.ClinicName, ''))))
          AND LOWER(LTRIM(RTRIM(ISNULL(cd.City, '')))) = LOWER(LTRIM(RTRIM(ISNULL(c.City, ''))))
          AND LOWER(LTRIM(RTRIM(ISNULL(cd.State, '')))) = LOWER(LTRIM(RTRIM(ISNULL(c.State, ''))))
        )
      )
  INNER JOIN DraftProcedures dp ON dp.DraftID = cd.DraftID
  WHERE dp.PriceUnit IS NOT NULL
    AND LTRIM(RTRIM(dp.PriceUnit)) <> ''
),
Ranked AS (
  SELECT
    ClinicID,
    ProcedureName,
    DraftCategory,
    NewPriceUnit,
    ROW_NUMBER() OVER (
      PARTITION BY ClinicID, ProcedureName, DraftCategory
      ORDER BY DraftSortTime DESC, DraftID DESC
    ) AS rn
  FROM DraftProcRaw
),
BestDraft AS (
  SELECT ClinicID, ProcedureName, DraftCategory, NewPriceUnit
  FROM Ranked
  WHERE rn = 1
)
SELECT TOP 40
  p.ProcedureID,
  p.ClinicID,
  p.ProcedureName,
  cat.Category AS LiveCategory,
  p.AverageCost,
  p.PriceUnit AS CurrentPriceUnit,
  bd.NewPriceUnit AS WouldSetTo
FROM Procedures p
INNER JOIN Categories cat ON cat.CategoryID = p.CategoryID
INNER JOIN BestDraft bd
  ON bd.ClinicID = p.ClinicID
 AND bd.ProcedureName = p.ProcedureName
 AND bd.DraftCategory = cat.Category
WHERE (p.PriceUnit IS NULL OR LTRIM(RTRIM(p.PriceUnit)) = '')
ORDER BY p.ClinicID, p.ProcedureName;
GO
