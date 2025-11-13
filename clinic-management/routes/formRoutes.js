const express = require('express');
const formIntegrationService = require('../services/formIntegrationService');

const router = express.Router();

/**
 * @swagger
 * /forms/submit:
 *   post:
 *     summary: Accept form submission and create draft
 *     tags: [Forms]
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
 *               - city
 *               - state
 *             properties:
 *               requestId:
 *                 type: string
 *                 format: uuid
 *                 description: Link to ClinicListingRequest if applicable
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
 *               clinicCategory:
 *                 type: string
 *               category:
 *                 type: string
 *               message:
 *                 type: string
 *               additionalDetails:
 *                 type: string
 *     responses:
 *       201:
 *         description: Form submission received and draft created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 draftId:
 *                   type: integer
 *                 status:
 *                   type: string
 *       500:
 *         description: Internal server error
 */
router.post('/submit', async (req, res) => {
  try {
    const draft = await formIntegrationService.createDraftFromForm(req.body);
    
    res.status(201).json({
      success: true,
      message: 'Form submission received and draft created',
      draftId: draft.DraftID,
      status: draft.Status
    });
  } catch (error) {
    console.error('Error processing form submission:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /forms/adjustment:
 *   post:
 *     summary: Handle adjustment request for existing clinic
 *     tags: [Forms]
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
 *               - city
 *               - state
 *             properties:
 *               requestId:
 *                 type: string
 *                 format: uuid
 *               existingClinicId:
 *                 type: integer
 *                 description: ID of existing clinic to adjust
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
 *               clinicCategory:
 *                 type: string
 *               message:
 *                 type: string
 *               additionalDetails:
 *                 type: string
 *     responses:
 *       201:
 *         description: Adjustment request received and draft created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 draftId:
 *                   type: integer
 *                 status:
 *                   type: string
 *       500:
 *         description: Internal server error
 */
router.post('/adjustment', async (req, res) => {
  try {
    const draft = await formIntegrationService.createDraftFromForm({
      ...req.body,
      requestType: 'adjustment'
    });
    
    res.status(201).json({
      success: true,
      message: 'Adjustment request received and draft created',
      draftId: draft.DraftID,
      status: draft.Status
    });
  } catch (error) {
    console.error('Error processing adjustment request:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /forms/requests/{requestId}:
 *   get:
 *     summary: Get draft linked to a request ID
 *     tags: [Forms]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Request ID (UUID) linked to ClinicListingRequest
 *     responses:
 *       200:
 *         description: Draft found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 DraftID:
 *                   type: integer
 *                 RequestID:
 *                   type: string
 *                   format: uuid
 *                 ClinicName:
 *                   type: string
 *                 Status:
 *                   type: string
 *                 providers:
 *                   type: array
 *                 procedures:
 *                   type: array
 *       404:
 *         description: No draft found for this request ID
 *       500:
 *         description: Internal server error
 */
router.get('/requests/:requestId', async (req, res) => {
  try {
    const draftService = require('../services/draftService');
    const drafts = await draftService.listDrafts({
      // Note: This assumes RequestID is searchable - may need to add specific query
    });

    const matchingDraft = drafts.find(d => d.RequestID === req.params.requestId);
    
    if (!matchingDraft) {
      return res.status(404).json({ error: 'No draft found for this request ID' });
    }

    const fullDraft = await draftService.getDraftById(matchingDraft.DraftID);
    res.json(fullDraft);
  } catch (error) {
    console.error('Error getting draft by request ID:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

