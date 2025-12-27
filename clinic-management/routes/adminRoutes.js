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
const { requireAdminAuth } = require('../middleware/adminAuth');
const { 
  fetchGooglePlaceDetails, 
  fetchPlacePhotos,
  searchPlaceByText 
} = require('../../utils/googlePlaces');

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
    
    // If this is an adjustment, get the existing clinic info
    let existingClinic = null;
    if (draft.DuplicateClinicID || draft.SubmissionFlow === 'add_to_existing') {
      const { db, sql } = require('../../db');
      const pool = await db.getConnection();
      const clinicId = draft.DuplicateClinicID;
      
      if (clinicId) {
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
              g.Category,
              g.City,
              g.State
            FROM Clinics c
            LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
            WHERE c.ClinicID = @clinicId
          `);
        
        existingClinic = clinicResult.recordset[0] || null;
      }
    }
    
    // Calculate default photo source based on user photos count
    const userPhotoCount = draft.photos ? draft.photos.filter(p => p.Source !== 'google').length : 0;
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
    
    // Use provided overrides or draft values
    const clinicName = req.body.clinicName || draft.ClinicName;
    const address = req.body.address || `${draft.Address}, ${draft.City}, ${draft.State}`;
    
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
 *     tags: [Admin Google]
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
 *         description: Google data fetched
 *       400:
 *         description: No PlaceID available
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
    
    if (!draft.PlaceID) {
      return res.status(400).json({
        success: false,
        error: 'No PlaceID available. Please lookup PlaceID first.'
      });
    }
    
    // Fetch Google data
    const googleData = await fetchGooglePlaceDetails(draft.PlaceID, false);
    
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
 *     tags: [Admin Google]
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
 *         description: Google photos
 *       400:
 *         description: No PlaceID available
 */
router.get('/drafts/:draftId/google-photos', requireAdminAuth, async (req, res) => {
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
    
    if (!draft.PlaceID) {
      return res.status(400).json({
        success: false,
        error: 'No PlaceID available. Please lookup PlaceID first.'
      });
    }
    
    // Fetch Google photos
    const photos = await fetchPlacePhotos(draft.PlaceID);
    
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

module.exports = router;

