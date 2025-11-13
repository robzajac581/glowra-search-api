const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Clinic Management API',
      version: '1.0.0',
      description: 'API for managing clinic submissions, bulk imports, duplicate detection, and draft/approval workflows',
      contact: {
        name: 'Glowra API Support'
      }
    },
    servers: [
      // Dynamically set server based on environment
      {
        url: process.env.NODE_ENV === 'production' 
          ? (process.env.API_BASE_URL || 'https://glowra-search-api.onrender.com') + '/api/clinic-management'
          : 'http://localhost:3001/api/clinic-management',
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
      },
      // Include alternate server for easy switching
      ...(process.env.NODE_ENV === 'production' ? [{
        url: 'http://localhost:3001/api/clinic-management',
        description: 'Development server (local only)'
      }] : [{
        url: (process.env.API_BASE_URL || 'https://glowra-search-api.onrender.com') + '/api/clinic-management',
        description: 'Production server'
      }])
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for authentication'
        }
      }
    },
    tags: [
      {
        name: 'Bulk Import',
        description: 'Excel file upload and validation endpoints'
      },
      {
        name: 'Drafts',
        description: 'Draft management endpoints'
      },
      {
        name: 'Duplicates',
        description: 'Duplicate detection endpoints'
      },
      {
        name: 'Forms',
        description: 'Form submission endpoints'
      },
      {
        name: 'Health',
        description: 'Health check endpoint'
      }
    ]
  },
  apis: [
    path.join(__dirname, 'routes', '*.js'),
    path.join(__dirname, 'index.js')
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  swaggerSpec
};

