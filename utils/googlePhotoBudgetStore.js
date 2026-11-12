/**
 * Persists the Google photo budget (GLO-76) across restarts, as hourly
 * buckets in dbo.GooglePhotoFetchBuckets (migrations/createGooglePhotoFetchBuckets.sql).
 *
 * Hourly buckets, not one row per fetch: at most ~500 upserts a day and ~24
 * rows a day, which a 5-DTU database does not notice.
 *
 * Reloaded fetches are placed at the END of their bucket, so after a restart
 * they age out up to an hour later than they really happened. That errs toward
 * spending less, which is the point of the breaker.
 *
 * If the table does not exist yet (migration not run), the store disables
 * itself with one warning and the breaker falls back to memory only.
 */

const { db, sql } = require('../db');

const HOUR = 3600000;
const RETAIN_DAYS = 7;
const SQL_INVALID_OBJECT_NAME = 208;

function bucketStartOf(timeMs) {
  return Math.floor(timeMs / HOUR) * HOUR;
}

/** Expand bucket rows into one timestamp per fetch, each at its bucket's end. */
function bucketsToTimestamps(rows, nowMs) {
  const out = [];
  for (const row of rows) {
    const start = new Date(row.BucketStart).getTime();
    const count = Number(row.FetchCount) || 0;
    const t = Math.min(start + HOUR - 1, nowMs);
    for (let i = 0; i < count; i++) out.push(t);
  }
  return out;
}

function createSqlBucketStore({ getPool = () => db.getConnection(), log = console } = {}) {
  let disabled = false;

  function handle(err) {
    if (err && (err.number === SQL_INVALID_OBJECT_NAME || /Invalid object name/i.test(err.message || ''))) {
      disabled = true;
      log.warn('[GLO-76] dbo.GooglePhotoFetchBuckets is missing; photo budget will not survive restarts. ' +
        'Run migrations/createGooglePhotoFetchBuckets.sql.');
      return;
    }
    throw err;
  }

  return {
    async record(timeMs) {
      if (disabled) return;
      try {
        const pool = await getPool();
        await pool.request()
          .input('bucket', sql.DateTime2, new Date(bucketStartOf(timeMs)))
          .query(`
            UPDATE dbo.GooglePhotoFetchBuckets SET FetchCount = FetchCount + 1 WHERE BucketStart = @bucket;
            IF @@ROWCOUNT = 0
              INSERT INTO dbo.GooglePhotoFetchBuckets (BucketStart, FetchCount) VALUES (@bucket, 1);
          `);
      } catch (err) {
        handle(err);
      }
    },

    async load(windowMs, nowMs) {
      if (disabled) return [];
      try {
        const pool = await getPool();
        const result = await pool.request()
          .input('from', sql.DateTime2, new Date(bucketStartOf(nowMs - windowMs)))
          .input('purgeBefore', sql.DateTime2, new Date(nowMs - RETAIN_DAYS * 24 * HOUR))
          .query(`
            DELETE FROM dbo.GooglePhotoFetchBuckets WHERE BucketStart < @purgeBefore;
            SELECT BucketStart, FetchCount FROM dbo.GooglePhotoFetchBuckets WHERE BucketStart >= @from;
          `);
        return bucketsToTimestamps(result.recordset, nowMs);
      } catch (err) {
        handle(err);
        return [];
      }
    }
  };
}

module.exports = {
  createSqlBucketStore,
  sqlBucketStore: createSqlBucketStore(),
  bucketStartOf,
  bucketsToTimestamps
};
