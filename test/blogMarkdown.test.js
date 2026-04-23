const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAndRenderBlogMarkdown,
  validateFrontmatter,
  normalizeSlug
} = require('../utils/blogMarkdown');

describe('blogMarkdown', () => {
  test('normalizeSlug produces URL-safe slug', () => {
    assert.equal(normalizeSlug('  Hello World!  '), 'hello-world');
    assert.equal(normalizeSlug('already-good'), 'already-good');
  });

  test('validateFrontmatter returns errors for missing fields', () => {
    const r = validateFrontmatter({});
    assert.ok(r.errors.length > 0);
    assert.ok(r.errors.some((e) => e.field === 'title'));
    assert.ok(r.errors.some((e) => e.field === 'slug'));
  });

  test('parseAndRenderBlogMarkdown accepts valid frontmatter and renders HTML', () => {
    const md = `---
title: Hello
date: 2026-01-15
slug: hello-post
description: A short summary for SEO.
---

# Hi

[link](https://example.com/page)`;
    const r = parseAndRenderBlogMarkdown(md);
    assert.equal(r.ok, true);
    assert.equal(r.slug, 'hello-post');
    assert.equal(r.title, 'Hello');
    assert.match(r.html, /<h1[^>]*>Hi<\/h1>/);
    assert.match(r.html, /href="https:\/\/example.com\/page"/);
  });

  test('parseAndRenderBlogMarkdown rejects invalid date', () => {
    const md = `---
title: Hello
date: not-a-date
slug: x
description: d
---
body`;
    const r = parseAndRenderBlogMarkdown(md);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.field === 'date'));
  });

  test('sanitized HTML strips script injection', () => {
    const md = `---
title: T
date: 2026-02-01
slug: inj
description: D
---
<script>alert(1)</script>
[xss](javascript:alert(1))`;
    const r = parseAndRenderBlogMarkdown(md);
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.html, /<script/i);
    assert.doesNotMatch(r.html, /javascript:/i);
  });
});
