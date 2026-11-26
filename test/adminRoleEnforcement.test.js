// GLO-29: default-deny role enforcement on admin routes.
// No database or Google calls: every request here is rejected by the role
// guard before a handler runs.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-only-secret-' + 'x'.repeat(32);
process.env.JWT_SECRET = TEST_SECRET;

const adminAuth = require('../clinic-management/middleware/adminAuth');
const adminRoutes = require('../clinic-management/routes/adminRoutes');
const blogAdminRoutes = require('../routes/blogAdminRoutes');

function sign(payload, secret = TEST_SECRET) {
  return jwt.sign(payload, secret, { expiresIn: '5m' });
}

const ownerToken = sign({ adminUserId: 999, email: 'owner@example.com', role: 'clinic_owner' });
const noRoleToken = sign({ adminUserId: 998, email: 'norole@example.com' });

// Collect every route on a router as { method, path }.
function routesOf(router) {
  const out = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) {
      if (layer.route.methods[m]) out.push({ method: m.toUpperCase(), path: layer.route.path });
    }
  }
  return out;
}

function concretePath(path) {
  return path.replace(/:[A-Za-z]+/g, '1');
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/blog', blogAdminRoutes);
  app.use('/api/admin', adminRoutes);
  return app;
}

async function silenced(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

test('clinic_owner token gets 403 on every admin dashboard route', async () => {
  const routes = routesOf(adminRoutes).filter((r) => !(r.method === 'POST' && r.path === '/login'));
  assert.ok(routes.length >= 20, `expected the full admin route list, got ${routes.length}`);

  await withServer(buildApp(), async (base) => {
    for (const r of routes) {
      const res = await fetch(base + '/api/admin' + concretePath(r.path), {
        method: r.method,
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: r.method === 'GET' ? undefined : '{}'
      });
      assert.strictEqual(res.status, 403, `${r.method} /api/admin${r.path} returned ${res.status}`);
    }
  });
});

test('clinic_owner token gets 403 on every blog admin route', async () => {
  const routes = routesOf(blogAdminRoutes);
  assert.ok(routes.length >= 5);

  await withServer(buildApp(), async (base) => {
    for (const r of routes) {
      const res = await fetch(base + '/api/admin/blog' + concretePath(r.path), {
        method: r.method,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 403, `${r.method} /api/admin/blog${r.path} returned ${res.status}`);
    }
  });
});

test('token with no role claim gets 403; missing or bad token gets 401', async () => {
  await withServer(buildApp(), async (base) => {
    let res = await fetch(base + '/api/admin/stats', { headers: { Authorization: `Bearer ${noRoleToken}` } });
    assert.strictEqual(res.status, 403);

    res = await fetch(base + '/api/admin/stats');
    assert.strictEqual(res.status, 401);

    const forged = sign({ adminUserId: 1, role: 'superadmin' }, 'glowra-admin-jwt-secret-change-in-production');
    res = await fetch(base + '/api/admin/stats', { headers: { Authorization: `Bearer ${forged}` } });
    assert.strictEqual(res.status, 401, 'token signed with the old public default must be rejected');
  });
});

test('every existing admin route declares a role guard', () => {
  for (const router of [adminRoutes, blogAdminRoutes]) {
    let routerGuard = false;
    for (const layer of router.stack) {
      if (!layer.route) {
        if (layer.handle && layer.handle[adminAuth.ROLE_GUARD]) routerGuard = true;
        continue;
      }
      if (layer.route.path === '/login') continue;
      const guarded = routerGuard || layer.route.stack.some((l) => l.handle[adminAuth.ROLE_GUARD]);
      assert.ok(guarded, `${layer.route.path} has no role allowlist`);
    }
  }
});

test('admin and superadmin roles pass the guard', () => {
  const guard = adminAuth.requireRole(adminAuth.ADMIN_ROLES);
  for (const role of ['admin', 'superadmin']) {
    const req = { headers: { authorization: `Bearer ${sign({ adminUserId: 1, email: 'a@b.c', role })}` } };
    let passed = false;
    guard(req, { status() { throw new Error('should not respond'); } }, () => { passed = true; });
    assert.ok(passed, role);
    assert.strictEqual(req.adminUser.role, role);
  }
});

test('a route registered without an allowlist rejects every caller', async () => {
  const router = express.Router();
  router.get('/undeclared', (req, res) => res.json({ leaked: true }));
  router.get('/declared', adminAuth.requireRole(['admin']), (req, res) => res.json({ ok: true }));
  router.get('/legacy', adminAuth.requireAdminAuth, (req, res) => res.json({ leaked: true }));
  router.get('/empty', adminAuth.requireRole([]), (req, res) => res.json({ leaked: true }));

  const locked = await silenced(() => adminAuth.enforceDeclaredRoles(router));
  // /empty has a guard, but its empty allowlist denies everyone at request time.
  assert.deepStrictEqual(locked, ['GET /undeclared', 'GET /legacy']);

  const app = express();
  app.use(router);
  const adminToken = sign({ adminUserId: 1, role: 'admin' });

  await silenced(() =>
    withServer(app, async (base) => {
      for (const path of ['/undeclared', '/legacy', '/empty']) {
        for (const headers of [{}, { Authorization: `Bearer ${adminToken}` }]) {
          const res = await fetch(base + path, { headers });
          assert.strictEqual(res.status, 403, `${path} returned ${res.status}`);
          const body = await res.json();
          assert.ok(!body.leaked, `${path} ran its handler`);
        }
      }
      const ok = await fetch(base + '/declared', { headers: { Authorization: `Bearer ${adminToken}` } });
      assert.strictEqual(ok.status, 200);
    })
  );
});

test('JWT_SECRET is required: no fallback, old default refused', () => {
  const previous = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.throws(() => adminAuth.assertJwtSecretConfigured(), /JWT_SECRET is not set/);
    assert.throws(() => adminAuth.generateToken({ AdminUserID: 1, Email: 'a', Role: 'admin' }));

    process.env.JWT_SECRET = 'glowra-admin-jwt-secret-change-in-production';
    assert.throws(() => adminAuth.assertJwtSecretConfigured(), /public default/);

    process.env.JWT_SECRET = TEST_SECRET;
    assert.doesNotThrow(() => adminAuth.assertJwtSecretConfigured());
  } finally {
    process.env.JWT_SECRET = previous;
  }
});

test('adminAuth no longer exports the secret', () => {
  assert.strictEqual(adminAuth.JWT_SECRET, undefined);
});
