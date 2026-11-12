/**
 * GLO-76: the photo proxy must stop calling Google (a billed request) once the
 * configured budget is spent, and resume as the rolling window moves.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  createPhotoBudget,
  parseNonNegativeInt,
  parsePositiveNumber
} = require('../utils/googlePhotoBudget');

const HOUR = 3600000;
const quietLog = { warn: () => {} };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('allows exactly `limit` fetches in a window, then refuses', () => {
  const c = clock();
  const b = createPhotoBudget({ limit: 3, windowMs: 24 * HOUR, now: c.now, log: quietLog });
  assert.deepStrictEqual([b.tryAcquire(), b.tryAcquire(), b.tryAcquire()], [true, true, true]);
  assert.strictEqual(b.tryAcquire(), false);
  assert.strictEqual(b.tryAcquire(), false);
  assert.deepStrictEqual(b.stats(), { limit: 3, windowHours: 24, used: 3, remaining: 0, exhausted: true });
});

test('refused attempts are not counted as spend', () => {
  const c = clock();
  const b = createPhotoBudget({ limit: 1, windowMs: HOUR, now: c.now, log: quietLog });
  b.tryAcquire();
  for (let i = 0; i < 50; i++) b.tryAcquire();
  assert.strictEqual(b.stats().used, 1);
});

test('the window rolls: capacity returns as old fetches age out', () => {
  const c = clock();
  const b = createPhotoBudget({ limit: 2, windowMs: HOUR, now: c.now, log: quietLog });
  b.tryAcquire();               // t=0
  c.advance(30 * 60000);
  b.tryAcquire();               // t=30m
  assert.strictEqual(b.tryAcquire(), false);
  assert.strictEqual(b.retryAfterSeconds(), 30 * 60);

  c.advance(30 * 60000);        // t=60m: first fetch has aged out
  assert.strictEqual(b.retryAfterSeconds(), 0);
  assert.strictEqual(b.tryAcquire(), true);
  assert.strictEqual(b.tryAcquire(), false);
});

test('limit 0 blocks every fetch', () => {
  const c = clock();
  const b = createPhotoBudget({ limit: 0, windowMs: HOUR, now: c.now, log: quietLog });
  assert.strictEqual(b.tryAcquire(), false);
  assert.strictEqual(b.retryAfterSeconds(), 3600);
});

test('logs once per exhaustion, not once per refused request', () => {
  const c = clock();
  const warnings = [];
  const b = createPhotoBudget({ limit: 1, windowMs: HOUR, now: c.now, log: { warn: (m) => warnings.push(m) } });
  b.tryAcquire();
  b.tryAcquire();
  b.tryAcquire();
  assert.strictEqual(warnings.length, 1);
  c.advance(HOUR);
  b.tryAcquire();               // allowed again, resets the latch
  b.tryAcquire();               // exhausted again
  assert.strictEqual(warnings.length, 2);
});

test('env parsing falls back to defaults on junk, keeps 0 as a real limit', () => {
  assert.strictEqual(parseNonNegativeInt(undefined, 500), 500);
  assert.strictEqual(parseNonNegativeInt('', 500), 500);
  assert.strictEqual(parseNonNegativeInt('abc', 500), 500);
  assert.strictEqual(parseNonNegativeInt('-5', 500), 500);
  assert.strictEqual(parseNonNegativeInt('2.5', 500), 500);
  assert.strictEqual(parseNonNegativeInt('0', 500), 0);
  assert.strictEqual(parseNonNegativeInt('1200', 500), 1200);
  assert.strictEqual(parsePositiveNumber('0', 24), 24);
  assert.strictEqual(parsePositiveNumber('6', 24), 6);
});

// --- Persistence across restarts (deploys) -------------------------------

const {
  createSqlBucketStore,
  bucketStartOf,
  bucketsToTimestamps
} = require('../utils/googlePhotoBudgetStore');

/** In-memory stand-in for the SQL bucket store. */
function memoryStore() {
  const buckets = new Map();
  return {
    buckets,
    async record(t) {
      const k = bucketStartOf(t);
      buckets.set(k, (buckets.get(k) || 0) + 1);
    },
    async load(windowMs, nowMs) {
      const rows = [...buckets].filter(([k]) => k >= bucketStartOf(nowMs - windowMs))
        .map(([k, n]) => ({ BucketStart: new Date(k), FetchCount: n }));
      return bucketsToTimestamps(rows, nowMs);
    }
  };
}

const flush = () => new Promise((r) => setImmediate(r));

test('a restart does not reset the budget', async () => {
  const c = clock(10 * HOUR);
  const store = memoryStore();
  const before = createPhotoBudget({ limit: 3, windowMs: 24 * HOUR, now: c.now, log: quietLog, store });
  before.tryAcquire();
  before.tryAcquire();
  await flush();

  // "Deploy": a fresh process with an empty in-memory count.
  const after = createPhotoBudget({ limit: 3, windowMs: 24 * HOUR, now: c.now, log: quietLog, store });
  assert.strictEqual(await after.hydrate(), 2);
  assert.strictEqual(after.tryAcquire(), true);
  assert.strictEqual(after.tryAcquire(), false);
});

test('reloaded fetches age out at the end of their hour, never early', async () => {
  const c = clock(10 * HOUR + 5 * 60000); // 10:05
  const store = memoryStore();
  const a = createPhotoBudget({ limit: 1, windowMs: 2 * HOUR, now: c.now, log: quietLog, store });
  a.tryAcquire();
  await flush();

  c.advance(2 * HOUR); // 12:05: the real fetch is exactly 2h old
  const b = createPhotoBudget({ limit: 1, windowMs: 2 * HOUR, now: c.now, log: quietLog, store });
  await b.hydrate();
  assert.strictEqual(b.tryAcquire(), false, 'still counted until the end of its bucket');

  c.advance(55 * 60000); // 13:00, past 10:59:59.999 + 2h
  assert.strictEqual(b.tryAcquire(), true);
});

test('a failing store never blocks or throws', async () => {
  const c = clock();
  const warnings = [];
  const broken = {
    record: async () => { throw new Error('db down'); },
    load: async () => { throw new Error('db down'); }
  };
  const b = createPhotoBudget({ limit: 2, windowMs: HOUR, now: c.now, log: { warn: (m) => warnings.push(m) }, store: broken });
  assert.strictEqual(await b.hydrate(), 0);
  assert.strictEqual(b.tryAcquire(), true);
  await flush();
  assert.ok(warnings.some((w) => w.includes('could not persist')));
});

test('SQL store disables itself with one warning when the table is missing', async () => {
  const warnings = [];
  let queries = 0;
  const missing = Object.assign(new Error("Invalid object name 'dbo.GooglePhotoFetchBuckets'."), { number: 208 });
  const store = createSqlBucketStore({
    getPool: async () => ({
      request: () => ({ input() { return this; }, query: async () => { queries++; throw missing; } })
    }),
    log: { warn: (m) => warnings.push(m) }
  });
  assert.deepStrictEqual(await store.load(HOUR, Date.now()), []);
  await store.record(Date.now());
  await store.record(Date.now());
  assert.strictEqual(queries, 1, 'stops querying once it knows the table is absent');
  assert.strictEqual(warnings.length, 1);
});
