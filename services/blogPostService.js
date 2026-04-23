/**
 * Blog post persistence (MSSQL).
 */

const { db, sql } = require('../db');
const { parseAndRenderBlogMarkdown } = require('../utils/blogMarkdown');

class BlogPostSlugConflictError extends Error {
  constructor(slug) {
    super(`Slug is already in use: ${slug}`);
    this.name = 'BlogPostSlugConflictError';
    this.slug = slug;
    this.statusCode = 409;
  }
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.BlogPostID,
    slug: r.Slug,
    title: r.Title,
    description: r.Description,
    publishedAt: r.PublishedAt,
    markdown: r.MarkdownSource,
    html: r.HtmlContent,
    isPublished: !!r.IsPublished,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
    createdByAdminUserId: r.CreatedByAdminUserId
  };
}

async function getPool() {
  const pool = await db.getConnection();
  if (!pool) throw new Error('Could not establish database connection');
  return pool;
}

async function findBySlug(slug) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('slug', sql.NVarChar(255), slug)
    .query('SELECT * FROM BlogPosts WHERE Slug = @slug');
  return result.recordset[0] || null;
}

async function findById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM BlogPosts WHERE BlogPostID = @id');
  return result.recordset[0] || null;
}

async function assertSlugAvailable(slug, excludePostId = null) {
  const existing = await findBySlug(slug);
  if (!existing) return;
  if (excludePostId != null && existing.BlogPostID === excludePostId) return;
  throw new BlogPostSlugConflictError(slug);
}

/**
 * @param {{ page?: number, limit?: number }} opts
 */
async function listAdmin({ page = 1, limit = 20 } = {}) {
  const pool = await getPool();
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const listReq = pool.request();
  listReq.input('limit', sql.Int, limitNum);
  listReq.input('offset', sql.Int, offset);

  const rows = await listReq.query(`
    SELECT BlogPostID, Slug, Title, Description, PublishedAt, IsPublished, UpdatedAt, CreatedAt
    FROM BlogPosts
    ORDER BY UpdatedAt DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  const countResult = await pool.request().query('SELECT COUNT(*) AS total FROM BlogPosts');
  const total = countResult.recordset[0].total;

  return {
    posts: rows.recordset.map((r) => ({
      id: r.BlogPostID,
      slug: r.Slug,
      title: r.Title,
      description: r.Description,
      publishedAt: r.PublishedAt,
      isPublished: !!r.IsPublished,
      updatedAt: r.UpdatedAt,
      createdAt: r.CreatedAt
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

/**
 * @param {{ page?: number, limit?: number }} opts
 */
async function listPublished({ page = 1, limit = 20 } = {}) {
  const pool = await getPool();
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const listReq = pool.request();
  listReq.input('limit', sql.Int, limitNum);
  listReq.input('offset', sql.Int, offset);

  const rows = await listReq.query(`
    SELECT BlogPostID, Slug, Title, Description, PublishedAt, UpdatedAt
    FROM BlogPosts
    WHERE IsPublished = 1
    ORDER BY PublishedAt DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  const countResult = await pool.request().query(
    'SELECT COUNT(*) AS total FROM BlogPosts WHERE IsPublished = 1'
  );
  const total = countResult.recordset[0].total;

  return {
    posts: rows.recordset.map((r) => ({
      id: r.BlogPostID,
      slug: r.Slug,
      title: r.Title,
      description: r.Description,
      publishedAt: r.PublishedAt,
      updatedAt: r.UpdatedAt
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

async function listPublishedSlugsForSitemap() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT Slug, PublishedAt
    FROM BlogPosts
    WHERE IsPublished = 1
    ORDER BY PublishedAt DESC
  `);
  return result.recordset.map((r) => ({ slug: r.Slug, publishedAt: r.PublishedAt }));
}

async function getAdminById(id) {
  const row = await findById(id);
  return mapRow(row);
}

async function getPublishedBySlug(slug) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('slug', sql.NVarChar(255), slug)
    .query(`
      SELECT * FROM BlogPosts
      WHERE Slug = @slug AND IsPublished = 1
    `);
  return mapRow(result.recordset[0] || null);
}

/**
 * @param {string} markdownSource
 * @param {boolean} isPublished
 * @param {number|null} adminUserId
 */
async function createPost(markdownSource, isPublished, adminUserId = null) {
  const parsed = parseAndRenderBlogMarkdown(markdownSource);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  await assertSlugAvailable(parsed.slug);

  const pool = await getPool();
  const insert = await pool
    .request()
    .input('slug', sql.NVarChar(255), parsed.slug)
    .input('title', sql.NVarChar(500), parsed.title)
    .input('description', sql.NVarChar(2000), parsed.description)
    .input('publishedAt', sql.DateTime2, parsed.publishedAt)
    .input('markdown', sql.NVarChar(sql.MAX), parsed.markdownSource)
    .input('html', sql.NVarChar(sql.MAX), parsed.html)
    .input('isPublished', sql.Bit, isPublished ? 1 : 0)
    .input('adminUserId', sql.Int, adminUserId)
    .query(`
      INSERT INTO BlogPosts (
        Slug, Title, Description, PublishedAt, MarkdownSource, HtmlContent, IsPublished, CreatedByAdminUserId
      )
      OUTPUT INSERTED.BlogPostID
      VALUES (
        @slug, @title, @description, @publishedAt, @markdown, @html, @isPublished, @adminUserId
      )
    `);

  const newId = insert.recordset[0].BlogPostID;
  return { ok: true, id: newId };
}

/**
 * @param {number} id
 * @param {string} markdownSource
 * @param {boolean} isPublished
 */
async function updatePost(id, markdownSource, isPublished) {
  const existing = await findById(id);
  if (!existing) {
    return { ok: false, notFound: true };
  }

  const parsed = parseAndRenderBlogMarkdown(markdownSource);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  try {
    await assertSlugAvailable(parsed.slug, id);
  } catch (e) {
    if (e instanceof BlogPostSlugConflictError) {
      return { ok: false, slugConflict: true, slug: parsed.slug };
    }
    throw e;
  }

  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('slug', sql.NVarChar(255), parsed.slug)
    .input('title', sql.NVarChar(500), parsed.title)
    .input('description', sql.NVarChar(2000), parsed.description)
    .input('publishedAt', sql.DateTime2, parsed.publishedAt)
    .input('markdown', sql.NVarChar(sql.MAX), parsed.markdownSource)
    .input('html', sql.NVarChar(sql.MAX), parsed.html)
    .input('isPublished', sql.Bit, isPublished ? 1 : 0)
    .query(`
      UPDATE BlogPosts SET
        Slug = @slug,
        Title = @title,
        Description = @description,
        PublishedAt = @publishedAt,
        MarkdownSource = @markdown,
        HtmlContent = @html,
        IsPublished = @isPublished,
        UpdatedAt = SYSUTCDATETIME()
      WHERE BlogPostID = @id
    `);

  return { ok: true };
}

async function deletePost(id) {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.Int, id).query(`
    DELETE FROM BlogPosts WHERE BlogPostID = @id
  `);
  return result.rowsAffected[0] > 0;
}

module.exports = {
  BlogPostSlugConflictError,
  listAdmin,
  listPublished,
  listPublishedSlugsForSitemap,
  getAdminById,
  getPublishedBySlug,
  createPost,
  updatePost,
  deletePost,
  findBySlug,
  assertSlugAvailable
};
