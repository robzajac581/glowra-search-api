/**
 * Submission Routes
 * Handles "List Your Clinic" wizard form submissions
 * These endpoints are PUBLIC - no API key required for submissions
 */

const express = require('express');
const submissionService = require('../services/submissionService');
const { 
  CLINIC_CATEGORIES, 
  PROVIDER_SPECIALTIES, 
  PROCEDURE_CATEGORIES, 
  PRICE_UNITS,
  US_STATES,
  PHOTO_TYPES,
  ALLOWED_MIME_TYPES
} = require('../utils/schemaValidator');

const router = express.Router();

/**
 * @swagger
 * /submissions:
 *   post:
 *     summary: Submit a clinic listing (public endpoint)
 *     description: |
 *       Submit a new clinic listing or add providers/procedures to an existing clinic.
 *       This is a PUBLIC endpoint - no API key required.
 *       Submissions go to a review queue and are not immediately published.
 *     tags: [Submissions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - flow
 *             properties:
 *               submitterKey:
 *                 type: string
 *                 description: Optional key for tracking submissions (internal use)
 *               flow:
 *                 type: string
 *                 enum: [new_clinic, add_to_existing]
 *                 description: Type of submission
 *               existingClinicId:
 *                 type: integer
 *                 description: Required if flow is "add_to_existing"
 *               clinic:
 *                 type: object
 *                 description: Required if flow is "new_clinic"
 *                 properties:
 *                   clinicName:
 *                     type: string
 *                   address:
 *                     type: string
 *                   city:
 *                     type: string
 *                   state:
 *                     type: string
 *                   zipCode:
 *                     type: string
 *                   category:
 *                     type: string
 *                   website:
 *                     type: string
 *                   phone:
 *                     type: string
 *                   email:
 *                     type: string
 *               providers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     providerName:
 *                       type: string
 *                     specialty:
 *                       type: string
 *               procedures:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     procedureName:
 *                       type: string
 *                     category:
 *                       type: string
 *                     priceMin:
 *                       type: number
 *                     priceMax:
 *                       type: number
 *                     unit:
 *                       type: string
 *                     averagePrice:
 *                       type: number
 *                     providerNames:
 *                       type: array
 *                       items:
 *                         type: string
 *           example:
 *             flow: "new_clinic"
 *             clinic:
 *               clinicName: "Skin Solutions Miami"
 *               address: "123 Collins Ave, Suite 400"
 *               city: "Miami Beach"
 *               state: "Florida"
 *               zipCode: "33139"
 *               category: "Med Spa / Aesthetics"
 *               website: "https://skinsolutionsmiami.com"
 *               phone: "(305) 555-1234"
 *               email: "info@skinsolutionsmiami.com"
 *             providers:
 *               - providerName: "Dr. Sarah Johnson"
 *                 specialty: "Plastic Surgery"
 *             procedures:
 *               - procedureName: "Botox"
 *                 category: "Injectables"
 *                 priceMin: 12
 *                 priceMax: 15
 *                 unit: "/unit"
 *     responses:
 *       201:
 *         description: Submission received successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 submissionId:
 *                   type: string
 *                   example: "GLW-2024-0042"
 *                 draftId:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 duplicateWarning:
 *                   type: object
 *                   nullable: true
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:
 *                         type: string
 *                       message:
 *                         type: string
 *       500:
 *         description: Internal server error
 */
router.post('/', async (req, res) => {
  try {
    const result = await submissionService.processSubmission(req.body);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.status(201).json(result);
  } catch (error) {
    console.error('Error processing submission:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /submissions/{submissionId}:
 *   get:
 *     summary: Get submission by ID
 *     description: Retrieve a submission by its submission ID (e.g., GLW-2024-0042)
 *     tags: [Submissions]
 *     parameters:
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Submission ID (e.g., GLW-2024-0042)
 *     responses:
 *       200:
 *         description: Submission found
 *       404:
 *         description: Submission not found
 */
router.get('/:submissionId', async (req, res) => {
  try {
    const submission = await submissionService.getBySubmissionId(req.params.submissionId);
    
    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }
    
    res.json({
      success: true,
      submission
    });
  } catch (error) {
    console.error('Error getting submission:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /submissions/schema:
 *   get:
 *     summary: Get form schema and enum values
 *     description: Returns all field definitions and enum values for building the submission form
 *     tags: [Submissions]
 *     responses:
 *       200:
 *         description: Schema and enums
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clinicCategories:
 *                   type: array
 *                 providerSpecialties:
 *                   type: array
 *                 procedureCategories:
 *                   type: array
 *                 priceUnits:
 *                   type: array
 *                 usStates:
 *                   type: array
 */
router.get('/schema', async (req, res) => {
  res.json({
    success: true,
    schema: {
      clinicCategories: CLINIC_CATEGORIES,
      providerSpecialties: PROVIDER_SPECIALTIES,
      procedureCategories: PROCEDURE_CATEGORIES,
      priceUnits: PRICE_UNITS,
      usStates: US_STATES,
      photoTypes: PHOTO_TYPES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      advancedFields: [
        'latitude', 'longitude', 'placeID', 'description', 'bookingURL',
        'googleProfileLink', 'facebook', 'instagram', 'linkedin', 'twitter',
        'youtube', 'workingHours'
      ]
    }
  });
});

/**
 * @swagger
 * /submissions/clinics/search:
 *   get:
 *     summary: Search existing clinics
 *     description: Search for existing clinics by name or address (for "add to existing" flow)
 *     tags: [Submissions]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (clinic name or address)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       clinicId:
 *                         type: integer
 *                       clinicName:
 *                         type: string
 *                       address:
 *                         type: string
 *                       category:
 *                         type: string
 *                       rating:
 *                         type: number
 *                       reviewCount:
 *                         type: integer
 *       400:
 *         description: Missing search query
 */
router.get('/clinics/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    const { db, sql } = require('../../db');
    const pool = await db.getConnection();
    const request = pool.request();
    
    const searchTerm = `%${q.trim()}%`;
    request.input('searchTerm', sql.NVarChar, searchTerm);
    request.input('limit', sql.Int, Math.min(parseInt(limit), 50));

    const result = await request.query(`
      SELECT TOP (@limit)
        c.ClinicID as clinicId,
        c.ClinicName as clinicName,
        c.Address as address,
        c.GoogleRating as rating,
        c.GoogleReviewCount as reviewCount,
        g.Category as category,
        g.City as city,
        g.State as state
      FROM Clinics c
      LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
      WHERE c.ClinicName LIKE @searchTerm
         OR c.Address LIKE @searchTerm
         OR g.City LIKE @searchTerm
      ORDER BY 
        CASE WHEN c.ClinicName LIKE @searchTerm THEN 0 ELSE 1 END,
        c.GoogleRating DESC,
        c.GoogleReviewCount DESC
    `);

    res.json({
      success: true,
      results: result.recordset.map(clinic => ({
        ...clinic,
        address: [clinic.address, clinic.city, clinic.state].filter(Boolean).join(', ')
      }))
    });
  } catch (error) {
    console.error('Error searching clinics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /submissions/clinics/{clinicId}:
 *   get:
 *     summary: Get clinic details
 *     description: Get details of an existing clinic (for pre-filling the form)
 *     tags: [Submissions]
 *     parameters:
 *       - in: path
 *         name: clinicId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Clinic ID
 *     responses:
 *       200:
 *         description: Clinic details
 *       404:
 *         description: Clinic not found
 */
router.get('/clinics/:clinicId', async (req, res) => {
  try {
    const clinicId = parseInt(req.params.clinicId);
    
    if (isNaN(clinicId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid clinic ID'
      });
    }

    const { db, sql } = require('../../db');
    const pool = await db.getConnection();
    const request = pool.request();
    request.input('clinicId', sql.Int, clinicId);

    const result = await request.query(`
      SELECT
        c.ClinicID as clinicId,
        c.ClinicName as clinicName,
        c.Address as address,
        c.Phone as phone,
        c.Website as website,
        c.GoogleRating as rating,
        c.GoogleReviewCount as reviewCount,
        g.Category as category,
        g.City as city,
        g.State as state,
        g.PostalCode as zipCode,
        g.Email as email
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

    // Also get existing providers
    const providersResult = await pool.request()
      .input('clinicId', sql.Int, clinicId)
      .query(`
        SELECT ProviderID, ProviderName
        FROM Providers
        WHERE ClinicID = @clinicId
      `);

    res.json({
      success: true,
      clinic: result.recordset[0],
      existingProviders: providersResult.recordset
    });
  } catch (error) {
    console.error('Error getting clinic:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

