/**
 * API Key authentication middleware
 * Validates X-API-Key header against environment variable
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.CLINIC_MANAGEMENT_API_KEY;

  if (!expectedKey) {
    console.error('CLINIC_MANAGEMENT_API_KEY not configured');
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'API key authentication not configured'
    });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key'
    });
  }

  next();
}

/**
 * Optional API key authentication middleware
 * Allows requests with or without API key (for public form submissions)
 */
function optionalApiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.CLINIC_MANAGEMENT_API_KEY;

  // If API key is provided, validate it
  if (apiKey && expectedKey && apiKey !== expectedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key'
    });
  }

  // Allow request to proceed (with or without API key)
  next();
}

module.exports = {
  apiKeyAuth,
  optionalApiKeyAuth
};

