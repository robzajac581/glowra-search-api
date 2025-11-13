const express = require('express');
const draftService = require('../services/draftService');
const duplicateDetectionService = require('../services/duplicateDetectionService');

const router = express.Router();

/**
 * @swagger
 * /drafts:
 *   get:
 *     summary: List all drafts with optional filters
 *     tags: [Drafts]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, pending_review, approved, rejected, merged]
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of drafts
 *       401:
 *         description: Unauthorized
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      source: req.query.source,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      limit: req.query.limit ? parseInt(req.query.limit) : null
    };

    const drafts = await draftService.listDrafts(filters);
    res.json({ drafts, count: drafts.length });
  } catch (error) {
    console.error('Error listing drafts:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /drafts/{draftId}:
 *   get:
 *     summary: Get draft details with providers and procedures
 *     tags: [Drafts]
 *     security:
 *       - ApiKeyAuth: []
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

    res.json(draft);
  } catch (error) {
    console.error('Error getting draft:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /drafts/{draftId}:
 *   put:
 *     summary: Update draft details
 *     tags: [Drafts]
 *     security:
 *       - ApiKeyAuth: []
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
 *             properties:
 *               clinicName:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               website:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               placeID:
 *                 type: string
 *               category:
 *                 type: string
 *               notes:
 *                 type: string
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
 *                     averageCost:
 *                       type: number
 *                     providerName:
 *                       type: string
 *     responses:
 *       200:
 *         description: Draft updated successfully
 *       400:
 *         description: Invalid draft ID
 *       404:
 *         description: Draft not found
 *       401:
 *         description: Unauthorized
 */
router.put('/:draftId', async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    if (isNaN(draftId)) {
      return res.status(400).json({ error: 'Invalid draft ID' });
    }

    const updatedDraft = await draftService.updateDraft(draftId, req.body);
    res.json(updatedDraft);
  } catch (error) {
    console.error('Error updating draft:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /drafts/{draftId}/approve:
 *   post:
 *     summary: Approve draft and create clinic
 *     tags: [Drafts]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: header
 *         name: X-Reviewed-By
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Draft approved successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/:draftId/approve', async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    if (isNaN(draftId)) {
      return res.status(400).json({ error: 'Invalid draft ID' });
    }

    const reviewedBy = req.headers['x-reviewed-by'] || req.body.reviewedBy || 'system';
    const clinicCreationService = require('../services/clinicCreationService');
    
    const result = await clinicCreationService.createClinicFromDraft(draftId, reviewedBy);
    res.json({
      success: true,
      message: 'Draft approved and clinic created',
      ...result
    });
  } catch (error) {
    console.error('Error approving draft:', error);
    res.status(400).json({
      error: 'Failed to approve draft',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /drafts/{draftId}/reject:
 *   post:
 *     summary: Reject draft
 *     tags: [Drafts]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: header
 *         name: X-Reviewed-By
 *         schema:
 *           type: string
 *         description: User who rejected the draft
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Reason for rejection
 *               reason:
 *                 type: string
 *                 description: Alternative field for rejection reason
 *               reviewedBy:
 *                 type: string
 *                 description: User who rejected (alternative to header)
 *     responses:
 *       200:
 *         description: Draft rejected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 draft:
 *                   type: object
 *       400:
 *         description: Invalid draft ID
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/:draftId/reject', async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    if (isNaN(draftId)) {
      return res.status(400).json({ error: 'Invalid draft ID' });
    }

    const reviewedBy = req.headers['x-reviewed-by'] || req.body.reviewedBy || 'system';
    const notes = req.body.notes || req.body.reason || null;

    await draftService.updateDraft(draftId, { notes });
    const updatedDraft = await draftService.updateStatus(draftId, 'rejected', reviewedBy);

    res.json({
      success: true,
      message: 'Draft rejected',
      draft: updatedDraft
    });
  } catch (error) {
    console.error('Error rejecting draft:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /drafts/{draftId}/merge:
 *   post:
 *     summary: Merge draft with existing clinic
 *     tags: [Drafts]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: draftId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: header
 *         name: X-Reviewed-By
 *         schema:
 *           type: string
 *         description: User who merged the draft
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - existingClinicId
 *             properties:
 *               existingClinicId:
 *                 type: integer
 *                 description: ID of existing clinic to merge with
 *               reviewedBy:
 *                 type: string
 *                 description: User who merged (alternative to header)
 *     responses:
 *       200:
 *         description: Draft merged successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 clinicId:
 *                   type: integer
 *                 clinicName:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         description: Invalid draft ID or clinic ID, or missing required fields
 *       401:
 *         description: Unauthorized
 */
router.post('/:draftId/merge', async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    const existingClinicId = parseInt(req.body.existingClinicId);
    
    if (isNaN(draftId) || isNaN(existingClinicId)) {
      return res.status(400).json({ error: 'Invalid draft ID or clinic ID' });
    }

    const reviewedBy = req.headers['x-reviewed-by'] || req.body.reviewedBy || 'system';
    
    // Update draft to link to existing clinic
    await draftService.updateDraft(draftId, {
      duplicateClinicID: existingClinicId
    });

    // Approve the draft (which will update the existing clinic)
    const clinicCreationService = require('../services/clinicCreationService');
    const result = await clinicCreationService.createClinicFromDraft(draftId, reviewedBy);

    res.json({
      success: true,
      message: 'Draft merged with existing clinic',
      ...result
    });
  } catch (error) {
    console.error('Error merging draft:', error);
    res.status(400).json({
      error: 'Failed to merge draft',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /drafts/{draftId}/reject-duplicate:
 *   post:
 *     summary: Mark duplicate detection as false positive
 *     tags: [Drafts]
 *     security:
 *       - ApiKeyAuth: []
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
 *                 description: Reason why this is not a duplicate
 *     responses:
 *       200:
 *         description: Duplicate flag removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 draft:
 *                   type: object
 *       400:
 *         description: Invalid draft ID
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/:draftId/reject-duplicate', async (req, res) => {
  try {
    const draftId = parseInt(req.params.draftId);
    if (isNaN(draftId)) {
      return res.status(400).json({ error: 'Invalid draft ID' });
    }

    // Just update notes, keep draft in pending_review status
    const notes = `Duplicate rejected: ${req.body.reason || 'Not a duplicate'}`;
    const updatedDraft = await draftService.updateDraft(draftId, { notes });

    res.json({
      success: true,
      message: 'Duplicate flag removed',
      draft: updatedDraft
    });
  } catch (error) {
    console.error('Error rejecting duplicate:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

