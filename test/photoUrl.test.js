/**
 * The 2026-10-07 photo outage, as executable assertions.
 *
 * Every clinic card on the search page showed a broken image because the
 * Places API key had been persisted *into* `ClinicPhotos.PhotoURL`. A process
 * that booted with a blank `GOOGLE_PLACES_API_KEY` wrote
 * `...photo?key=&photoreference=...` to all 3,909 rows, and no redeploy could
 * repair it, because the credential had become data.
 *
 * These tests pin the three properties that make that impossible again:
 * the key is read at use rather than at module load, a blank key throws rather
 * than interpolating, and nothing key-bearing is ever offered to a client.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  GOOGLE_PHOTO_ENDPOINT,
  MissingPlacesApiKeyError,
  getGooglePlacesApiKey,
  requireGooglePlacesApiKey,
  isGooglePhotoReference,
  buildGooglePhotoUrl,
  buildKeylessGooglePhotoUrl,
  redactApiKey,
  containsApiKey,
  isDirectlyServablePhotoUrl,
  photoProxyUrl,
  resolvePrimaryPhotoUrl
} = require('../utils/photoUrl');

/** A reference long enough to pass the length floor; real ones run 400+ chars. */
const REF = 'Aa-ngMYvp4-27hf7Q3BxwOp4Vfa8lNqDLOMTduPn4FWA0XQafPP1DCQE-AmaxEVViZj';

/** Run `fn` with GOOGLE_PLACES_API_KEY set to `value`, then restore. */
function withKey(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'GOOGLE_PLACES_API_KEY');
  const previous = process.env.GOOGLE_PLACES_API_KEY;
  if (value === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = value;
  try {
    return fn();
  } finally {
    if (had) process.env.GOOGLE_PLACES_API_KEY = previous;
    else delete process.env.GOOGLE_PLACES_API_KEY;
  }
}

test('the key is read at use, not captured at module load', () => {
  // The original bug in one assertion: utils/googlePlaces.js read the key into
  // a module-scope const, so a process that booted without it held the stale
  // value for its whole life. Changing the environment must take effect now.
  withKey('first-value', () => {
    assert.strictEqual(getGooglePlacesApiKey(), 'first-value');
  });
  withKey('second-value', () => {
    assert.strictEqual(getGooglePlacesApiKey(), 'second-value');
  });
});

test('a blank key is normalised to null, never the empty string', () => {
  // `key=${''}` produced "?key=&photoreference=..." — a plausible-looking URL
  // that Google answers with 403. One falsy shape removes that whole class.
  withKey('', () => assert.strictEqual(getGooglePlacesApiKey(), null));
  withKey('   ', () => assert.strictEqual(getGooglePlacesApiKey(), null));
  withKey(undefined, () => assert.strictEqual(getGooglePlacesApiKey(), null));
});

test('requireGooglePlacesApiKey throws a typed error on a blank key', () => {
  withKey('', () => {
    assert.throws(
      () => requireGooglePlacesApiKey('unit test'),
      (err) => err instanceof MissingPlacesApiKeyError && err.code === 'MISSING_PLACES_API_KEY'
    );
  });
});

test('buildGooglePhotoUrl refuses to build anything with a blank key', () => {
  // The load-bearing assertion. If this ever returns a string, the outage is
  // reachable again.
  withKey('', () => {
    assert.throws(() => buildGooglePhotoUrl(REF), { code: 'MISSING_PLACES_API_KEY' });
  });
});

test('buildGooglePhotoUrl produces a key-bearing URL when configured', () => {
  withKey('test-key-123', () => {
    const url = buildGooglePhotoUrl(REF, { size: 'medium' });
    assert.ok(url.startsWith(GOOGLE_PHOTO_ENDPOINT));
    assert.ok(url.includes('key=test-key-123'));
    assert.ok(url.includes(`photoreference=${REF}`));
    assert.ok(url.includes('maxwidth=800'));
  });
});

test('synthetic references are not treated as Google references', () => {
  // PhotoReference is NOT NULL, so rows without a real Google reference carry
  // a sentinel. Sending one to Google's endpoint yields an error image; those
  // rows' own PhotoURL is authoritative instead.
  assert.ok(isGooglePhotoReference(REF));
  assert.ok(!isGooglePhotoReference('user-upload-123-0'));
  assert.ok(!isGooglePhotoReference('google-123-0'));
  assert.ok(!isGooglePhotoReference(''));
  assert.ok(!isGooglePhotoReference(null));
  assert.ok(!isGooglePhotoReference('short'));
});

test('a stored Places URL is never directly servable, with or without a key', () => {
  // Both shapes exist in production: 3,874 rows poisoned with a blank key by
  // the outage, and 35 rows carrying a live key in plaintext. Neither may be
  // handed to a browser — the first 403s, the second publishes a credential.
  assert.ok(!isDirectlyServablePhotoUrl(`${GOOGLE_PHOTO_ENDPOINT}?key=&photoreference=${REF}`));
  assert.ok(!isDirectlyServablePhotoUrl(`${GOOGLE_PHOTO_ENDPOINT}?key=AIzaSyLive&photoreference=${REF}`));
  // Keyless Street View thumbnails and user uploads are fine as-is.
  assert.ok(isDirectlyServablePhotoUrl('https://streetviewpixels-pa.googleapis.com/v1/thumbnail?p=abc'));
  assert.ok(isDirectlyServablePhotoUrl('https://cdn.example.com/uploads/clinic-1.jpg'));
  assert.ok(!isDirectlyServablePhotoUrl('not-a-url'));
  assert.ok(!isDirectlyServablePhotoUrl(null));
});

test('containsApiKey ignores an empty key parameter but catches a real one', () => {
  assert.ok(containsApiKey('https://x/y?key=AIzaSyReal123'));
  assert.ok(containsApiKey('https://x/y?api_key=abc'));
  assert.ok(!containsApiKey('https://x/y?key=&photoreference=z'));
  assert.ok(!containsApiKey('https://x/y?photoreference=z'));
});

test('redactApiKey masks the value and leaves the rest intact', () => {
  const redacted = redactApiKey(`${GOOGLE_PHOTO_ENDPOINT}?key=AIzaSySecret&photoreference=${REF}`);
  assert.ok(!redacted.includes('AIzaSySecret'));
  assert.ok(redacted.includes('key=REDACTED'));
  assert.ok(redacted.includes(`photoreference=${REF}`));
});

test('the keyless URL written to the NOT NULL column carries no credential', () => {
  withKey('test-key-123', () => {
    const url = buildKeylessGooglePhotoUrl(REF);
    assert.ok(!url.includes('key='));
    assert.ok(url.includes(`photoreference=${REF}`));
  });
});

test('a Google-referenced row resolves to our proxy, never to its stored URL', () => {
  // This is why the live incident needed no UPDATE: the poisoned strings
  // became unread data.
  const resolved = resolvePrimaryPhotoUrl({
    baseURL: 'https://api.example.com',
    photoId: 42,
    photoReference: REF,
    photoUrl: `${GOOGLE_PHOTO_ENDPOINT}?key=&photoreference=${REF}`,
    size: 'medium'
  });
  assert.strictEqual(resolved, 'https://api.example.com/api/photos/proxy/42?size=medium');
});

test('a user upload resolves to its own stored URL', () => {
  const resolved = resolvePrimaryPhotoUrl({
    baseURL: 'https://api.example.com',
    photoId: 7,
    photoReference: 'user-upload-7-0',
    photoUrl: 'https://cdn.example.com/uploads/clinic-7.jpg'
  });
  assert.strictEqual(resolved, 'https://cdn.example.com/uploads/clinic-7.jpg');
});

test('a row with neither a usable reference nor URL resolves to null', () => {
  // An explicit absence the frontend renders as a placeholder. A broken <img>
  // is not an acceptable fallback; omitting the field is.
  assert.strictEqual(
    resolvePrimaryPhotoUrl({ baseURL: 'https://api.example.com', photoId: 9, photoReference: 'google-9-0', photoUrl: null }),
    null
  );
  assert.strictEqual(resolvePrimaryPhotoUrl({ baseURL: 'https://api.example.com' }), null);
});

test('photoProxyUrl falls back to a known size and tolerates a trailing slash', () => {
  assert.strictEqual(photoProxyUrl('https://api.example.com/', 5, 'thumbnail'),
    'https://api.example.com/api/photos/proxy/5?size=thumbnail');
  assert.strictEqual(photoProxyUrl('https://api.example.com', 5, 'not-a-size'),
    'https://api.example.com/api/photos/proxy/5?size=medium');
});
