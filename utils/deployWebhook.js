const axios = require('axios');

/**
 * Triggers FE deployment webhook after published blog content changes.
 * Fails open so admin actions are not blocked by webhook issues.
 * Set FE_DEPLOY_HOOK_URL (preferred) or BLOG_FRONTEND_DEPLOY_WEBHOOK_URL.
 */
async function triggerFrontendDeploy(eventName, payload = {}) {
  const hookUrl = process.env.FE_DEPLOY_HOOK_URL || process.env.BLOG_FRONTEND_DEPLOY_WEBHOOK_URL;
  if (!hookUrl) {
    return { triggered: false, skipped: true, reason: 'missing_hook_url' };
  }

  try {
    const response = await axios.post(
      hookUrl,
      {
        source: 'glowra-search-api',
        event: eventName,
        timestamp: new Date().toISOString(),
        payload
      },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      triggered: true,
      status: response.status
    };
  } catch (error) {
    console.error('Failed to trigger FE deploy webhook:', error.message);
    return {
      triggered: false,
      skipped: false,
      error: error.message
    };
  }
}

module.exports = {
  triggerFrontendDeploy
};
