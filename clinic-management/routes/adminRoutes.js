/**
 * Admin Routes
 * Handles admin authentication and clinic draft management
 * All routes (except login) require admin authentication
 */

const express = require('express');
const router = express.Router();
const adminService = require('../services/adminService');
const draftService = require('../services/draftService');
const clinicCreationService = require('../services/clinicCreationService');
const clinicDeletionService = require('../services/clinicDeletionService');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { 
  fetchGooglePlaceDetails, 
  fetchPlacePhotos,
  searchPlaceByText 
} = require('../../utils/googlePlaces');
const { 
  normalizeResponse, 
  normalizeClinic, 
  normalizeProviders, 
  normalizeProcedures,
  flattenProcedures 
} = require('../../utils/responseNormalizer');

// ============================================
// AUTHENTICATION ROUTES (Public)
// ============================================

/**
 * @swagger
 * /admin/login:
 *   post:
 *     summary: Admin login
 *     tags: [Admin Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    const result = await adminService.login(email, password);
    
    if (!result.success) {
      return res.status(401).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /admin/logout:
 *   post:
 *     summary: Admin logout
 *     tags: [Admin Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', requireAdminAuth, async (req, res) => {
  // For JWT, logout is handled client-side by removing the token
  // This endpoint exists for consistency and future token blacklisting
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * @swagger
 * /admin/me:
 *   get:
 *     summary: Get current admin user
 *     tags: [Admin Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user info
 */
router.get('/me', requireAdminAuth, async (req, res) => {
  try {
    const user = await adminService.getAdminById(req.adminUser.adminUserId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: {
        email: user.Email,
        role: user.Role
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// DASHBOARD ROUTES
// ============================================

/**
 * @swagger
 * /admin/clinics:
 *   get:
 *     summary: List all clinics with pagination and search
 *     tags: [Admin Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by clinic name, address, city, or state
 *     responses:
 *       200:
 *         description: List of clinics with pagination
 */
router.get('/clinics', requireAdminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;
    
    const { db, sql } = require('../../db');
    const pool = await db.getConnection();
    
    if (!pool) {
      throw new Error('Could not establish database connection');
    }
    
    const request = pool.request();
    request.input('limit', sql.Int, limitNum);
    request.input('offset', sql.Int, offset);
    
    let whereClause = '';
    if (search && search.trim()) {
      request.input('searchTerm', sql.NVarChar, `%${search.trim()}%`);
      whereClause = `
        WHERE 
          c.ClinicName LIKE @searchTerm
          OR c.Address LIKE @searchTerm
          OR g.City LIKE @searchTerm
          OR l.City LIKE @searchTerm
          OR g.State LIKE @searchTerm
          OR l.State LIKE @searchTerm
      `;
    }
    
    // Get clinics with pagination
    const clinicsResult = await request.query(`
      SELECT 
        c.ClinicID as id,
        c.ClinicName as clinicName,
        c.Address as address,
        COALESCE(g.City, l.City) as city,
        COALESCE(g.State, l.State) as state,
        COALESCE(g.Category, 'Medical Spa') as category,
        c.GoogleRating as rating,
        c.GoogleReviewCount as reviewCount,
        c.Phone as phone,
        c.Website as website,
        c.LastRatingUpdate as lastUpdated
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      LEFT JOIN Locations l ON c.LocationID = l.LocationID
      ${whereClause}
      ORDER BY c.ClinicName
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);
    
    // Get total count for pagination
    const countRequest = pool.request();
    if (search && search.trim()) {
      countRequest.input('searchTerm', sql.NVarChar, `%${search.trim()}%`);
    }
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      LEFT JOIN Locations l ON c.LocationID = l.LocationID
      ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;
    const totalPages = Math.ceil(total / limitNum);
    
    res.json({
      success: true,
      clinics: clinicsResult.recordset,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('List clinics error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get dashboard statistics
 *     tags: [Admin Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats
 */
router.get('/stats', requireAdminAuth, async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// DRAFT MANAGEMENT ROUTES
// ============================================

/**
 * @swagger
 * /admin/drafts:
 *   get:
 *     summary: List drafts with filters
 *     tags: [Admin Drafts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending_review, approved, rejected, merged]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [new_clinic, add_to_existing]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of drafts
 */
router.get('/drafts', requireAdminAuth, async (req, res) => {
  try {
    const { status, type, search, page = 1, limit = 20 } = req.query;
    
    const filters = {};
    if (status) filters.status = status;
    if (type) filters.submissionFlow = type;
    if (search) filters.search = search;
    filters.limit = Math.min(parseInt(limit), 100);
    filters.offset = (parseInt(page) - 1) * filters.limit;
    
    const drafts = await draftService.listDrafts(filters);
    
    // Get total count for pagination
    const { db, sql } = require('../../db');
    const pool = await db.getConnection();
    const countRequest = pool.request();
    
    let countQuery = 'SELECT COUNT(*) as total FROM ClinicDrafts WHERE 1=1';
    if (status) {
      countRequest.input('status', sql.NVarChar, status);
      countQuery += ' AND Status = @status';
    }
    if (type) {
      countRequest.input('submissionFlow', sql.NVarChar, type);
      countQuery += ' AND SubmissionFlow = @submissionFlow';
    }
    
    const countResult = await countRequest.query(countQuery);
    const total = countResult.recordset[0].total;
    
    res.json({
      success: true,
      drafts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List drafts error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /admin/drafts/{draftId}:
 *   get:
 *     summary: Get draft by ID with full details
 *     tags: [Admin Drafts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Draft details
 *       404:
 *         description: Draft not found
 */
router.get('/drafts/:draftId', requireAdminAuth, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    const draft = await draftService.getDraftById(draftId);
    
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }
    
    // If this is an adjustment, get the existing clinic info with providers and procedures
    // Note: draft is now normalized to camelCase by draftService.getDraftById
    let existingClinic = null;
    if (draft.duplicateClinicId || draft.submissionFlow === 'add_to_existing') {
      const { db, sql } = require('../../db');
      const pool = await db.getConnection();
      const clinicId = draft.duplicateClinicId;
      
      if (clinicId) {
        // Get clinic info
        const clinicResult = await pool.request()
          .input('clinicId', sql.Int, clinicId)
          .query(`
            SELECT 
              c.ClinicID,
              c.ClinicName,
              c.Address,
              c.Phone,
              c.Website,
              c.GoogleRating,
              c.GoogleReviewCount,
              c.Latitude,
              c.Longitude,
              c.PlaceID,
              g.Category,
              g.City,
              g.State,
              g.PostalCode,
              g.Email,
              g.Description
            FROM Clinics c
            LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
            WHERE c.ClinicID = @clinicId
          `);
        
        if (clinicResult.recordset[0]) {
          // Get providers for the clinic
          const providersResult = await pool.request()
            .input('clinicId', sql.Int, clinicId)
            .query(`
              SELECT 
                ProviderID,
                ProviderName,
                CASE WHEN PhotoData IS NOT NULL THEN 1 ELSE 0 END as HasPhotoData
              FROM Providers
              WHERE ClinicID = @clinicId
            `);
          
          // Get procedures for the clinic (deduplicated by name and category)
          const proceduresResult = await pool.request()
            .input('clinicId', sql.Int, clinicId)
            .query(`
              SELECT 
                ProcedureID,
                ProcedureName,
                AverageCost,
                Category,
                CategoryID
              FROM (
                SELECT 
                  p.ProcedureID,
                  p.ProcedureName,
                  p.AverageCost,
                  c.Category,
                  c.CategoryID,
                  ROW_NUMBER() OVER (PARTITION BY p.ProcedureName, c.Category ORDER BY p.ProcedureID) as RowNum
                FROM Procedures p
                JOIN Categories c ON p.CategoryID = c.CategoryID
                JOIN Providers pr ON p.ProviderID = pr.ProviderID
                WHERE pr.ClinicID = @clinicId
              ) AS RankedProcedures
              WHERE RowNum = 1
              ORDER BY Category, ProcedureName
            `);
          
          // Build photo URLs for providers
          const apiBaseUrl = process.env.API_BASE_URL || `${req.protocol}://${req.get('host')}`;
          const providers = providersResult.recordset.map(p => ({
            providerId: p.ProviderID,
            providerName: p.ProviderName,
            photoUrl: p.HasPhotoData ? `${apiBaseUrl}/api/provider-photos/${p.ProviderID}` : null,
            hasPhoto: !!p.HasPhotoData
          }));
          
          // Normalize and structure the existing clinic data
          existingClinic = {
            ...normalizeClinic(clinicResult.recordset[0]),
            providers: providers,
            procedures: normalizeProcedures(proceduresResult.recordset)
          };
        }
      }
    }
    
    // Calculate default photo source based on user photos count
    // Note: draft.photos is now normalized to camelCase
    const userPhotoCount = draft.photos ? draft.photos.filter(p => p.source !== 'google').length : 0;
    let defaultPhotoSource = 'google';
    if (userPhotoCount >= 3) {
      defaultPhotoSource = 'user';
    } else if (userPhotoCount > 0) {
      defaultPhotoSource = 'both';
    }
    
    res.json({
      success: true,
      draft: {
        ...draft,
        defaultPhotoSource,
        userPhotoCount
      },
      existingClinic
    });
  } catch (error) {
    console.error('Get draft error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /admin/drafts/{draftId}:
 *   put:
 *     summary: Update draft
 *     tags: [Admin Drafts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated draft
 */
router.put('/drafts/:draftId', requireAdminAuth, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    const updatedDraft = await draftService.updateDraft(draftId, req.body);
    
    if (!updatedDraft) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }
    
    res.json({
      success: true,
      draft: updatedDraft
    });
  } catch (error) {
    console.error('Update draft error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /admin/drafts/{draftId}/approve:
 *   post:
 *     summary: Approve a draft and create/update clinic
 *     tags: [Admin Drafts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               photoSource:
 *                 type: string
 *                 enum: [user, google, both]
 *                 default: user
 *               ratingSource:
 *                 type: string
 *                 enum: [google, manual]
 *                 default: google
 *               manualRating:
 *                 type: number
 *               manualReviewCount:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Clinic created/updated
 *       400:
 *         description: Validation error
 */
router.post('/drafts/:draftId/approve', requireAdminAuth, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    const {
      photoSource = 'user',
      ratingSource = 'google',
      manualRating,
      manualReviewCount
    } = req.body;
    
    // Create clinic from draft with options
    const result = await clinicCreationService.createClinicFromDraft(draftId, {
      reviewedBy: req.adminUser.email,
      photoSource,
      ratingSource,
      manualRating,
      manualReviewCount
    });
    
    res.json({
      success: true,
      clinicId: result.clinicId,
      clinicName: result.clinicName,
      status: result.status,
      message: `Clinic ${result.status === 'merged' ? 'updated' : 'created'} successfully`
    });
  } catch (error) {
    console.error('Approve draft error:', error);
    
    if (error.message.includes('missing required')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /admin/drafts/{draftId}/reject:
 *   post:
 *     summary: Reject a draft
 *     tags: [Admin Drafts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Draft rejected
 */
router.post('/drafts/:draftId/reject', requireAdminAuth, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    const { reason } = req.body;
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    // Update draft status to rejected with notes
    const { db, sql } = require('../../db');
    const pool = await db.getConnection();
    
    await pool.request()
      .input('draftId', sql.Int, draftId)
      .input('reviewedBy', sql.NVarChar, req.adminUser.email)
      .input('notes', sql.NVarChar(sql.MAX), reason || null)
      .query(`
        UPDATE ClinicDrafts
        SET Status = 'rejected',
            ReviewedBy = @reviewedBy,
            ReviewedAt = GETDATE(),
            Notes = CASE WHEN @notes IS NOT NULL THEN CONCAT(ISNULL(Notes, ''), ' | Rejection reason: ', @notes) ELSE Notes END,
            UpdatedAt = GETDATE()
        WHERE DraftID = @draftId
      `);
    
    res.json({
      success: true,
      message: 'Draft rejected'
    });
  } catch (error) {
    console.error('Reject draft error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// GOOGLE PLACES INTEGRATION ROUTES
// ============================================

/**
 * @swagger
 * /admin/google-photos:
 *   get:
 *     summary: Fetch Google Photos using a PlaceID (no draft required)
 *     description: |
 *       Fetches Google Place photos directly using a PlaceID.
 *       This endpoint is useful for lazy draft creation flows where
 *       you need to preview Google photos before creating a draft.
 *     tags: [Admin Google]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: placeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Google PlaceID to fetch photos for
 *     responses:
 *       200:
 *         description: Google photos fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 photos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       reference:
 *                         type: string
 *                       width:
 *                         type: integer
 *                       height:
 *                         type: integer
 *                       url:
 *                         type: string
 *                       urls:
 *                         type: object
 *                         properties:
 *                           thumbnail:
 *                             type: string
 *                           medium:
 *                             type: string
 *                           large:
 *                             type: string
 *                       attributions:
 *                         type: array
 *                         items:
 *                           type: string
 *                       isPrimary:
 *                         type: boolean
 *       400:
 *         description: PlaceID is required
 *       500:
 *         description: Failed to fetch Google photos
 */
router.get('/google-photos', requireAdminAuth, async (req, res) => {
  try {
    const { placeId } = req.query;
    
    if (!placeId) {
      return res.status(400).json({
        success: false,
        error: 'PlaceID is required. Provide it as a query parameter: ?placeId=YOUR_PLACE_ID'
      });
    }
    
    // Fetch Google photos directly using the placeId
    const photos = await fetchPlacePhotos(placeId);
    
    res.json({
      success: true,
      photos
    });
  } catch (error) {
    console.error('Get Google photos error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Google photos',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /admin/clinics/{clinicId}/google-photos:
 *   get:
 *     summary: Fetch Google Photos for an existing clinic
 *     description: |
 *       Looks up the PlaceID from an existing clinic record and fetches its Google photos.
 *       This endpoint is useful when editing an existing clinic without a draft.
 *     tags: [Admin Google]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinicId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the existing clinic
 *     responses:
 *       200:
 *         description: Google photos fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 placeId:
 *                   type: string
 *                   description: The PlaceID used to fetch photos
 *                 photos:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: No PlaceID available for this clinic
 *       404:
 *         description: Clinic not found
 *       500:
 *         description: Failed to fetch Google photos
 */
router.get('/clinics/:clinicId/google-photos', requireAdminAuth, async (req, res) => {
  try {
    const clinicId = parseInt(req.params.clinicId);
    
    if (isNaN(clinicId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid clinic ID'
      });
    }
    
    // Look up PlaceID from the clinic's GooglePlacesData
    const { db, sql } = require('../../db');
    const pool = await db.getConnection();
    
    const result = await pool.request()
      .input('clinicId', sql.Int, clinicId)
      .query(`
        SELECT 
          c.ClinicID,
          c.ClinicName,
          g.PlaceID
        FROM Clinics c
        LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
        WHERE c.ClinicID = @clinicId
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Clinic not found'
      });
    }
    
    const clinic = result.recordset[0];
    
    if (!clinic.PlaceID) {
      return res.status(400).json({
        success: false,
        error: 'No PlaceID available for this clinic. Google photos cannot be fetched without a PlaceID.',
        clinicName: clinic.ClinicName
      });
    }
    
    // Fetch Google photos using the clinic's PlaceID
    const photos = await fetchPlacePhotos(clinic.PlaceID);
    
    res.json({
      success: true,
      placeId: clinic.PlaceID,
      photos
    });
  } catch (error) {
    console.error('Get clinic Google photos error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Google photos',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /admin/drafts/{draftId}/lookup-placeid:
 *   post:
 *     summary: Lookup Google PlaceID for a draft
 *     tags: [Admin Google]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clinicName:
 *                 type: string
 *                 description: Override clinic name for search
 *               address:
 *                 type: string
 *                 description: Override address for search
 *     responses:
 *       200:
 *         description: PlaceID lookup result
 */
router.post('/drafts/:draftId/lookup-placeid', requireAdminAuth, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    // Get draft to get clinic name and address
    const draft = await draftService.getDraftById(draftId);
    
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }
    
    // Use provided overrides or draft values (draft is normalized to camelCase)
    const clinicName = req.body.clinicName || draft.clinicName;
    const address = req.body.address || `${draft.address}, ${draft.city}, ${draft.state}`;
    
    // Search for place
    const searchResult = await searchPlaceByText(clinicName, address);
    
    if (!searchResult) {
      return res.json({
        success: true,
        found: false,
        message: 'No matching place found'
      });
    }
    
    // If found with good confidence, optionally update the draft
    if (req.body.autoUpdate && searchResult.confidence > 0.8) {
      await draftService.updateDraft(draftId, {
        placeID: searchResult.placeId,
        latitude: searchResult.latitude,
        longitude: searchResult.longitude
      });
    }
    
    res.json({
      success: true,
      found: true,
      placeId: searchResult.placeId,
      confidence: searchResult.confidence,
      businessName: searchResult.name,
      formattedAddress: searchResult.formattedAddress,
      latitude: searchResult.latitude,
      longitude: searchResult.longitude
    });
  } catch (error) {
    console.error('Lookup PlaceID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to lookup PlaceID',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /admin/drafts/{draftId}/fetch-google-data:
 *   post:
 *     summary: Fetch Google Places data (ratings, reviews) for a draft
 *     description: |
 *       Fetches Google Places data including ratings, reviews, and business info.
 *       You can optionally provide a placeId in the request body to use instead of
 *       the stored draft's placeId - useful for previewing data before saving.
 *     tags: [Admin Google]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               placeId:
 *                 type: string
 *                 description: Optional Google PlaceID. If provided, uses this instead of the draft's stored placeId.
 *               save:
 *                 type: boolean
 *                 description: If true, saves the fetched data to the draft
 *     responses:
 *       200:
 *         description: Google data fetched
 *       400:
 *         description: No PlaceID available (neither in request body nor stored in draft)
 */
router.post('/drafts/:draftId/fetch-google-data', requireAdminAuth, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    const draft = await draftService.getDraftById(draftId);
    
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }
    
    // Accept placeId from request body, falling back to stored draft's placeId
    const placeId = req.body.placeId || draft.placeId;
    
    if (!placeId) {
      return res.status(400).json({
        success: false,
        error: 'No PlaceID available. Please provide placeId in request body or lookup PlaceID first.'
      });
    }
    
    // Fetch Google data
    const googleData = await fetchGooglePlaceDetails(placeId, false);
    
    if (!googleData) {
      return res.status(404).json({
        success: false,
        error: 'Place not found in Google Places'
      });
    }
    
    // Optionally save to draft
    if (req.body.save) {
      const { db, sql } = require('../../db');
      const pool = await db.getConnection();
      
      await pool.request()
        .input('draftId', sql.Int, draftId)
        .input('rating', sql.Decimal(2, 1), googleData.rating)
        .input('reviewCount', sql.Int, googleData.reviewCount)
        .input('googleDataJSON', sql.NVarChar(sql.MAX), JSON.stringify(googleData))
        .query(`
          UPDATE ClinicDrafts
          SET GoogleRating = @rating,
              GoogleReviewCount = @reviewCount,
              GoogleDataJSON = @googleDataJSON,
              UpdatedAt = GETDATE()
          WHERE DraftID = @draftId
        `);
      
      // Fetch and return the updated draft
      const updatedDraft = await draftService.getDraftById(draftId);
      
      return res.json({
        success: true,
        googleData: {
          rating: googleData.rating,
          reviewCount: googleData.reviewCount,
          reviews: googleData.reviews,
          openingHours: googleData.openingHours,
          businessStatus: googleData.businessStatus
        },
        draft: updatedDraft
      });
    }
    
    res.json({
      success: true,
      googleData: {
        rating: googleData.rating,
        reviewCount: googleData.reviewCount,
        reviews: googleData.reviews,
        openingHours: googleData.openingHours,
        businessStatus: googleData.businessStatus
      }
    });
  } catch (error) {
    console.error('Fetch Google data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Google data',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /admin/drafts/{draftId}/google-photos:
 *   get:
 *     summary: Get Google Photos for a draft
 *     description: |
 *       Fetches Google Place photos for the draft.
 *       You can optionally provide a placeId as a query parameter to use instead of
 *       the stored draft's placeId - useful for previewing photos before saving.
 *     tags: [Admin Google]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: placeId
 *         schema:
 *           type: string
 *         description: Optional Google PlaceID. If provided, uses this instead of the draft's stored placeId.
 *     responses:
 *       200:
 *         description: Google photos fetched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 placeId:
 *                   type: string
 *                   description: The PlaceID that was used to fetch photos
 *                 photos:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: No PlaceID available (neither in query params nor stored in draft)
 *   post:
 *     summary: Get Google Photos for a draft (POST method)
 *     description: |
 *       Same as GET but allows placeId to be passed in the request body.
 *       Useful for immediate use after looking up a placeId without saving to draft first.
 *     tags: [Admin Google]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               placeId:
 *                 type: string
 *                 description: Optional Google PlaceID. If provided, uses this instead of the draft's stored placeId.
 *     responses:
 *       200:
 *         description: Google photos fetched
 *       400:
 *         description: No PlaceID available
 */
// Support both GET and POST for backwards compatibility
// POST allows placeId to be passed in request body
router.get('/drafts/:draftId/google-photos', requireAdminAuth, handleDraftGooglePhotos);
router.post('/drafts/:draftId/google-photos', requireAdminAuth, handleDraftGooglePhotos);

async function handleDraftGooglePhotos(req, res) {
  try {
    const draftId = parseInt(req.params.draftId);
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    const draft = await draftService.getDraftById(draftId);
    
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }
    
    // Accept placeId from request body (POST) or query params (GET), falling back to stored draft's placeId
    const placeId = req.body.placeId || req.query.placeId || draft.placeId;
    
    if (!placeId) {
      return res.status(400).json({
        success: false,
        error: 'No PlaceID available. Please provide placeId in request body or lookup PlaceID first.'
      });
    }
    
    // Fetch Google photos
    const photos = await fetchPlacePhotos(placeId);
    
    res.json({
      success: true,
      placeId, // Include the placeId used for transparency
      photos
    });
  } catch (error) {
    console.error('Get Google photos error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Google photos',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * @swagger
 * /admin/drafts/{draftId}/update-placeid:
 *   post:
 *     summary: Manually update PlaceID for a draft
 *     tags: [Admin Google]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [placeId]
 *             properties:
 *               placeId:
 *                 type: string
 *     responses:
 *       200:
 *         description: PlaceID updated
 */
router.post('/drafts/:draftId/update-placeid', requireAdminAuth, async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    const { placeId } = req.body;
    
    if (isNaN(draftId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid draft ID'
      });
    }
    
    if (!placeId) {
      return res.status(400).json({
        success: false,
        error: 'PlaceID is required'
      });
    }
    
    // Validate PlaceID by fetching data from Google
    try {
      const googleData = await fetchGooglePlaceDetails(placeId, false);
      
      if (!googleData) {
        return res.status(400).json({
          success: false,
          error: 'Invalid PlaceID - not found in Google Places'
        });
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid PlaceID - could not verify with Google'
      });
    }
    
    // Update draft
    await draftService.updateDraft(draftId, { placeID: placeId });
    
    res.json({
      success: true,
      message: 'PlaceID updated successfully'
    });
  } catch (error) {
    console.error('Update PlaceID error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// CLINIC DELETION ROUTES
// ============================================

/**
 * @swagger
 * /admin/clinics/{clinicId}:
 *   delete:
 *     summary: Delete a clinic (soft delete)
 *     tags: [Admin Clinics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinicId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Clinic deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 deletedClinicId:
 *                   type: integer
 *                 deletedAt:
 *                   type: string
 *                   format: date-time
 *                 clinicName:
 *                   type: string
 *       404:
 *         description: Clinic not found
 *       500:
 *         description: Internal server error
 */
router.delete('/clinics/:clinicId', requireAdminAuth, async (req, res) => {
  try {
    const clinicId = parseInt(req.params.clinicId);
    
    if (isNaN(clinicId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid clinic ID'
      });
    }

    // Get admin email from token (stored in req.adminUser by requireAdminAuth middleware)
    const deletedBy = req.adminUser?.email || 'unknown';

    const result = await clinicDeletionService.deleteClinic(clinicId, deletedBy);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Delete clinic error:', error);
    
    if (error.message === 'Clinic not found') {
      return res.status(404).json({
        success: false,
        error: 'Clinic not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /admin/clinics/deleted:
 *   get:
 *     summary: List deleted clinics
 *     tags: [Admin Clinics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of deleted clinics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 clinics:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   type: object
 */
router.get('/clinics/deleted', requireAdminAuth, async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    
    const result = await clinicDeletionService.getDeletedClinics({
      page,
      limit,
      search
    });
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('List deleted clinics error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /admin/clinics/deleted/{deletedClinicId}/restore:
 *   post:
 *     summary: Restore a deleted clinic
 *     tags: [Admin Clinics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deletedClinicId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Clinic restored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 clinicId:
 *                   type: integer
 *                 clinicName:
 *                   type: string
 *                 restoredAt:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Deleted clinic not found
 *       500:
 *         description: Internal server error
 */
router.post('/clinics/deleted/:deletedClinicId/restore', requireAdminAuth, async (req, res) => {
  try {
    const deletedClinicId = parseInt(req.params.deletedClinicId);
    
    if (isNaN(deletedClinicId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid deleted clinic ID'
      });
    }

    const result = await clinicDeletionService.restoreClinic(deletedClinicId);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Restore clinic error:', error);
    
    if (error.message === 'Deleted clinic not found') {
      return res.status(404).json({
        success: false,
        error: 'Deleted clinic not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

