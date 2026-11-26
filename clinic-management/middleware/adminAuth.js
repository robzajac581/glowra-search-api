/**
 * Admin Authentication Middleware
 * Handles JWT token validation and role enforcement for admin routes.
 *
 * GLO-29: role enforcement is default-deny.
 *   - Every protected route must declare an explicit role allowlist via
 *     requireRole([...roles]). A token whose `role` claim is not on the list
 *     gets 403, so a future `clinic_owner` token signed with the same secret
 *     cannot reach admin routes.
 *   - requireAdminAuth (no allowlist) rejects every caller.
 *   - enforceDeclaredRoles(router) makes any route registered without an
 *     allowlist reject every caller, so a forgotten guard fails closed.
 *   - JWT_SECRET has no fallback. assertJwtSecretConfigured() is called at
 *     startup and the server refuses to boot without it.
 */

const jwt = require('jsonwebtoken');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// The old hard-coded fallback. It is public (it was in the repo), so it is
// refused even if someone sets it explicitly.
const LEAKED_DEFAULT_SECRET = 'glowra-admin-jwt-secret-change-in-production';

// Roles that may use the existing admin dashboard and blog admin routes.
const ADMIN_ROLES = Object.freeze(['admin', 'superadmin']);

// Marks a middleware as a role guard so enforceDeclaredRoles can find it.
const ROLE_GUARD = Symbol.for('glowra.adminAuth.roleGuard');

/**
 * Read JWT_SECRET from the environment. Throws if it is missing or is the
 * leaked default. Read lazily so dotenv load order does not matter.
 * @returns {string}
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT_SECRET is not set; refusing to sign or verify admin tokens.');
  }
  if (secret === LEAKED_DEFAULT_SECRET) {
    throw new Error('JWT_SECRET is set to the old public default; set a long random value.');
  }
  return secret;
}

/**
 * Startup check. Call once before app.listen so a missing secret stops the
 * deploy instead of leaving admin auth broken or forgeable.
 */
function assertJwtSecretConfigured() {
  getJwtSecret();
}

/**
 * Generate a JWT token for an admin user
 * @param {Object} user - Admin user object
 * @returns {string} JWT token
 */
function generateToken(user) {
  return jwt.sign(
    {
      adminUserId: user.AdminUserID,
      email: user.Email,
      role: user.Role
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function verifyToken(token) {
  let secret;
  try {
    secret = getJwtSecret();
  } catch (error) {
    console.error(`[adminAuth] ${error.message}`);
    return null;
  }
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (error) {
    return null;
  }
}

function denyUndeclared(req, res) {
  console.error(
    `[adminAuth] No role allowlist declared for ${req.method} ${req.originalUrl}; rejecting (fail closed).`
  );
  return res.status(403).json({
    success: false,
    error: 'Forbidden'
  });
}

/**
 * Build middleware that authenticates the bearer token and allows only the
 * listed roles. An empty or invalid allowlist rejects every caller.
 * @param {string[]} allowedRoles
 * @returns {Function} Express middleware
 */
function requireRole(allowedRoles) {
  const valid =
    Array.isArray(allowedRoles) &&
    allowedRoles.length > 0 &&
    allowedRoles.every((r) => typeof r === 'string' && r.length > 0);
  const allowed = valid ? new Set(allowedRoles) : null;

  function roleGuard(req, res, next) {
    if (!allowed) {
      return denyUndeclared(req, res);
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header required'
      });
    }

    // Extract token from "Bearer <token>" format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        success: false,
        error: 'Invalid authorization header format. Use: Bearer <token>'
      });
    }

    const decoded = verifyToken(parts[1]);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    if (typeof decoded.role !== 'string' || !allowed.has(decoded.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden'
      });
    }

    // Attach user info to request
    req.adminUser = {
      adminUserId: decoded.adminUserId,
      email: decoded.email,
      role: decoded.role
    };

    next();
  }

  roleGuard[ROLE_GUARD] = true;
  return roleGuard;
}

/**
 * Legacy name. Used bare it declares no allowlist, so it rejects every
 * caller. Use requireRole(ADMIN_ROLES) instead.
 */
function requireAdminAuth(req, res) {
  return denyUndeclared(req, res);
}

/**
 * Middleware to require superadmin role
 * Must be used after requireRole(...)
 */
function requireSuperAdmin(req, res, next) {
  if (!req.adminUser) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (req.adminUser.role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      error: 'Superadmin access required'
    });
  }

  next();
}

/**
 * Make every route on `router` that has no role guard reject all callers.
 * Call after all routes are registered. A router-level router.use(roleGuard)
 * covers the routes registered after it.
 *
 * @param {import('express').Router} router
 * @param {object} [options]
 * @param {string[]} [options.publicRoutes] - "METHOD /path" entries that are
 *   intentionally unauthenticated (e.g. "POST /login").
 * @returns {string[]} the "METHOD /path" entries that were locked down
 */
function enforceDeclaredRoles(router, { publicRoutes = [] } = {}) {
  const publicSet = new Set(publicRoutes.map((r) => r.toUpperCase()));
  const lockedDown = [];
  let coveredByRouterGuard = false;

  for (const layer of router.stack) {
    if (!layer.route) {
      if (layer.handle && layer.handle[ROLE_GUARD]) coveredByRouterGuard = true;
      continue;
    }
    if (coveredByRouterGuard) continue;

    const route = layer.route;
    const methods = Object.keys(route.methods).filter((m) => route.methods[m]);
    const keys = methods.map((m) => `${m.toUpperCase()} ${route.path}`);
    if (keys.length > 0 && keys.every((k) => publicSet.has(k.toUpperCase()))) continue;

    const guarded = route.stack.some((l) => l.handle && l.handle[ROLE_GUARD]);
    if (guarded) continue;

    for (const l of route.stack) {
      l.handle = denyUndeclared;
    }
    lockedDown.push(...keys);
  }

  if (lockedDown.length > 0) {
    console.error(
      `[adminAuth] Routes with no role allowlist (locked down, all callers rejected): ${lockedDown.join(', ')}`
    );
  }
  return lockedDown;
}

module.exports = {
  ADMIN_ROLES,
  ROLE_GUARD,
  generateToken,
  verifyToken,
  getJwtSecret,
  assertJwtSecretConfigured,
  requireRole,
  requireAdminAuth,
  requireSuperAdmin,
  enforceDeclaredRoles
};
