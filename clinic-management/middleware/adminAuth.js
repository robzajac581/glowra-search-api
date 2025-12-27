/**
 * Admin Authentication Middleware
 * Handles JWT token validation for admin routes
 */

const jwt = require('jsonwebtoken');

// JWT secret - should be in .env in production
const JWT_SECRET = process.env.JWT_SECRET || 'glowra-admin-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

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
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Middleware to require admin authentication
 * Extracts token from Authorization header and validates it
 */
function requireAdminAuth(req, res, next) {
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
  
  const token = parts[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
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

/**
 * Middleware to require superadmin role
 * Must be used after requireAdminAuth
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

module.exports = {
  generateToken,
  verifyToken,
  requireAdminAuth,
  requireSuperAdmin,
  JWT_SECRET
};

