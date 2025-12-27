/**
 * Admin Service
 * Handles admin user authentication and management
 */

const { db, sql } = require('../../db');
const bcrypt = require('bcrypt');
const { generateToken } = require('../middleware/adminAuth');

const SALT_ROUNDS = 10;

class AdminService {
  /**
   * Authenticate admin user with email and password
   * @param {string} email - Admin email
   * @param {string} password - Plain text password
   * @returns {Promise<Object>} Auth result with token and user info
   */
  async login(email, password) {
    const pool = await db.getConnection();
    const request = pool.request();
    request.input('email', sql.NVarChar, email.toLowerCase().trim());
    
    const result = await request.query(`
      SELECT 
        AdminUserID,
        Email,
        PasswordHash,
        Role,
        IsActive
      FROM AdminUsers
      WHERE Email = @email
    `);
    
    if (result.recordset.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials'
      };
    }
    
    const user = result.recordset[0];
    
    if (!user.IsActive) {
      return {
        success: false,
        error: 'Account is disabled'
      };
    }
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.PasswordHash);
    
    if (!passwordMatch) {
      return {
        success: false,
        error: 'Invalid credentials'
      };
    }
    
    // Update last login time
    await pool.request()
      .input('adminUserId', sql.Int, user.AdminUserID)
      .query('UPDATE AdminUsers SET LastLoginAt = GETDATE() WHERE AdminUserID = @adminUserId');
    
    // Generate token
    const token = generateToken(user);
    
    return {
      success: true,
      token,
      user: {
        email: user.Email,
        role: user.Role
      }
    };
  }
  
  /**
   * Get admin user by ID
   * @param {number} adminUserId - Admin user ID
   * @returns {Promise<Object|null>} Admin user or null
   */
  async getAdminById(adminUserId) {
    const pool = await db.getConnection();
    const result = await pool.request()
      .input('adminUserId', sql.Int, adminUserId)
      .query(`
        SELECT 
          AdminUserID,
          Email,
          Role,
          IsActive,
          CreatedAt,
          LastLoginAt
        FROM AdminUsers
        WHERE AdminUserID = @adminUserId
      `);
    
    return result.recordset[0] || null;
  }
  
  /**
   * Create a new admin user (for future use)
   * @param {Object} userData - User data { email, password, role }
   * @returns {Promise<Object>} Created user
   */
  async createAdmin(email, password, role = 'admin') {
    const pool = await db.getConnection();
    
    // Check if email already exists
    const existingCheck = await pool.request()
      .input('email', sql.NVarChar, email.toLowerCase().trim())
      .query('SELECT 1 FROM AdminUsers WHERE Email = @email');
    
    if (existingCheck.recordset.length > 0) {
      throw new Error('Email already exists');
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    const result = await pool.request()
      .input('email', sql.NVarChar, email.toLowerCase().trim())
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('role', sql.NVarChar, role)
      .query(`
        INSERT INTO AdminUsers (Email, PasswordHash, Role)
        OUTPUT INSERTED.AdminUserID, INSERTED.Email, INSERTED.Role
        VALUES (@email, @passwordHash, @role)
      `);
    
    return result.recordset[0];
  }
  
  /**
   * Hash a password (utility for generating hashes)
   * @param {string} password - Plain text password
   * @returns {Promise<string>} Bcrypt hash
   */
  async hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
  }
  
  /**
   * Get dashboard statistics
   * @returns {Promise<Object>} Stats object
   */
  async getDashboardStats() {
    const pool = await db.getConnection();
    
    const result = await pool.request().query(`
      SELECT
        COUNT(CASE WHEN Status = 'pending_review' THEN 1 END) as pendingCount,
        COUNT(CASE WHEN Status = 'approved' THEN 1 END) as approvedCount,
        COUNT(CASE WHEN Status = 'rejected' THEN 1 END) as rejectedCount,
        COUNT(CASE WHEN Status = 'merged' THEN 1 END) as mergedCount,
        COUNT(CASE WHEN SubmissionFlow = 'new_clinic' AND Status = 'pending_review' THEN 1 END) as newClinicsCount,
        COUNT(CASE WHEN SubmissionFlow = 'add_to_existing' AND Status = 'pending_review' THEN 1 END) as adjustmentsCount
      FROM ClinicDrafts
    `);
    
    return result.recordset[0];
  }
}

module.exports = new AdminService();

