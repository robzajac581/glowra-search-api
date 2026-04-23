const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const blogPostService = require('../services/blogPostService');
const { BlogPostSlugConflictError, assertSlugAvailable, listPublishedSlugsForSitemap } =
  blogPostService;
const { db } = require('../db');

describe('blogPostService slug and sitemap', () => {
  test('assertSlugAvailable throws when slug is taken by another post', async () => {
    const orig = db.getConnection.bind(db);
    db.getConnection = async () => ({
      request() {
        const chain = {
          input() {
            return chain;
          },
          async query() {
            return { recordset: [{ BlogPostID: 99, Slug: 'taken-slug' }] };
          }
        };
        return chain;
      }
    });
    try {
      await assert.rejects(assertSlugAvailable.bind(null, 'taken-slug'), (err) => {
        assert.ok(err instanceof BlogPostSlugConflictError);
        return true;
      });
    } finally {
      db.getConnection = orig;
    }
  });

  test('assertSlugAvailable allows same slug when updating same post id', async () => {
    const orig = db.getConnection.bind(db);
    db.getConnection = async () => ({
      request() {
        const chain = {
          input() {
            return chain;
          },
          async query() {
            return { recordset: [{ BlogPostID: 42, Slug: 'same' }] };
          }
        };
        return chain;
      }
    });
    try {
      await assert.doesNotReject(() => assertSlugAvailable('same', 42));
    } finally {
      db.getConnection = orig;
    }
  });

  test('listPublishedSlugsForSitemap reflects published rows only (mock)', async () => {
    const orig = db.getConnection.bind(db);
    let call = 0;
    db.getConnection = async () => ({
      request() {
        const chain = {
          input() {
            return chain;
          },
          async query(q) {
            call += 1;
            if (String(q).includes('IsPublished = 1')) {
              return {
                recordset: [{ Slug: 'live-one', publishedAt: new Date('2026-04-01Z') }]
              };
            }
            return { recordset: [] };
          }
        };
        return chain;
      }
    });
    try {
      const first = await listPublishedSlugsForSitemap();
      assert.equal(first.length, 1);
      assert.equal(first[0].slug, 'live-one');

      db.getConnection = async () => ({
        request() {
          const chain = {
            input() {
              return chain;
            },
            async query() {
              return { recordset: [] };
            }
          };
          return chain;
        }
      });
      const afterDelete = await listPublishedSlugsForSitemap();
      assert.equal(afterDelete.length, 0);
    } finally {
      db.getConnection = orig;
    }
  });
});
