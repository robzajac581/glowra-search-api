/**
 * Public blog JSON API — mounted at /api/blog
 */

const express = require('express');
const blogPostService = require('../services/blogPostService');

const router = express.Router();

const mapPublishedPost = (post) => ({
  id: post.id,
  slug: post.slug,
  title: post.title,
  description: post.description,
  date: post.publishedAt,
  publishedAt: post.publishedAt,
  updatedAt: post.updatedAt,
  html: post.html
});

const handleListPublished = async (req, res) => {
  const { page, limit } = req.query;
  const data = await blogPostService.listPublished({ page, limit });
  return res.json({
    success: true,
    posts: data.posts.map(mapPublishedPost),
    pagination: data.pagination
  });
};

/**
 * @swagger
 * /api/blog/posts:
 *   get:
 *     summary: List published blog posts
 *     tags: [Blog]
 */
router.get('/posts', async (req, res) => {
  try {
    await handleListPublished(req, res);
  } catch (error) {
    console.error('Public list blog posts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Backward/forward compatible endpoint expected by FE build pipeline.
 * Mounted either as /api/blog-posts/published or /api/blog/published.
 */
router.get('/published', async (req, res) => {
  try {
    await handleListPublished(req, res);
  } catch (error) {
    console.error('Public list blog posts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/blog/posts/{slug}:
 *   get:
 *     summary: Get published post by slug (includes rendered HTML)
 *     tags: [Blog]
 */
router.get('/posts/:slug', async (req, res) => {
  try {
    const post = await blogPostService.getPublishedBySlug(req.params.slug);
    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }
    res.json({
      success: true,
      post: mapPublishedPost(post)
    });
  } catch (error) {
    console.error('Public get blog post error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
