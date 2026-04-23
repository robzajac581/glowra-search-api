const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildBlogSitemapXml } = require('../utils/blogSitemap');

describe('blogSitemap', () => {
  test('buildBlogSitemapXml includes blog index and post URLs', () => {
    const xml = buildBlogSitemapXml('https://www.example.com', [
      { slug: 'first-post', publishedAt: new Date('2026-03-01T12:00:00Z') }
    ]);
    assert.match(xml, /<loc>https:\/\/www\.example\.com\/blog<\/loc>/);
    assert.match(xml, /<loc>https:\/\/www\.example\.com\/blog\/first-post<\/loc>/);
    assert.match(xml, /<lastmod>2026-03-01<\/lastmod>/);
  });

  test('buildBlogSitemapXml encodes special characters in loc', () => {
    const xml = buildBlogSitemapXml('https://x.test', [{ slug: 'a&b', publishedAt: null }]);
    assert.match(xml, /\/blog\/a%26b/);
  });

  test('omitting posts leaves only index URL', () => {
    const xml = buildBlogSitemapXml('https://x.test', []);
    assert.match(xml, /\/blog<\/loc>/);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(locs.length, 1);
  });
});
