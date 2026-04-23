const matter = require('gray-matter');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const SLUG_MAX = 255;
const TITLE_MAX = 500;
const DESCRIPTION_MAX = 2000;

const SANITIZE_OPTIONS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'figure',
    'figcaption',
    'hr',
    'span',
    'div',
    'pre',
    'code',
    'br'
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    a: ['href', 'name', 'target', 'rel'],
    code: ['class'],
    span: ['class'],
    div: ['class'],
    pre: ['class'],
    p: ['class'],
    h1: ['id'],
    h2: ['id'],
    h3: ['id'],
    h4: ['id'],
    h5: ['id'],
    h6: ['id']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false
};

/**
 * Normalize slug: lowercase, hyphen-separated, URL-safe.
 * @param {string} raw
 * @returns {string}
 */
function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse frontmatter date to a Date (UTC-safe for ISO strings).
 * @param {unknown} value
 * @returns {Date|null}
 */
function parseFrontmatterDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Validate frontmatter fields; returns array of { field, message }.
 * @param {Record<string, unknown>} data
 * @returns {{ errors: Array<{ field: string, message: string }>, slug: string, title: string, description: string, publishedAt: Date } | null}
 */
function validateFrontmatter(data) {
  const errors = [];
  const title = data.title != null ? String(data.title).trim() : '';
  const description = data.description != null ? String(data.description).trim() : '';
  const slug = normalizeSlug(data.slug != null ? String(data.slug) : '');

  if (!title) errors.push({ field: 'title', message: 'title is required' });
  else if (title.length > TITLE_MAX) {
    errors.push({ field: 'title', message: `title must be at most ${TITLE_MAX} characters` });
  }

  if (!description) errors.push({ field: 'description', message: 'description is required' });
  else if (description.length > DESCRIPTION_MAX) {
    errors.push({
      field: 'description',
      message: `description must be at most ${DESCRIPTION_MAX} characters`
    });
  }

  if (!slug) errors.push({ field: 'slug', message: 'slug is required and must be URL-safe' });
  else if (slug.length > SLUG_MAX) {
    errors.push({ field: 'slug', message: `slug must be at most ${SLUG_MAX} characters` });
  }

  const publishedAt = parseFrontmatterDate(data.date);
  if (!publishedAt) {
    errors.push({ field: 'date', message: 'date is required and must be a valid date' });
  }

  if (errors.length) return { errors, slug: '', title: '', description: '', publishedAt: null };

  return { errors: [], slug, title, description, publishedAt };
}

/**
 * Parse full markdown document (YAML frontmatter + body).
 * @param {string} markdownSource
 * @returns {{ ok: true, markdownSource: string, slug: string, title: string, description: string, publishedAt: Date, html: string } | { ok: false, errors: Array<{ field: string, message: string }> }}
 */
function parseAndRenderBlogMarkdown(markdownSource) {
  if (markdownSource == null || String(markdownSource).trim() === '') {
    return { ok: false, errors: [{ field: 'markdown', message: 'markdown content is required' }] };
  }

  let parsed;
  try {
    parsed = matter(String(markdownSource));
  } catch (e) {
    return {
      ok: false,
      errors: [{ field: 'markdown', message: `Invalid frontmatter or markdown: ${e.message}` }]
    };
  }

  const fm = validateFrontmatter(parsed.data || {});
  if (fm.errors.length) {
    return { ok: false, errors: fm.errors };
  }

  const rawHtml = marked.parse(parsed.content || '', { async: false });
  const html = sanitizeHtml(rawHtml, SANITIZE_OPTIONS);

  return {
    ok: true,
    markdownSource: String(markdownSource),
    slug: fm.slug,
    title: fm.title,
    description: fm.description,
    publishedAt: fm.publishedAt,
    html
  };
}

module.exports = {
  normalizeSlug,
  validateFrontmatter,
  parseAndRenderBlogMarkdown,
  parseFrontmatterDate,
  SLUG_MAX,
  TITLE_MAX,
  DESCRIPTION_MAX
};
