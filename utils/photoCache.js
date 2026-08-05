const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// On-disk cache shared by the photo proxy endpoint and the refresh job.
// Both must derive cache keys the same way, otherwise the refresh job
// silently fails to invalidate entries the proxy is still serving.
const PHOTO_CACHE_DIR = path.join(__dirname, '..', '.photo-cache');
const PHOTO_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const PHOTO_SIZES = ['thumbnail', 'medium', 'large'];

function cacheKeyForPhoto(photoId, size) {
  return crypto.createHash('md5').update(`${photoId}-${size}`).digest('hex');
}

/**
 * Mark every cached size of a photo as expired, without deleting the image.
 *
 * Used when a photo's underlying Google reference changes. The next request
 * revalidates against Google, but the previously cached image stays on disk so
 * it can still be served as a fallback if that fetch fails (e.g. rate limiting).
 */
async function expirePhotoCache(photoId) {
  const expiredAt = new Date(Date.now() - PHOTO_CACHE_DURATION - 1000);

  await Promise.all(PHOTO_SIZES.map(async (size) => {
    const cacheFilePath = path.join(PHOTO_CACHE_DIR, `${cacheKeyForPhoto(photoId, size)}.jpg`);
    try {
      await fs.utimes(cacheFilePath, expiredAt, expiredAt);
    } catch (error) {
      // Nothing cached for this size - nothing to expire
    }
  }));
}

module.exports = {
  PHOTO_CACHE_DIR,
  PHOTO_CACHE_DURATION,
  PHOTO_SIZES,
  cacheKeyForPhoto,
  expirePhotoCache
};
