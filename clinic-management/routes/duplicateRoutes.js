const express = require('express');
const duplicateDetectionService = require('../services/duplicateDetectionService');
const draftService = require('../services/draftService');

const router = express.Router();

/**
 * @swagger
 * /duplicates/check:
 *   post:
 *     summary: Check single clinic for duplicates
 *     tags: [Duplicates]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clinicName
 *               - address
 *             properties:
 *               clinicName:
 *                 type: string
 *                 description: Name of the clinic
 *               address:
 *                 type: string
 *                 description: Street address
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zipCode:
 *                 type: string
 *                 description: ZIP code; used by the same-address check
 *               phone:
 *                 type: string
 *               website:
 *                 type: string
 *                 description: Website URL; its registrable domain is the deciding signal for same-address candidates
 *               placeID:
 *                 type: string
 *                 description: Google Places PlaceID
 *     responses:
 *       200:
 *         description: Duplicate check results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasDuplicates:
 *                   type: boolean
 *                 confidence:
 *                   type: string
 *                   enum: [high, medium, low]
 *                 matches:
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
 *                       matchReason:
 *                         type: string
 *                       confidence:
 *                         type: string
 *                       similarityScore:
 *                         type: number
 *                       addressClassification:
 *                         type: string
 *                         enum: [likely_duplicate, review_only]
 *                         description: Present only when the clinic shares the normalized street address (see GET /duplicates/address-candidates)
 *                       addressEvidence:
 *                         $ref: '#/components/schemas/AddressMatchEvidence'
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/check', async (req, res) => {
  try {
    const clinicData = req.body;
    
    if (!clinicData.clinicName || !clinicData.address) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'clinicName and address are required'
      });
    }

    const result = await duplicateDetectionService.checkDuplicates(clinicData);
    res.json(result);
  } catch (error) {
    console.error('Error checking duplicates:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     AddressMatchEvidence:
 *       type: object
 *       description: Why two clinics were paired by address. Review evidence only; nothing is merged automatically.
 *       properties:
 *         reason:
 *           type: string
 *           enum: [website_domain_match, website_missing_on_one_side, website_domain_mismatch, no_website_on_either_side, shared_website_distinct_names_both_priced, suite_mismatch]
 *         addressMatch:
 *           type: boolean
 *         normalizedStreet:
 *           type: string
 *           example: 9230 katy fwy
 *         localityBasis:
 *           type: string
 *           enum: [zip, city_state]
 *           description: zip when both sides have a ZIP, otherwise city + state
 *         zip:
 *           type: string
 *           nullable: true
 *         units:
 *           type: array
 *           items:
 *             type: string
 *             nullable: true
 *         unitComparison:
 *           type: string
 *           enum: [match, mismatch, one_side_missing, both_missing]
 *         websiteDomains:
 *           type: array
 *           items:
 *             type: string
 *             nullable: true
 *         websiteComparison:
 *           type: string
 *           enum: [match, mismatch, one_side_missing, both_missing]
 *         nameSimilarity:
 *           type: integer
 *           description: 0-100 after removing generic words (plastic, surgery, md, ...)
 *         pricedProcedures:
 *           type: array
 *           items:
 *             type: integer
 *             nullable: true
 *         addressSources:
 *           type: array
 *           items:
 *             type: string
 *             enum: [clinic, google, none]
 *
 * /duplicates/address-candidates:
 *   get:
 *     summary: List existing clinics that share a street address
 *     description: |
 *       Read-only scan of every clinic for pairs with the same normalized street
 *       address and locality (ZIP when both sides have one, otherwise city + state).
 *       Multi-line addresses, suite/unit/# variants and suffix spellings
 *       (Boulevard/Blvd, Freeway/Fwy) are normalized. Each pair is classified:
 *       likely_duplicate (website registrable domain matches, or exactly one side
 *       has no website), review_only (domains differ, no website on either side, or
 *       one shared website used by two differently named practices that both have
 *       prices), or excluded (both name a suite and the suites differ).
 *       Nothing is merged; use the merge tooling after a human decision.
 *     tags: [Duplicates]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: includeExcluded
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Also return suite-mismatch pairs
 *     responses:
 *       200:
 *         description: Candidate pairs, likely_duplicate first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clinicsScanned:
 *                   type: integer
 *                 counts:
 *                   type: object
 *                   properties:
 *                     likely_duplicate:
 *                       type: integer
 *                     review_only:
 *                       type: integer
 *                     excluded:
 *                       type: integer
 *                 candidates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       clinicIds:
 *                         type: array
 *                         items:
 *                           type: integer
 *                       clinicNames:
 *                         type: array
 *                         items:
 *                           type: string
 *                       classification:
 *                         type: string
 *                         enum: [likely_duplicate, review_only, excluded]
 *                       reason:
 *                         type: string
 *                       evidence:
 *                         $ref: '#/components/schemas/AddressMatchEvidence'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
// Declared before /:draftId so the literal path is not captured as a draft ID.
router.get('/address-candidates', async (req, res) => {
  try {
    const includeExcluded = String(req.query.includeExcluded || '').toLowerCase() === 'true';
    const result = await duplicateDetectionService.findAddressDuplicateCandidates({ includeExcluded });
    res.json(result);
  } catch (error) {
    console.error('Error scanning address duplicate candidates:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /duplicates/{draftId}:
 *   get:
 *     summary: Get duplicate suggestions for a draft
 *     tags: [Duplicates]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Draft ID to check for duplicates
 *     responses:
 *       200:
 *         description: Duplicate check results for the draft
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasDuplicates:
 *                   type: boolean
 *                 confidence:
 *                   type: string
 *                   enum: [high, medium, low]
 *                 matches:
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
 *                       matchReason:
 *                         type: string
 *                       confidence:
 *                         type: string
 *                       similarityScore:
 *                         type: number
 *                       addressClassification:
 *                         type: string
 *                         enum: [likely_duplicate, review_only]
 *                         description: Present only when the clinic shares the normalized street address (see GET /duplicates/address-candidates)
 *                       addressEvidence:
 *                         $ref: '#/components/schemas/AddressMatchEvidence'
 *       400:
 *         description: Invalid draft ID
 *       404:
 *         description: Draft not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/:draftId', async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    if (isNaN(draftId)) {
      return res.status(400).json({ error: 'Invalid draft ID' });
    }

    const draft = await draftService.getDraftById(draftId);
    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    const clinicData = {
      clinicName: draft.clinicName,
      address: draft.address,
      city: draft.city,
      state: draft.state,
      zipCode: draft.zipCode,
      phone: draft.phone,
      website: draft.website,
      placeID: draft.placeId
    };

    const result = await duplicateDetectionService.checkDuplicates(clinicData);
    res.json(result);
  } catch (error) {
    console.error('Error getting duplicates for draft:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

