/**
 * Crawler-facing blog HTML and sitemap (not under /api).
 */

const express = require('express');
const blogPostService = require('../services/blogPostService');
const { renderBlogHtmlDocument } = require('../utils/blogPageHtml');
const { buildBlogSitemapXml } = require('../utils/blogSitemap');

const router = express.Router();

function getSiteOrigin(req) {
  if (process.env.PUBLIC_SITE_URL) {
    return String(process.env.PUBLIC_SITE_URL).replace(/\/$/, '');
  }
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

function renderNotFoundPage(siteOrigin, title, message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${title}</title></head>
<body><p>${message}</p><a href="${siteOrigin}/blog">Back to blog</a></body></html>`;
}

router.get('/sitemap-blog.xml', async (req, res) => {
  try {
    const posts = await blogPostService.listPublishedSlugsForSitemap();
    const xml = buildBlogSitemapXml(getSiteOrigin(req), posts);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(xml);
  } catch (error) {
    console.error('Blog sitemap error:', error);
    res.status(500).type('text/plain').send('Sitemap error');
  }
});

router.get('/blog', async (req, res) => {
  try {
    const { posts } = await blogPostService.listPublished({ page: 1, limit: 500 });
    const siteOrigin = getSiteOrigin(req);
    const html = renderBlogHtmlDocument({
      siteOrigin,
      title: 'Blog | Glowra',
      description: 'Articles and updates from Glowra about aesthetic care and finding trusted providers.',
      canonicalPath: '/blog',
      listItems: posts.map((p) => ({
        slug: p.slug,
        title: p.title,
        publishedAt: p.publishedAt
      }))
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(html);
  } catch (error) {
    console.error('Blog index HTML error:', error);
    res.status(500).type('text/plain').send('Server error');
  }
});

router.get('/blog/:slug', async (req, res) => {
  try {
    const post = await blogPostService.getPublishedBySlug(req.params.slug);
    const siteOrigin = getSiteOrigin(req);
    if (!post) {
      return res
        .status(404)
        .type('html')
        .send(
          renderNotFoundPage(
            siteOrigin,
            'Not found | Glowra',
            'This post could not be found.'
          )
        );
    }
    const html = renderBlogHtmlDocument({
      siteOrigin,
      title: `${post.title} | Glowra Blog`,
      description: post.description,
      canonicalPath: `/blog/${encodeURIComponent(post.slug)}`,
      slug: post.slug,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      articleHtml: post.html
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(html);
  } catch (error) {
    console.error('Blog post HTML error:', error);
    res.status(500).type('text/plain').send('Server error');
  }
});

module.exports = router;
