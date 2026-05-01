-- Add PriceUnit to live Procedures table (parity with DraftProcedures / list-your-clinic submissions).
-- Run against the search API database when you want real units on live procedures (approvals persist
-- PriceUnit only after this exists). Until then, read endpoints use CAST(NULL) and omit priceUnit in JSON;
-- approvals INSERT without PriceUnit so workflows keep working.

IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Procedures' AND COLUMN_NAME = 'PriceUnit'
)
BEGIN
  ALTER TABLE Procedures ADD PriceUnit NVARCHAR(50) NULL;
  PRINT 'Added PriceUnit column to Procedures';
END
ELSE
BEGIN
  PRINT 'PriceUnit column already exists in Procedures';
END
GO
