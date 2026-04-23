/**
 * Build blog sitemap XML (published posts + index).
 * @param {string} origin - e.g. https://www.glowra.com (no trailing slash)
 * @param {Array<{ slug: string, publishedAt: Date }>} posts - published only, sorted newest first optional
 * @returns {string}
 */
function buildBlogSitemapXml(origin, posts) {
  const base = String(origin || '').replace(/\/$/, '');
  const urls = [
    { loc: `${base}/blog`, changefreq: 'weekly', priority: '0.8' },
    ...posts.map((p) => ({
      loc: `${base}/blog/${encodeURIComponent(p.slug)}`,
      lastmod: p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : undefined,
      changefreq: 'monthly',
      priority: '0.7'
    }))
  ];

  const urlBlocks = urls
    .map((u) => {
      const lastmodLine = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '';
      return `  <url>
    <loc>${escapeXml(u.loc)}</loc>${lastmodLine}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlBlocks}
</urlset>`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { buildBlogSitemapXml, escapeXml };
