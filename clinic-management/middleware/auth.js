/**
 * API Key authentication middleware
 * Validates X-API-Key header against environment variable
 */

const ENV_VAR = 'CLINIC_MANAGEMENT_API_KEY';

/**
 * Routes that are mounted behind apiKeyAuth and therefore stop working
 * entirely when the key is not configured. Used in the startup banner.
 */
const PROTECTED_ROUTE_GROUPS = [
  '/api/clinic-management/bulk-import',
  '/api/clinic-management/drafts',
  '/api/clinic-management/duplicates'
];

/**
 * Whether the clinic-management API key is configured.
 * @returns {boolean}
 */
function isApiKeyConfigured() {
  const key = process.env[ENV_VAR];
  return typeof key === 'string' && key.length > 0;
}

/**
 * Startup configuration check.
 *
 * Call this once at boot so a missing key surfaces in the deploy log rather
 * than silently at first use. By default this only logs -- the clinic-management
 * key is not needed by the public search endpoints, so a hard exit would turn a
 * partial outage into a total one. Set CLINIC_MANAGEMENT_STRICT_CONFIG=true to
 * make a missing key fatal at boot (recommended once the key is set in every
 * environment).
 *
 * @param {object} [options]
 * @param {boolean} [options.strict] - Override the env-var-driven strict mode.
 * @returns {boolean} true when the key is configured
 */
function checkApiKeyConfig({ strict } = {}) {
  if (isApiKeyConfigured()) {
    return true;
  }

  const isStrict =
    strict !== undefined
      ? strict
      : process.env.CLINIC_MANAGEMENT_STRICT_CONFIG === 'true';

  const banner = [
    '',
    '='.repeat(72),
    `MISCONFIGURATION: ${ENV_VAR} is not set.`,
    '',
    'The following route groups will reject every request until it is:',
    ...PROTECTED_ROUTE_GROUPS.map((r) => `  - ${r}`),
    '',
    `Set ${ENV_VAR} in this environment (Render > glowra-search-api >`,
    'Environment) and redeploy.',
    '='.repeat(72),
    ''
  ].join('\n');

  console.error(banner);

  if (isStrict) {
    throw new Error(
      `${ENV_VAR} is not set and CLINIC_MANAGEMENT_STRICT_CONFIG is enabled; refusing to start.`
    );
  }

  return false;
}

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env[ENV_VAR];

  if (!expectedKey) {
    // Log the reason server-side, but do not tell an unauthenticated caller
    // how the service is misconfigured. 503 is the honest status: the
    // endpoint exists and is expected to work, but cannot right now.
    console.error(
      `${ENV_VAR} not configured - refusing ${req.method} ${req.originalUrl}`
    );
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'This endpoint is temporarily unavailable. Please try again later.'
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
  const expectedKey = process.env[ENV_VAR];

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
  optionalApiKeyAuth,
  checkApiKeyConfig,
  isApiKeyConfigured,
  PROTECTED_ROUTE_GROUPS,
  ENV_VAR
};
