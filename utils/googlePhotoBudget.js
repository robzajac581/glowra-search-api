/**
 * Code-side spend cap for Google Places Photo requests. (GLO-76)
 *
 * Every photo-proxy cache miss is one billable Places Photo request ($7 per
 * 1,000, 1,000 free a month). The on-disk cache is wiped by every Render
 * deploy, so a cold cache plus a crawler had nothing between it and the bill.
 *
 * This is a rolling-window counter. Each Google fetch must first call
 * tryAcquire(); once `limit` fetches have happened inside `windowMs`, it
 * returns false and the caller serves stale cache or a 503 instead of calling
 * Google. A Cloud console quota is still worth having as the backstop, but it
 * fails requests with errors; this degrades instead.
 *
 * The working count lives in memory (one Render instance), but every fetch is
 * also written to hourly buckets in SQL (utils/googlePhotoBudgetStore.js), and
 * hydrate() reloads them at boot. Without that, each deploy would reset the
 * count, and main deploys often. If the store is unavailable the breaker still
 * works, it just forgets across restarts.
 *
 * Config (read once at boot):
 *   GOOGLE_PHOTO_FETCH_LIMIT         max Google fetches per window (default 500; 0 blocks all)
 *   GOOGLE_PHOTO_FETCH_WINDOW_HOURS  window length in hours (default 24)
 * 500/day is about the ~400/day the search page needs after a cold deploy,
 * plus headroom, and caps the worst case near $105/month.
 */

const DEFAULT_LIMIT = 500;
const DEFAULT_WINDOW_HOURS = 24;

function parseNonNegativeInt(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function parsePositiveNumber(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createPhotoBudget({ limit, windowMs, now = Date.now, log = console, store = null } = {}) {
  let timestamps = []; // ascending fetch times inside the window
  let trippedLogged = false;

  function prune() {
    const cutoff = now() - windowMs;
    while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift();
  }

  return {
    /** True if a Google fetch may proceed now (and records it). */
    tryAcquire() {
      prune();
      if (timestamps.length >= limit) {
        if (!trippedLogged) {
          trippedLogged = true;
          log.warn(
            `[GLO-76] Google photo budget exhausted: ${limit} fetches in the last ` +
            `${windowMs / 3600000}h. Serving cache/placeholders until the window rolls.`
          );
        }
        return false;
      }
      trippedLogged = false;
      const t = now();
      timestamps.push(t);
      if (store) {
        // Fire and forget: persistence must never delay or fail a photo.
        Promise.resolve()
          .then(() => store.record(t))
          .catch((err) => log.warn(`[GLO-76] could not persist photo fetch: ${err.message}`));
      }
      return true;
    },

    /**
     * Reload fetches recorded by earlier processes. Call once at boot, before
     * serving traffic. Never throws: on failure the budget starts from zero.
     */
    async hydrate() {
      if (!store) return 0;
      try {
        const persisted = await store.load(windowMs, now());
        timestamps = persisted.concat(timestamps).filter(Number.isFinite).sort((a, b) => a - b);
        prune();
        return timestamps.length;
      } catch (err) {
        log.warn(`[GLO-76] could not load persisted photo budget, starting from 0: ${err.message}`);
        return 0;
      }
    },

    /** Seconds until one more fetch is allowed (0 if allowed now). */
    retryAfterSeconds() {
      prune();
      if (timestamps.length < limit) return 0;
      if (limit === 0) return Math.ceil(windowMs / 1000);
      return Math.max(1, Math.ceil((timestamps[0] + windowMs - now()) / 1000));
    },

    stats() {
      prune();
      return {
        limit,
        windowHours: windowMs / 3600000,
        used: timestamps.length,
        remaining: Math.max(0, limit - timestamps.length),
        exhausted: timestamps.length >= limit
      };
    }
  };
}

const photoBudget = createPhotoBudget({
  limit: parseNonNegativeInt(process.env.GOOGLE_PHOTO_FETCH_LIMIT, DEFAULT_LIMIT),
  windowMs: parsePositiveNumber(process.env.GOOGLE_PHOTO_FETCH_WINDOW_HOURS, DEFAULT_WINDOW_HOURS) * 3600000,
  store: require('./googlePhotoBudgetStore').sqlBucketStore
});

module.exports = {
  createPhotoBudget,
  photoBudget,
  parseNonNegativeInt,
  parsePositiveNumber,
  DEFAULT_LIMIT,
  DEFAULT_WINDOW_HOURS
};
