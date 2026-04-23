/**
 * Full HTML documents for crawler-friendly blog pages.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHost(origin) {
  return String(origin || '').replace(/\/$/, '');
}

/**
 * @param {object} opts
 * @param {string} opts.siteOrigin - https://www.glowra.com
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {string} opts.canonicalPath - /blog or /blog/my-slug
 * @param {string} [opts.slug]
 * @param {Date} [opts.publishedAt]
 * @param {Date} [opts.updatedAt]
 * @param {string} [opts.articleHtml] - sanitized inner HTML
 * @param {Array<{ slug: string, title: string, publishedAt: Date }>} [opts.listItems]
 */
function renderBlogHtmlDocument(opts) {
  const origin = stripHost(opts.siteOrigin);
  const canonicalUrl = `${origin}${opts.canonicalPath}`;
  const safeTitle = escapeHtml(opts.title);
  const safeDesc = escapeHtml(opts.description);
  const ogType = opts.articleHtml ? 'article' : 'website';

  let jsonLdScript = '';
  if (opts.articleHtml && opts.slug && opts.publishedAt) {
    const pub = new Date(opts.publishedAt);
    const mod = opts.updatedAt ? new Date(opts.updatedAt) : pub;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: opts.title,
      description: opts.description,
      url: canonicalUrl,
      datePublished: pub.toISOString(),
      dateModified: mod.toISOString(),
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl }
    };
    jsonLdScript = `<script type="application/ld+json">${escapeJsonLdScriptContent(
      JSON.stringify(jsonLd)
    )}</script>`;
  }

  const mainContent = opts.articleHtml
    ? `<article class="blog-post"><h1>${safeTitle}</h1><div class="blog-body">${opts.articleHtml}</div></article>`
    : renderPostListHtml(opts.listItems || [], origin);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="Glowra" />
  ${opts.articleHtml && opts.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(new Date(opts.publishedAt).toISOString())}" />` : ''}
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.5; max-width: 720px; margin: 0 auto; padding: 1.5rem; color: #111; }
    .blog-list { list-style: none; padding: 0; }
    .blog-list li { margin-bottom: 1rem; }
    .blog-list a { color: #0b5; font-weight: 600; }
    .blog-body img { max-width: 100%; height: auto; }
    pre { overflow: auto; padding: 1rem; background: #f6f6f6; border-radius: 6px; }
    code { font-family: ui-monospace, monospace; }
  </style>
  ${jsonLdScript}
</head>
<body>
  <header><a href="${escapeHtml(origin + '/blog')}">Glowra Blog</a></header>
  <main>
    ${mainContent}
  </main>
</body>
</html>`;
}

function escapeJsonLdScriptContent(json) {
  return json.replace(/</g, '\\u003c');
}

function renderPostListHtml(items, origin) {
  if (!items.length) {
    return '<p>No posts yet.</p>';
  }
  const lis = items
    .map((p) => {
      const href = `${origin}/blog/${encodeURIComponent(p.slug)}`;
      const t = escapeHtml(p.title);
      const d = new Date(p.publishedAt).toISOString().slice(0, 10);
      return `<li><a href="${escapeHtml(href)}">${t}</a> <time datetime="${d}">${d}</time></li>`;
    })
    .join('\n');
  return `<h1>Glowra Blog</h1><ul class="blog-list">${lis}</ul>`;
}

module.exports = { renderBlogHtmlDocument, escapeHtml, stripHost };
