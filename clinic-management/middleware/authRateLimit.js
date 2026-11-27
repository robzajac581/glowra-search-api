/**
 * GLO-30: in-process rate limiting for authentication endpoints.
 *
 * Every attempt counts against two fixed-window budgets: one per client IP
 * and one per account (normalized email). Only auth failures (400 or 401)
 * are kept. Any other response (success, 5xx outage, etc.) refunds exactly
 * this request's own count, so it never wipes failures made by other
 * requests. When either budget is spent the request gets 429 with a
 * Retry-After header, before the handler runs.
 *
 * Counters are counted up front (not on response) so a burst of parallel
 * requests cannot slip past the limit.
 *
 * State is in memory, per process. That is enough for one Render instance;
 * a restart clears it. No Redis or other infrastructure.
 *
 * To protect another auth endpoint (owner login, password reset, claim):
 *   const limiter = createAuthRateLimiter({ name: 'owner-login' });
 *   router.post('/owner/login', limiter, handler);
 * Use a separate limiter (own name) per endpoint so budgets don't mix.
 */

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PER_IP = 20;
const DEFAULT_MAX_PER_ACCOUNT = 5;
// Bound memory: an attacker cycling random emails or IPs must not grow the
// maps without limit. When a map is full of live entries, attempts with a
// new key get 429 until entries expire (fail closed).
const DEFAULT_MAX_KEYS = 10000;

function defaultAccountKey(req) {
  const email = req.body && req.body.email;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return normalized || null;
}

// Where the client IP sits in X-Forwarded-For, counted from the right.
//
// app.js sets `trust proxy` to true, so req.ip is the LEFT-most XFF value,
// which the client controls. This limiter ignores req.ip and reads XFF from
// the right instead, where only the proxies append.
//
// Render does not document its X-Forwarded-For handling (no mention in
// render.com/docs as of 2026-11-26). What is known, from secondhand sources:
//   - Render's proxy appends to an incoming XFF instead of replacing it
//     (Render feedback board, "Send the correct X-Forwarded-For":
//     https://feedback.render.com/features/p/send-the-correct-xforwardedfor).
//   - Requests pass Client -> Cloudflare -> Render proxy -> app, and XFF
//     arrives as "<client-supplied...>, <client IP>, <Cloudflare edge IP>"
//     (https://rohitpaulk.com/articles/render-rails-remote-ip).
// So the right-most entry is a Cloudflare edge, and the client IP that
// Cloudflare appended is 2nd from the right. If Render's chain changes, set
// `ipHopsFromRight` accordingly.
const DEFAULT_IP_HOPS_FROM_RIGHT = 2;

function createIpKey(hopsFromRight = DEFAULT_IP_HOPS_FROM_RIGHT) {
  return function ipKey(req) {
    const header = req.headers && req.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (typeof raw === 'string') {
      const hops = raw.split(',').map((h) => h.trim()).filter(Boolean);
      if (hops.length >= hopsFromRight) return hops[hops.length - hopsFromRight];
      // Fewer hops than expected: nothing was prepended, so the left-most
      // entry is the nearest real client we know of.
      if (hops.length > 0) return hops[0];
    }
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  };
}

const defaultIpKey = createIpKey();

class FixedWindowCounter {
  constructor({ windowMs, maxKeys, now }) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.resetAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * True if `key` is tracked already or there is room for a new key.
   * Never evicts a live entry: a full map of live entries fails closed, so
   * flooding new keys cannot push a locked account's counter out.
   */
  canTrack(key) {
    if (this.get(key)) return true;
    if (this.entries.size >= this.maxKeys) this.sweep();
    return this.entries.size < this.maxKeys;
  }

  // Callers must check canTrack(key) first.
  increment(key) {
    let entry = this.get(key);
    if (!entry) {
      entry = { count: 0, resetAt: this.now() + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    return entry;
  }

  decrement(key) {
    const entry = this.get(key);
    if (entry && entry.count > 0) entry.count -= 1;
  }

  sweep() {
    const t = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= t) this.entries.delete(key);
    }
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.name] - label used in logs
 * @param {number} [options.windowMs] - window length (default 15 minutes)
 * @param {number} [options.maxPerIp] - failed attempts per IP per window (default 20)
 * @param {number} [options.maxPerAccount] - failed attempts per account per window (default 5)
 * @param {(req) => string|null} [options.accountKey] - account identifier; default req.body.email
 * @param {(req) => string} [options.ipKey] - client identifier; default reads X-Forwarded-For from the right
 * @param {number} [options.ipHopsFromRight] - client position in X-Forwarded-For, from the right (default 2)
 * @param {number} [options.maxKeys] - cap on tracked keys per map
 * @param {() => number} [options.now] - clock, for tests
 * @returns {import('express').RequestHandler & { reset: () => void, size: () => { ip: number, account: number } }}
 */
function createAuthRateLimiter(options = {}) {
  const {
    name = 'auth',
    windowMs = DEFAULT_WINDOW_MS,
    maxPerIp = DEFAULT_MAX_PER_IP,
    maxPerAccount = DEFAULT_MAX_PER_ACCOUNT,
    accountKey = defaultAccountKey,
    ipHopsFromRight,
    ipKey = ipHopsFromRight ? createIpKey(ipHopsFromRight) : defaultIpKey,
    maxKeys = DEFAULT_MAX_KEYS,
    now = Date.now
  } = options;

  const byIp = new FixedWindowCounter({ windowMs, maxKeys, now });
  const byAccount = new FixedWindowCounter({ windowMs, maxKeys, now });

  function reject(res, entry, scope) {
    const resetAt = entry ? entry.resetAt : now() + windowMs;
    const retryAfter = Math.max(1, Math.ceil((resetAt - now()) / 1000));
    console.warn(`[authRateLimit:${name}] ${scope} limit reached; retry in ${retryAfter}s`);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: 'Too many attempts. Please try again later.'
    });
  }

  function limiter(req, res, next) {
    const ip = ipKey(req);
    const account = accountKey(req);

    const ipEntry = byIp.get(ip);
    if (ipEntry && ipEntry.count >= maxPerIp) return reject(res, ipEntry, 'ip');
    const accountEntry = account ? byAccount.get(account) : null;
    if (accountEntry && accountEntry.count >= maxPerAccount) return reject(res, accountEntry, 'account');

    if (!byIp.canTrack(ip)) return reject(res, null, 'ip-capacity');
    if (account && !byAccount.canTrack(account)) return reject(res, null, 'account-capacity');

    byIp.increment(ip);
    if (account) byAccount.increment(account);

    res.on('finish', () => {
      const status = res.statusCode;
      if (status === 400 || status === 401) return; // auth failure: keep it
      // Anything else (success, 5xx outage, ...) is not a failed guess.
      // Undo only this request's own +1; failures made by other requests
      // (e.g. an attacker on other IPs) stay counted.
      byIp.decrement(ip);
      if (account) byAccount.decrement(account);
    });

    next();
  }

  limiter.size = () => ({ ip: byIp.entries.size, account: byAccount.entries.size });

  limiter.reset = () => {
    byIp.entries.clear();
    byAccount.entries.clear();
  };

  return limiter;
}

module.exports = {
  createAuthRateLimiter,
  defaultAccountKey,
  defaultIpKey,
  createIpKey,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_PER_IP,
  DEFAULT_MAX_PER_ACCOUNT
};
