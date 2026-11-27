/**
 * GLO-30: in-process rate limiting for authentication endpoints.
 *
 * Every attempt counts against two fixed-window budgets: one per client IP
 * and one per account (normalized email). A successful attempt (2xx) is
 * refunded, so only failed attempts add up. When either budget is spent the
 * request gets 429 with a Retry-After header, before the handler runs.
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
// maps without limit.
const DEFAULT_MAX_KEYS = 10000;

function defaultAccountKey(req) {
  const email = req.body && req.body.email;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return normalized || null;
}

function defaultIpKey(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

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

  increment(key) {
    let entry = this.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxKeys) this.sweep();
      if (this.entries.size >= this.maxKeys) {
        // Still full of live entries: drop the oldest one.
        this.entries.delete(this.entries.keys().next().value);
      }
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

  reset(key) {
    this.entries.delete(key);
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
 * @param {(req) => string} [options.ipKey] - client identifier; default req.ip
 * @param {number} [options.maxKeys] - cap on tracked keys per map
 * @param {() => number} [options.now] - clock, for tests
 * @returns {import('express').RequestHandler & { reset: () => void }}
 */
function createAuthRateLimiter(options = {}) {
  const {
    name = 'auth',
    windowMs = DEFAULT_WINDOW_MS,
    maxPerIp = DEFAULT_MAX_PER_IP,
    maxPerAccount = DEFAULT_MAX_PER_ACCOUNT,
    accountKey = defaultAccountKey,
    ipKey = defaultIpKey,
    maxKeys = DEFAULT_MAX_KEYS,
    now = Date.now
  } = options;

  const byIp = new FixedWindowCounter({ windowMs, maxKeys, now });
  const byAccount = new FixedWindowCounter({ windowMs, maxKeys, now });

  function reject(res, entry, scope) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now()) / 1000));
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

    byIp.increment(ip);
    if (account) byAccount.increment(account);

    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        byIp.decrement(ip);
        if (account) byAccount.reset(account);
      }
    });

    next();
  }

  limiter.reset = () => {
    byIp.entries.clear();
    byAccount.entries.clear();
  };

  return limiter;
}

module.exports = {
  createAuthRateLimiter,
  defaultAccountKey,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_PER_IP,
  DEFAULT_MAX_PER_ACCOUNT
};
