/**
 * Admin blog CRUD — mounted at /api/admin/blog (paths under /posts).
 */

const express = require('express');
const multer = require('multer');
const { requireAdminAuth } = require('../clinic-management/middleware/adminAuth');
const blogPostService = require('../services/blogPostService');
const { BlogPostSlugConflictError } = require('../services/blogPostService');
const { triggerFrontendDeploy } = require('../utils/deployWebhook');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (
      name.endsWith('.md') ||
      file.mimetype === 'text/markdown' ||
      file.mimetype === 'text/x-markdown'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .md uploads are allowed'));
    }
  }
});

const router = express.Router();

router.use(requireAdminAuth);

function uploadMdSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        error: 'Upload error',
        details: [{ field: 'file', message: err.message }]
      });
    }
    return res.status(400).json({
      success: false,
      error: 'Invalid file',
      details: [{ field: 'file', message: err.message || 'Invalid upload' }]
    });
  });
}

function parsePublished(raw) {
  if (raw === undefined || raw === null || raw === '') return true;
  const v = String(raw).toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

/**
 * @swagger
 * /api/admin/blog/posts:
 *   get:
 *     summary: List blog posts (admin)
 *     tags: [Admin Blog]
 *     security:
 *       - bearerAuth: []
 */
router.get('/posts', async (req, res) => {
  try {
    const { page, limit } = req.query;
    const data = await blogPostService.listAdmin({ page, limit });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Admin list blog posts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/admin/blog/posts/{id}:
 *   get:
 *     summary: Get blog post by id (admin, includes markdown)
 *     tags: [Admin Blog]
 *     security:
 *       - bearerAuth: []
 */
router.get('/posts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid id',
        details: [{ field: 'id', message: 'id must be a number' }]
      });
    }
    const post = await blogPostService.getAdminById(id);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    res.json({ success: true, post });
  } catch (error) {
    console.error('Admin get blog post error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/admin/blog/posts:
 *   post:
 *     summary: Create blog post from JSON markdown or .md upload
 *     tags: [Admin Blog]
 *     security:
 *       - bearerAuth: []
 */
router.post('/posts', uploadMdSingle, async (req, res) => {
  try {
    let markdown = req.body?.markdown;
    if (req.file) {
      markdown = req.file.buffer.toString('utf8');
    }
    const isPublished = parsePublished(req.body?.published);
    const result = await blogPostService.createPost(
      markdown,
      isPublished,
      req.adminUser.adminUserId
    );
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.errors
      });
    }
    const post = await blogPostService.getAdminById(result.id);
    if (post?.isPublished) {
      await triggerFrontendDeploy('blog_post_created', {
        blogPostId: post.id,
        slug: post.slug,
        action: 'create'
      });
    }
    res.status(201).json({ success: true, post });
  } catch (error) {
    if (error instanceof BlogPostSlugConflictError) {
      return res.status(409).json({
        success: false,
        error: 'Slug already in use',
        details: [{ field: 'slug', message: `The slug "${error.slug}" is already taken` }]
      });
    }
    console.error('Admin create blog post error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/admin/blog/posts/{id}:
 *   put:
 *     summary: Update blog post
 *     tags: [Admin Blog]
 *     security:
 *       - bearerAuth: []
 */
router.put('/posts/:id', uploadMdSingle, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid id',
        details: [{ field: 'id', message: 'id must be a number' }]
      });
    }
    const existingPost = await blogPostService.getAdminById(id);
    if (!existingPost) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    let markdown = req.body?.markdown;
    if (req.file) {
      markdown = req.file.buffer.toString('utf8');
    }
    if (markdown === undefined && !req.file) {
      markdown = existingPost.markdown;
    }

    const isPublished = Object.prototype.hasOwnProperty.call(req.body || {}, 'published')
      ? parsePublished(req.body.published)
      : existingPost.isPublished;

    const result = await blogPostService.updatePost(id, markdown, isPublished);
    if (!result.ok && result.errors) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.errors
      });
    }
    if (result.slugConflict) {
      return res.status(409).json({
        success: false,
        error: 'Slug already in use',
        details: [{ field: 'slug', message: `The slug "${result.slug}" is already taken` }]
      });
    }
    const post = await blogPostService.getAdminById(id);
    if (post?.isPublished || existingPost.isPublished) {
      await triggerFrontendDeploy('blog_post_updated', {
        blogPostId: post?.id || existingPost.id,
        slug: post?.slug || existingPost.slug,
        action: 'update'
      });
    }
    res.json({ success: true, post });
  } catch (error) {
    console.error('Admin update blog post error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/admin/blog/posts/{id}:
 *   delete:
 *     summary: Delete blog post (unpublish immediately)
 *     tags: [Admin Blog]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/posts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid id',
        details: [{ field: 'id', message: 'id must be a number' }]
      });
    }
    const existingPost = await blogPostService.getAdminById(id);
    if (!existingPost) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    const deleted = await blogPostService.deletePost(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    if (existingPost.isPublished) {
      await triggerFrontendDeploy('blog_post_deleted', {
        blogPostId: existingPost.id,
        slug: existingPost.slug,
        action: 'delete'
      });
    }
    res.json({ success: true, deleted: true, id });
  } catch (error) {
    console.error('Admin delete blog post error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
