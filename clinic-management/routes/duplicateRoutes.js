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
 *               phone:
 *                 type: string
 *               website:
 *                 type: string
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
      clinicName: draft.ClinicName,
      address: draft.Address,
      city: draft.City,
      state: draft.State,
      phone: draft.Phone,
      website: draft.Website,
      placeID: draft.PlaceID
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

