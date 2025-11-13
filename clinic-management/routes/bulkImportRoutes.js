const express = require('express');
const multer = require('multer');
const bulkImportService = require('../services/bulkImportService');
const { generateTemplateBuffer } = require('../utils/templateGenerator');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /bulk-import:
 *   post:
 *     summary: Upload Excel file and create drafts
 *     tags: [Bulk Import]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Excel file with clinic data
 *     parameters:
 *       - in: header
 *         name: X-Submitted-By
 *         schema:
 *           type: string
 *         description: User identifier (optional)
 *     responses:
 *       200:
 *         description: Bulk import successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 draftsCreated:
 *                   type: number
 *                 duplicatesFound:
 *                   type: number
 *                 drafts:
 *                   type: array
 *       400:
 *         description: Validation failed or no file uploaded
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const submittedBy = req.headers['x-submitted-by'] || 'unknown';
    const result = await bulkImportService.processBulkImport(req.file.buffer, submittedBy);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in bulk import:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /bulk-import/validate:
 *   post:
 *     summary: Validate Excel file without creating drafts
 *     tags: [Bulk Import]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Validation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isValid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                 warnings:
 *                   type: array
 *       401:
 *         description: Unauthorized
 */
router.post('/validate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await bulkImportService.validateFile(req.file.buffer);
    res.json(result);
  } catch (error) {
    console.error('Error validating file:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /bulk-import/template:
 *   get:
 *     summary: Download Excel template file
 *     tags: [Bulk Import]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Excel template file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 */
router.get('/template', (req, res) => {
  try {
    const buffer = generateTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="clinic-import-template.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('Error generating template:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

