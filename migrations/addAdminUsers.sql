-- Migration: Add AdminUsers Table for Admin Authentication
-- Purpose: Support admin login for clinic review UI
-- Date: December 2024

-- Create AdminUsers table
IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES 
  WHERE TABLE_NAME = 'AdminUsers'
)
BEGIN
  CREATE TABLE AdminUsers (
    AdminUserID INT PRIMARY KEY IDENTITY(1,1),
    Email NVARCHAR(255) NOT NULL UNIQUE,
    PasswordHash NVARCHAR(255) NOT NULL,
    Role NVARCHAR(50) NOT NULL DEFAULT 'admin',
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
    LastLoginAt DATETIME NULL
  );
  
  -- Create index on email for login queries
  CREATE INDEX IX_AdminUsers_Email ON AdminUsers(Email);
  
  PRINT 'Created AdminUsers table with indexes';
END
ELSE
BEGIN
  PRINT 'AdminUsers table already exists';
END
GO

-- Insert initial superadmin account
-- Password: GlowraAdmin2024!Secure
-- 
-- IMPORTANT: Generate the hash by running:
--   node scripts/generateAdminPassword.js
-- 
-- Then update the hash below. The hash will look like:
--   $2b$10$[22 chars salt][31 chars hash]
-- 
-- IMPORTANT: Change this password in production!
IF NOT EXISTS (
  SELECT 1 FROM AdminUsers WHERE Email = 'superadmin@glowra.com'
)
BEGIN
  INSERT INTO AdminUsers (Email, PasswordHash, Role, IsActive)
  VALUES (
    'superadmin@glowra.com',
    -- Replace this with the actual bcrypt hash from generateAdminPassword.js
    -- This is a placeholder that MUST be replaced before running migration
    '$2b$10$flkmWmU5rguDx5FvvqpFP.6klQwqxiYQ8aLwc9tBBBVo5oqr3N6b2',
    'superadmin',
    1
  );
  PRINT 'Created superadmin account';
END
ELSE
BEGIN
  PRINT 'Superadmin account already exists';
END
GO

-- Add columns to ClinicDrafts for Google data storage if not exist
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'GoogleRating'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD GoogleRating DECIMAL(2,1) NULL;
  PRINT 'Added GoogleRating column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'GoogleReviewCount'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD GoogleReviewCount INT NULL;
  PRINT 'Added GoogleReviewCount column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'GoogleDataJSON'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD GoogleDataJSON NVARCHAR(MAX) NULL;
  PRINT 'Added GoogleDataJSON column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'PhotoSource'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD PhotoSource NVARCHAR(20) NULL DEFAULT 'user';
  PRINT 'Added PhotoSource column to ClinicDrafts';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'ClinicDrafts' AND COLUMN_NAME = 'RatingSource'
)
BEGIN
  ALTER TABLE ClinicDrafts ADD RatingSource NVARCHAR(20) NULL DEFAULT 'google';
  PRINT 'Added RatingSource column to ClinicDrafts';
END
GO

PRINT 'Migration completed successfully';
GO

