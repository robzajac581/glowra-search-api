/**
 * Bulk / single enrichment of clinic drafts from Google Places:
 * Place ID lookup (Find Place from Text), ratings, review payload, and Google photos.
 * Used by admin bulk endpoint and scripts/bulkEnrichPendingDraftsGoogle.js
 */

const { db, sql } = require('../../db');
const draftService = require('./draftService');
const { fetchGooglePlaceDetails, searchPlaceByText } = require('../../utils/googlePlaces');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map Google photo objects from parsePhotos to DraftPhotos shape (same as admin handleDraftGooglePhotos).
 * @param {Array} googlePhotos
 * @returns {Array}
 */
function formatGooglePhotosForDraft(googlePhotos) {
  if (!Array.isArray(googlePhotos)) return [];
  return googlePhotos.map((photo, index) => ({
    photoUrl: photo.urls?.large || photo.url,
    source: 'google',
    isPrimary: index === 0,
    photoType: 'clinic',
    width: photo.width || null,
    height: photo.height || null,
    displayOrder: index,
    reference: photo.reference || null
  }));
}

/**
 * List pending_review drafts with no PlaceID (candidates for lookup).
 * @param {object} opts
 * @param {number} [opts.limit=500]
 * @param {number|null} [opts.draftId] - If set, only this draft (must still match filters).
 * @returns {Promise<Array<{ DraftID: number }>>}
 */
async function listPendingDraftsMissingPlaceId({ limit = 500, draftId = null } = {}) {
  const pool = await db.getConnection();
  const request = pool.request();
  request.input('status', sql.NVarChar, 'pending_review');

  if (draftId != null) {
    request.input('draftId', sql.Int, draftId);
    const result = await request.query(`
      SELECT DraftID
      FROM ClinicDrafts
      WHERE DraftID = @draftId
        AND Status = @status
        AND (PlaceID IS NULL OR LTRIM(RTRIM(PlaceID)) = '')
    `);
    return result.recordset;
  }

  request.input('limit', sql.Int, Math.max(1, Math.min(limit, 10000)));
  const result = await request.query(`
    SELECT TOP (@limit) DraftID
    FROM ClinicDrafts
    WHERE Status = @status
      AND (PlaceID IS NULL OR LTRIM(RTRIM(PlaceID)) = '')
    ORDER BY SubmittedAt ASC
  `);
  return result.recordset;
}

function buildAddressLine(draft) {
  const parts = [draft.address, draft.city, draft.state, draft.zipCode].filter(
    (p) => p != null && String(p).trim() !== ''
  );
  return parts.join(', ');
}

/**
 * Enrich one draft: resolve Place ID if missing, then one Place Details call (with photos),
 * persist ratings + GoogleDataJSON + merged photos (user non-Google photos preserved).
 *
 * @param {number} draftId
 * @param {object} [options]
 * @param {number} [options.minConfidence=0] - Minimum search confidence to accept lookup (0–1).
 * @param {boolean} [options.dryRun=false] - If true, no DB writes; still calls Google APIs for preview.
 * @returns {Promise<object>} Result record with status and metadata.
 */
async function enrichDraftFromGoogle(draftId, options = {}) {
  const minConfidence = options.minConfidence ?? 0;
  const dryRun = options.dryRun ?? false;

  try {
    const draft = await draftService.getDraftById(draftId);
    if (!draft) {
      return { draftId, status: 'error', error: 'Draft not found' };
    }

    const hadPlaceId = !!(draft.placeId && String(draft.placeId).trim());
    let placeId = hadPlaceId ? String(draft.placeId).trim() : null;
    let searchResult = null;

    if (!placeId) {
      const clinicName = draft.clinicName;
      const address = buildAddressLine(draft);
      searchResult = await searchPlaceByText(clinicName, address);
      if (!searchResult) {
        return { draftId, status: 'skipped_no_place', clinicName: draft.clinicName };
      }
      if (searchResult.confidence < minConfidence) {
        return {
          draftId,
          status: 'skipped_low_confidence',
          confidence: searchResult.confidence,
          businessName: searchResult.name,
          formattedAddress: searchResult.formattedAddress
        };
      }
      placeId = searchResult.placeId;
    }

    const full = await fetchGooglePlaceDetails(placeId, true);
    if (!full) {
      return { draftId, status: 'skipped_details_not_found', placeId };
    }

    const { photos: googlePhotosRaw = [], ...googleDataForJson } = full;
    const googleDataJSON = JSON.stringify(googleDataForJson);

    const existingPhotos = draft.photos || [];
    const userPhotos = existingPhotos.filter((p) => p.source !== 'google');
    const formattedGoogle = formatGooglePhotosForDraft(googlePhotosRaw);
    const allPhotos = [...userPhotos, ...formattedGoogle];

    if (dryRun) {
      return {
        draftId,
        status: 'dry_run',
        placeId,
        confidence: searchResult?.confidence,
        businessName: searchResult?.name,
        formattedAddress: searchResult?.formattedAddress,
        preview: {
          rating: full.rating,
          reviewCount: full.reviewCount,
          googlePhotosCount: formattedGoogle.length,
          userPhotosKept: userPhotos.length,
          totalPhotosAfter: allPhotos.length
        }
      };
    }

    const patch = {
      googleRating: full.rating,
      googleReviewCount: full.reviewCount,
      googleDataJSON,
      photos: allPhotos
    };
    if (!hadPlaceId && searchResult) {
      patch.placeId = searchResult.placeId;
      patch.latitude = searchResult.latitude;
      patch.longitude = searchResult.longitude;
    }

    await draftService.updateDraft(draftId, patch);

    return {
      draftId,
      status: 'updated',
      placeId,
      confidence: searchResult?.confidence,
      businessName: searchResult?.name,
      rating: full.rating,
      reviewCount: full.reviewCount,
      googlePhotosCount: formattedGoogle.length
    };
  } catch (error) {
    return {
      draftId,
      status: 'error',
      error: error.message || String(error)
    };
  }
}

function summarizeResults(results) {
  const summary = {
    processed: results.length,
    updated: 0,
    dry_run: 0,
    skipped_no_place: 0,
    skipped_low_confidence: 0,
    skipped_details_not_found: 0,
    errors: 0
  };
  for (const r of results) {
    if (r.status === 'updated') summary.updated++;
    else if (r.status === 'dry_run') summary.dry_run++;
    else if (r.status === 'skipped_no_place') summary.skipped_no_place++;
    else if (r.status === 'skipped_low_confidence') summary.skipped_low_confidence++;
    else if (r.status === 'skipped_details_not_found') summary.skipped_details_not_found++;
    else if (r.status === 'error') summary.errors++;
  }
  return summary;
}

/**
 * Process all pending drafts missing PlaceID (or a single draft when draftId set).
 * @param {object} opts
 * @param {number} [opts.minConfidence=0]
 * @param {boolean} [opts.dryRun=false]
 * @param {number} [opts.limit=500]
 * @param {number|null} [opts.draftId]
 * @param {number} [opts.delayMs=200] - Pause between drafts (after each completes).
 */
async function bulkEnrichPendingDraftsMissingPlaceId(opts = {}) {
  const minConfidence = opts.minConfidence ?? 0;
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? 500;
  const draftId = opts.draftId ?? null;
  const delayMs = opts.delayMs ?? 200;

  const rows = await listPendingDraftsMissingPlaceId({ limit, draftId });
  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].DraftID;
    const r = await enrichDraftFromGoogle(id, { minConfidence, dryRun });
    results.push(r);
    if (delayMs > 0 && i + 1 < rows.length) {
      await sleep(delayMs);
    }
  }

  return {
    summary: summarizeResults(results),
    results
  };
}

module.exports = {
  enrichDraftFromGoogle,
  bulkEnrichPendingDraftsMissingPlaceId,
  listPendingDraftsMissingPlaceId,
  formatGooglePhotosForDraft,
  summarizeResults
};
