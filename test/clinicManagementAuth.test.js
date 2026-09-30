const test = require('node:test');
const assert = require('node:assert');

const {
  apiKeyAuth,
  checkApiKeyConfig,
  isApiKeyConfigured,
  ENV_VAR
} = require('../clinic-management/middleware/auth');

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function makeReq(headers = {}) {
  return { headers, method: 'GET', originalUrl: '/api/clinic-management/drafts' };
}

function withEnv(value, fn) {
  const previous = process.env[ENV_VAR];
  const previousStrict = process.env.CLINIC_MANAGEMENT_STRICT_CONFIG;
  if (value === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = value;
  }
  // Silence the intentional console.error noise from the middleware/banner.
  const originalError = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = originalError;
    if (previous === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = previous;
    if (previousStrict === undefined) delete process.env.CLINIC_MANAGEMENT_STRICT_CONFIG;
    else process.env.CLINIC_MANAGEMENT_STRICT_CONFIG = previousStrict;
  }
}

test('apiKeyAuth returns 503, not 500, when the key is unconfigured', () => {
  withEnv(undefined, () => {
    const res = makeRes();
    let nextCalled = false;
    apiKeyAuth(makeReq(), res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 503);
  });
});

test('unconfigured response does not disclose the misconfiguration', () => {
  withEnv(undefined, () => {
    const res = makeRes();
    apiKeyAuth(makeReq(), res, () => {});

    const serialized = JSON.stringify(res.body).toLowerCase();
    assert.ok(!serialized.includes('api key'), 'must not mention API keys');
    assert.ok(!serialized.includes('configur'), 'must not mention configuration');
    assert.ok(!serialized.includes(ENV_VAR.toLowerCase()), 'must not name the env var');
  });
});

test('apiKeyAuth still rejects a bad key with 401 when configured', () => {
  withEnv('correct-key', () => {
    const res = makeRes();
    apiKeyAuth(makeReq({ 'x-api-key': 'wrong-key' }), res, () => {});
    assert.strictEqual(res.statusCode, 401);
  });
});

test('apiKeyAuth passes a matching key through', () => {
  withEnv('correct-key', () => {
    const res = makeRes();
    let nextCalled = false;
    apiKeyAuth(makeReq({ 'x-api-key': 'correct-key' }), res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, null);
  });
});

test('checkApiKeyConfig reports false and does not throw by default', () => {
  withEnv(undefined, () => {
    assert.strictEqual(isApiKeyConfigured(), false);
    assert.strictEqual(checkApiKeyConfig(), false);
  });
});

test('checkApiKeyConfig throws at boot in strict mode', () => {
  withEnv(undefined, () => {
    assert.throws(() => checkApiKeyConfig({ strict: true }), /not set/);
  });
});

test('checkApiKeyConfig is satisfied when the key is present', () => {
  withEnv('a-key', () => {
    assert.strictEqual(checkApiKeyConfig({ strict: true }), true);
  });
});
