const express = require('express');
const bulkImportRoutes = require('./routes/bulkImportRoutes');
const draftRoutes = require('./routes/draftRoutes');
const duplicateRoutes = require('./routes/duplicateRoutes');
const formRoutes = require('./routes/formRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const { apiKeyAuth, optionalApiKeyAuth } = require('./middleware/auth');
const { swaggerUi, swaggerSpec } = require('./swagger');

const router = express.Router();

// Swagger UI documentation (no auth required for viewing docs)
router.use('/docs', swaggerUi.serve);
router.get('/docs', (req, res, next) => {
  // Dynamically set server URL based on request host
  // Handle proxy headers (Render, Heroku, etc. use X-Forwarded-* headers)
  const protocol = req.get('x-forwarded-proto') || req.protocol || (req.secure ? 'https' : 'http');
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3001';
  const baseUrl = `${protocol}://${host}/api/clinic-management`;
  
  // Create a modified spec with the current host as the first server
  const dynamicSpec = {
    ...swaggerSpec,
    servers: [
      {
        url: baseUrl,
        description: host.includes('localhost') ? 'Current server (Development)' : 'Current server (Production)'
      },
      // Keep other servers for easy switching
      ...swaggerSpec.servers.filter(s => s.url !== baseUrl)
    ]
  };
  
  const swaggerHandler = swaggerUi.setup(dynamicSpec, {
    customSiteTitle: 'Clinic Management API Documentation',
    customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .auth-wrapper { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 4px; }
    .swagger-ui .auth-btn-wrapper { margin: 10px 0; }
    .swagger-ui .authorize { background-color: #4CAF50; border-color: #4CAF50; }
    .swagger-ui .authorize:hover { background-color: #45a049; }
    .swagger-ui .btn.authorize { background-color: #4CAF50; border-color: #4CAF50; }
    .swagger-ui .btn.authorize:hover { background-color: #45a049; }
    .swagger-ui .btn-done { background-color: #2196F3; border-color: #2196F3; }
    .swagger-ui .btn-done:hover { background-color: #0b7dda; }
    .swagger-ui .auth-container { margin-bottom: 20px; }
    .swagger-ui .auth-container .auth-btn-wrapper { margin-top: 10px; }
    .swagger-ui .scheme-container { background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    .auth-success-indicator { 
      color: #4CAF50; 
      margin-top: 8px; 
      font-size: 13px; 
      font-weight: 600;
      display: none;
    }
    .auth-success-indicator.show { display: block; }
  `,
    customCssUrl: null,
    customJs: `
    window.addEventListener('load', function() {
      // Monitor authorization changes
      const observer = new MutationObserver(function(mutations) {
        checkAuthStatus();
      });
      
      function checkAuthStatus() {
        const authInputs = document.querySelectorAll('.auth-container input[type="password"], .auth-container input[type="text"]');
        authInputs.forEach(function(input) {
          const container = input.closest('.auth-container') || input.closest('.auth-wrapper');
          if (container) {
            let indicator = container.querySelector('.auth-success-indicator');
            if (!indicator) {
              indicator = document.createElement('div');
              indicator.className = 'auth-success-indicator';
              indicator.innerHTML = '✓ API Key configured and saved';
              container.appendChild(indicator);
            }
            
            if (input.value && input.value.length > 0) {
              indicator.classList.add('show');
            } else {
              indicator.classList.remove('show');
            }
          }
        });
      }
      
      // Check initially
      setTimeout(checkAuthStatus, 500);
      
      // Watch for changes
      const targetNode = document.querySelector('.swagger-ui');
      if (targetNode) {
        observer.observe(targetNode, { childList: true, subtree: true });
      }
      
      // Also check when authorize button is clicked
      document.addEventListener('click', function(e) {
        if (e.target.classList.contains('btn-done') || e.target.classList.contains('authorize')) {
          setTimeout(checkAuthStatus, 300);
        }
      });
    });
  `,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch']
    }
  });
  
  return swaggerHandler(req, res, next);
});

// Swagger JSON endpoint
router.get('/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Apply API key auth to all routes except form/wizard submissions
router.use('/bulk-import', apiKeyAuth, bulkImportRoutes);
router.use('/drafts', apiKeyAuth, draftRoutes);
router.use('/duplicates', apiKeyAuth, duplicateRoutes);
router.use('/forms', optionalApiKeyAuth, formRoutes); // Form routes use optional auth
router.use('/submissions', submissionRoutes); // Public - no API key required for wizard submissions

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 service:
 *                   type: string
 *                 timestamp:
 *                   type: string
 */
// Health check endpoint (no auth required)
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'clinic-management',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

