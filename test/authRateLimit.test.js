// GLO-30: rate limiting on authentication endpoints.
// No database: adminService.login is stubbed.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-' + 'x'.repeat(32);

const { createAuthRateLimiter } = require('../clinic-management/middleware/authRateLimit');
const adminService = require('../clinic-management/services/adminService');
const adminRoutes = require('../clinic-management/routes/adminRoutes');

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

async function quiet(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

// App with a fake login: password "right" succeeds, anything else is 401.
// Client IP comes from the x-test-ip header so tests can simulate many IPs.
function buildLimitedApp(limiterOptions) {
  let clock = 0;
  const limiter = createAuthRateLimiter({
    windowMs: 1000,
    maxPerIp: 4,
    maxPerAccount: 2,
    ipKey: (req) => req.get('x-test-ip') || 'ip-default',
    now: () => clock,
    ...limiterOptions
  });
  const app = express();
  app.use(express.json());
  app.post('/login', limiter, (req, res) => {
    if (req.body.password === 'right') return res.json({ success: true });
    if (req.body.password === 'boom') return res.status(500).json({ success: false });
    res.status(401).json({ success: false });
  });
  return { app, limiter, advance: (ms) => { clock += ms; } };
}

function login(base, { email, password = 'wrong', ip }) {
  return fetch(base + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'x-test-ip': ip } : {}) },
    body: JSON.stringify({ email, password })
  });
}

test('per-account: failed attempts on one email are throttled even across IPs', async () => {
  const { app } = buildLimitedApp();
  await quiet(() => withServer(app, async (base) => {
    assert.strictEqual((await login(base, { email: 'a@x.com', ip: '1' })).status, 401);
    assert.strictEqual((await login(base, { email: ' A@X.com ', ip: '2' })).status, 401);
    const blocked = await login(base, { email: 'a@x.com', password: 'right', ip: '3' });
    assert.strictEqual(blocked.status, 429, 'correct password is still blocked once the account budget is spent');
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    // A different account from a fresh IP is unaffected.
    assert.strictEqual((await login(base, { email: 'b@x.com', ip: '4' })).status, 401);
  }));
});

test('per-IP: one IP cycling many emails is throttled', async () => {
  const { app } = buildLimitedApp();
  await quiet(() => withServer(app, async (base) => {
    for (let i = 0; i < 4; i++) {
      assert.strictEqual((await login(base, { email: `u${i}@x.com`, ip: '9' })).status, 401);
    }
    assert.strictEqual((await login(base, { email: 'fresh@x.com', ip: '9' })).status, 429);
    assert.strictEqual((await login(base, { email: 'fresh@x.com', ip: '10' })).status, 401);
  }));
});

test('limits reset after the window', async () => {
  const { app, advance } = buildLimitedApp();
  await quiet(() => withServer(app, async (base) => {
    await login(base, { email: 'a@x.com' });
    await login(base, { email: 'a@x.com' });
    assert.strictEqual((await login(base, { email: 'a@x.com' })).status, 429);
    advance(1001);
    assert.strictEqual((await login(base, { email: 'a@x.com', password: 'right' })).status, 200);
  }));
});

test('successful logins do not use up the budget', async () => {
  const { app } = buildLimitedApp();
  await withServer(app, async (base) => {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual((await login(base, { email: 'a@x.com', password: 'right' })).status, 200);
    }
    // A success also clears earlier failures for that account.
    await login(base, { email: 'a@x.com' });
    await login(base, { email: 'a@x.com', password: 'right' });
    assert.strictEqual((await login(base, { email: 'a@x.com' })).status, 401);
  });
});

test('parallel burst cannot slip past the account limit', async () => {
  const { app } = buildLimitedApp({ maxPerIp: 100 });
  await quiet(() => withServer(app, async (base) => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => login(base, { email: 'a@x.com', ip: String(i) }))
    );
    const statuses = results.map((r) => r.status);
    assert.strictEqual(statuses.filter((s) => s === 401).length, 2);
    assert.strictEqual(statuses.filter((s) => s === 429).length, 8);
  }));
});

test('tracked keys stay bounded', async () => {
  const { app, limiter } = buildLimitedApp({ maxKeys: 3, maxPerIp: 1000, maxPerAccount: 1000 });
  await quiet(() => withServer(app, async (base) => {
    const statuses = [];
    for (let i = 0; i < 20; i++) {
      statuses.push((await login(base, { email: `r${i}@x.com`, ip: String(i) })).status);
      const size = limiter.size();
      assert.ok(size.ip <= 3 && size.account <= 3, `map grew past maxKeys: ${JSON.stringify(size)}`);
    }
    // First 3 keys fit; the rest fail closed rather than evicting.
    assert.deepStrictEqual(statuses.slice(0, 3), [401, 401, 401]);
    assert.ok(statuses.slice(3).every((s) => s === 429));
  }));
});

test('a locked account stays locked while new keys flood in', async () => {
  const { app, limiter, advance } = buildLimitedApp({ maxKeys: 5, maxPerIp: 1000 });
  await quiet(() => withServer(app, async (base) => {
    await login(base, { email: 'target@x.com', ip: 'a' });
    await login(base, { email: 'target@x.com', ip: 'b' });
    assert.strictEqual((await login(base, { email: 'target@x.com', ip: 'c' })).status, 429);

    // Flood with fresh emails from spoofed IPs.
    for (let i = 0; i < 50; i++) await login(base, { email: `flood${i}@x.com`, ip: `f${i}` });
    assert.ok(limiter.size().account <= 5);

    assert.strictEqual(
      (await login(base, { email: 'target@x.com', password: 'right', ip: 'fresh' })).status,
      429,
      'flooding must not evict the locked account'
    );

    // After the window everything expires and the map has room again.
    advance(1001);
    assert.strictEqual((await login(base, { email: 'target@x.com', password: 'right', ip: 'fresh' })).status, 200);
  }));
});

test('server errors (5xx) are not counted as failed attempts', async () => {
  const { app } = buildLimitedApp();
  await withServer(app, async (base) => {
    for (let i = 0; i < 6; i++) {
      assert.strictEqual((await login(base, { email: 'a@x.com', password: 'boom' })).status, 500);
    }
    assert.strictEqual((await login(base, { email: 'a@x.com' })).status, 401);
  });
});

test('admin login route is rate limited (DB stubbed)', async () => {
  const original = adminService.login;
  let calls = 0;
  adminService.login = async () => { calls += 1; return { success: false, error: 'Invalid credentials' }; };
  adminRoutes.adminLoginLimiter.reset();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  try {
    await quiet(() => withServer(app, async (base) => {
      const attempt = () => fetch(base + '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'guess' })
      });
      for (let i = 0; i < 5; i++) assert.strictEqual((await attempt()).status, 401);
      const res = await attempt();
      assert.strictEqual(res.status, 429);
      assert.ok(res.headers.get('retry-after'));
      assert.strictEqual(calls, 5, 'blocked attempts never reach the password check');
    }));
  } finally {
    adminService.login = original;
    adminRoutes.adminLoginLimiter.reset();
  }
});
