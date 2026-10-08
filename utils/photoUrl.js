/**
 * Serve-time construction of Google Places photo URLs.
 *
 * ## Why this file exists
 *
 * On 2026-10-07 every clinic card on the search page showed a broken image.
 * The cause was that the full Places photo URL -- API key included -- was
 * *persisted* to `ClinicPhotos.PhotoURL`, and `search-index` served that
 * stored string straight to the browser. `utils/googlePlaces.js` read the key
 * once at module load, so a process that booted with a blank
 * `GOOGLE_PLACES_API_KEY` built `...photo?key=&photoreference=...`. The GLO-73
 * photo refresh then rewrote all 3,909 rows with that emptiness, and no
 * redeploy could undo it: the key had become data.
 *
 * ## The rule this module enforces
 *
 * The API key is a *credential*, not a column. Only `PhotoReference` is
 * persisted; the key is read from the environment at the moment of use and
 * spliced in on the way out. Three properties follow for free:
 *
 *   1. A key rotation or a blank env var can never corrupt stored rows.
 *   2. The key is never serialised into an HTTP response -- clients get a
 *      URL on *our* photo proxy, and the proxy is what talks to Google.
 *   3. A blank key fails loudly at the point of use (see
 *      `requireGooglePlacesApiKey`) instead of silently producing a URL that
 *      Google answers with 403.
 */

const GOOGLE_PHOTO_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/photo';

// Named sizes the photo proxy accepts, and the `maxwidth` each maps to.
const PHOTO_SIZE_WIDTHS = {
  thumbnail: 400,  // search/listing cards
  medium: 800,     // gallery previews, the search-index primary photo
  large: 1600      // full screen (Google's documented maximum)
};

const DEFAULT_PHOTO_SIZE = 'medium';

// Any `key=` / `api_key=` query parameter, however it is spelled. Used both to
// redact for logs and to assert that nothing key-bearing escapes to a client.
const API_KEY_PARAM = /([?&](?:key|api_?key)=)([^&#\s"']*)/gi;

/**
 * Thrown when a Places photo URL is requested but no API key is configured.
 *
 * Distinct from a generic Error so callers can tell "we are misconfigured"
 * (a 503 that an operator must fix) apart from "this row has no photo"
 * (a 404 that is normal).
 */
class MissingPlacesApiKeyError extends Error {
  constructor(context) {
    super(
      'GOOGLE_PLACES_API_KEY is empty or unset; refusing to build a Google ' +
      'Places photo URL' + (context ? ` (${context})` : '')
    );
    this.name = 'MissingPlacesApiKeyError';
    this.code = 'MISSING_PLACES_API_KEY';
    this.context = context || null;
  }
}

/**
 * Read the Places API key from the environment *now*.
 *
 * Deliberately not hoisted to module scope. The incident this module exists to
 * prevent was caused by a module-load capture: the process that ran the photo
 * refresh had booted before the key was present, so it held `undefined`
 * forever and a later redeploy was required to even notice. Reading per call
 * means a corrected environment takes effect on the next request.
 *
 * Returns `null` rather than `''`/`undefined` so there is exactly one falsy
 * shape for callers to handle -- the original bug produced the *empty string*,
 * which template-interpolated into a plausible-looking but invalid URL.
 */
function getGooglePlacesApiKey() {
  const raw = process.env.GOOGLE_PLACES_API_KEY;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The guard. Return the key, or log loudly and throw.
 *
 * Every path that could put a key into a URL goes through here, so "serve a
 * photo URL with an empty key" is unrepresentable rather than merely
 * discouraged. The log is deliberately shouty and names the remedy: the
 * failure mode it replaces was a silent success that destroyed 3,909 rows.
 *
 * @param {string} [context] - where this was called from, for the log line.
 */
function requireGooglePlacesApiKey(context) {
  const key = getGooglePlacesApiKey();

  if (!key) {
    console.error(
      '[photoUrl] FATAL: GOOGLE_PLACES_API_KEY is empty or unset. ' +
      'Refusing to construct a Google Places photo URL' +
      (context ? ` for ${context}` : '') + '. ' +
      'Photos will 404 until the environment variable is set. ' +
      'This guard exists because a blank key previously produced ' +
      '"?key=&photoreference=..." URLs that Google answers with 403.'
    );
    throw new MissingPlacesApiKeyError(context);
  }

  return key;
}

/**
 * Is this string a real Google Places photo reference?
 *
 * `ClinicPhotos.PhotoReference` is NOT NULL, so rows that have no Google
 * reference carry a synthetic one instead: `user-upload-<clinic>-<n>` for
 * genuine uploads, and `google-<clinic>-<n>` for an older import that never
 * captured the real reference. Neither is valid at Google's photo endpoint --
 * for those rows `PhotoURL` is the authoritative value, not a derived one.
 *
 * Real references are opaque and long (400+ characters in the current data);
 * the length floor is a backstop against some other short sentinel appearing.
 */
function isGooglePhotoReference(reference) {
  if (typeof reference !== 'string') return false;

  const trimmed = reference.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('user-upload')) return false;
  if (trimmed.startsWith('google-')) return false;

  return trimmed.length > 40;
}

/** Map a named size (or an explicit width) to a `maxwidth` value. */
function resolveMaxWidth({ size, maxWidth } = {}) {
  if (Number.isFinite(maxWidth) && maxWidth > 0) {
    return Math.min(Math.round(maxWidth), PHOTO_SIZE_WIDTHS.large);
  }
  return PHOTO_SIZE_WIDTHS[size] || PHOTO_SIZE_WIDTHS[DEFAULT_PHOTO_SIZE];
}

/**
 * Build a key-bearing Places photo URL. **Server-side use only.**
 *
 * The result carries the live credential, so it may be handed to axios and it
 * may be logged only after `redactApiKey`. It must never be persisted and must
 * never reach an HTTP response body -- give clients a photo-proxy URL
 * (`photoProxyUrl`) instead.
 *
 * @throws {MissingPlacesApiKeyError} if the key is blank/unset.
 * @throws {TypeError} if `reference` is not a usable Google reference.
 */
function buildGooglePhotoUrl(reference, { size, maxWidth, context } = {}) {
  if (!isGooglePhotoReference(reference)) {
    throw new TypeError(
      'buildGooglePhotoUrl requires a Google Places photo reference' +
      (context ? ` (${context})` : '')
    );
  }

  const key = requireGooglePlacesApiKey(context);
  const width = resolveMaxWidth({ size, maxWidth });

  return `${GOOGLE_PHOTO_ENDPOINT}` +
    `?key=${encodeURIComponent(key)}` +
    `&photoreference=${encodeURIComponent(reference.trim())}` +
    `&maxwidth=${width}`;
}

/**
 * Build a Places photo URL with *no* key, for the NOT NULL `PhotoURL` column.
 *
 * `ClinicPhotos.PhotoURL` cannot be nulled out, so the refresh job has to
 * write something. It writes this: a URL that records which photo the row
 * refers to and is self-evidently incomplete. Nothing reads it for Google
 * rows any more, and should some future caller fetch it, Google's error is
 * "missing key" -- a correct, actionable complaint -- rather than the silent
 * breakage of a stored key that has since been rotated away.
 */
function buildKeylessGooglePhotoUrl(reference, { size, maxWidth } = {}) {
  const width = resolveMaxWidth({ size, maxWidth });
  const trimmed = typeof reference === 'string' ? reference.trim() : '';

  return `${GOOGLE_PHOTO_ENDPOINT}` +
    `?photoreference=${encodeURIComponent(trimmed)}` +
    `&maxwidth=${width}`;
}

/** Replace any `key=`/`api_key=` value with `REDACTED`. Safe for logs. */
function redactApiKey(value) {
  if (typeof value !== 'string') return value;
  return value.replace(API_KEY_PARAM, '$1REDACTED');
}

/** Does this URL carry a non-empty API key parameter? */
function containsApiKey(value) {
  if (typeof value !== 'string') return false;
  API_KEY_PARAM.lastIndex = 0;
  let match;
  while ((match = API_KEY_PARAM.exec(value)) !== null) {
    if (match[2] && match[2].length > 0) {
      API_KEY_PARAM.lastIndex = 0;
      return true;
    }
  }
  return false;
}

/**
 * Can this stored URL be handed to a browser as-is?
 *
 * True for user uploads on S3/a CDN, and for the keyless
 * `streetviewpixels-pa.googleapis.com` thumbnails that `GooglePlacesData.Photo`
 * holds for a handful of clinics. False for anything on the Places photo
 * endpoint (that needs a key, so it goes through our proxy) and false for
 * anything carrying a key (which must not be published -- 35 rows in
 * production currently embed a live key in plaintext).
 */
function isDirectlyServablePhotoUrl(value) {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (trimmed.startsWith(GOOGLE_PHOTO_ENDPOINT)) return false;
  if (/maps\.googleapis\.com\/maps\/api\/place\/photo/i.test(trimmed)) return false;
  if (containsApiKey(trimmed)) return false;

  return true;
}

/** A URL on our own photo proxy for a given `ClinicPhotos.PhotoID`. */
function photoProxyUrl(baseURL, photoId, size = DEFAULT_PHOTO_SIZE) {
  const root = typeof baseURL === 'string' ? baseURL.replace(/\/+$/, '') : '';
  const sizeParam = PHOTO_SIZE_WIDTHS[size] ? size : DEFAULT_PHOTO_SIZE;
  return `${root}/api/photos/proxy/${photoId}?size=${sizeParam}`;
}

/**
 * Decide what a client should be told to fetch for a clinic's primary photo.
 *
 * Preference order, and why:
 *
 *   1. A `ClinicPhotos` row with a real Google reference -> our photo proxy.
 *      The proxy constructs the key-bearing URL per request, caches the bytes,
 *      and keeps the credential server-side.
 *   2. That row's own `PhotoURL`, when it is directly servable -- a user
 *      upload. These rows have no Google reference and their stored URL *is*
 *      the authoritative value.
 *   3. `GooglePlacesData.Photo`, when directly servable -- the keyless Street
 *      View thumbnails.
 *   4. `null`. An explicit "no photo" that the frontend renders as a
 *      placeholder, which is the defined fallback for a row with neither a
 *      usable reference nor a usable URL. A broken <img> is not acceptable;
 *      omitting the field is.
 *
 * Note what is *absent*: `ClinicPhotos.PhotoURL` for a Google-referenced row
 * is never consulted. That is the whole fix -- those 3,874 poisoned strings
 * became unread data the moment this function was wired in, which is why the
 * live incident needed no UPDATE to repair.
 *
 * @returns {string|null}
 */
function resolvePrimaryPhotoUrl({
  baseURL,
  photoId = null,
  photoReference = null,
  photoUrl = null,
  googlePhoto = null,
  size = DEFAULT_PHOTO_SIZE
} = {}) {
  if (photoId != null && isGooglePhotoReference(photoReference)) {
    return photoProxyUrl(baseURL, photoId, size);
  }

  if (photoId != null && isDirectlyServablePhotoUrl(photoUrl)) {
    return photoUrl.trim();
  }

  if (isDirectlyServablePhotoUrl(googlePhoto)) {
    return googlePhoto.trim();
  }

  return null;
}

module.exports = {
  GOOGLE_PHOTO_ENDPOINT,
  PHOTO_SIZE_WIDTHS,
  DEFAULT_PHOTO_SIZE,
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
};
