-- Migration: Blog posts (markdown source, optional rendered HTML, publish flag)
-- Run: node scripts/runClinicManagementMigration.js addBlogPosts.sql
--
-- Manual: ensure AdminUsers exists (addAdminUsers migration) before FK below.

IF NOT EXISTS (
  SELECT * FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'BlogPosts'
)
BEGIN
  CREATE TABLE BlogPosts (
    BlogPostID INT NOT NULL PRIMARY KEY IDENTITY(1,1),
    Slug NVARCHAR(255) NOT NULL,
    Title NVARCHAR(500) NOT NULL,
    Description NVARCHAR(2000) NOT NULL,
    PublishedAt DATETIME2 NOT NULL,
    MarkdownSource NVARCHAR(MAX) NOT NULL,
    HtmlContent NVARCHAR(MAX) NULL,
    IsPublished BIT NOT NULL CONSTRAINT DF_BlogPosts_IsPublished DEFAULT (1),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_BlogPosts_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_BlogPosts_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CreatedByAdminUserId INT NULL,
    CONSTRAINT UQ_BlogPosts_Slug UNIQUE (Slug),
    CONSTRAINT FK_BlogPosts_AdminUsers FOREIGN KEY (CreatedByAdminUserId)
      REFERENCES AdminUsers (AdminUserID) ON DELETE SET NULL
  );

  CREATE INDEX IX_BlogPosts_Published_PublishedAt
    ON BlogPosts (IsPublished, PublishedAt DESC);

  CREATE INDEX IX_BlogPosts_Slug ON BlogPosts (Slug);
END
GO
