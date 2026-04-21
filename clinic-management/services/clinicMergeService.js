const { db, sql } = require('../../db');

/**
 * Service for merging duplicate clinics into a canonical clinic.
 * Current policy: used for exact PlaceID duplicate cleanup.
 */
class ClinicMergeService {
  /**
   * Merge one duplicate clinic into a canonical clinic.
   * @param {Object} params
   * @param {number} params.canonicalClinicId
   * @param {number} params.duplicateClinicId
   * @param {string|null} params.mergedBy
   * @param {string} params.reason
   * @param {string|null} params.notes
   * @param {string} params.source
   * @returns {Promise<Object>}
   */
  async mergeClinics(params) {
    const {
      canonicalClinicId,
      duplicateClinicId,
      mergedBy = null,
      reason = 'PlaceID exact match',
      notes = null,
      source = 'dedup-script'
    } = params;

    if (!Number.isInteger(canonicalClinicId) || !Number.isInteger(duplicateClinicId)) {
      throw new Error('canonicalClinicId and duplicateClinicId must be integers');
    }

    if (canonicalClinicId === duplicateClinicId) {
      throw new Error('Canonical and duplicate clinic IDs must be different');
    }

    const pool = await db.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const canonicalClinic = await this.getClinicById(canonicalClinicId, transaction);
      const duplicateClinic = await this.getClinicById(duplicateClinicId, transaction);

      if (!canonicalClinic) {
        throw new Error(`Canonical clinic not found: ${canonicalClinicId}`);
      }
      if (!duplicateClinic) {
        throw new Error(`Duplicate clinic not found: ${duplicateClinicId}`);
      }

      const duplicatePlaceId = (duplicateClinic.PlaceID || '').trim();
      const canonicalPlaceId = (canonicalClinic.PlaceID || '').trim();
      const placeId = canonicalPlaceId || duplicatePlaceId || null;

      const reparentedProviders = await this.reparentProviders(
        canonicalClinicId,
        duplicateClinicId,
        transaction
      );
      const reparentedPhotos = await this.reparentClinicPhotos(
        canonicalClinicId,
        duplicateClinicId,
        transaction
      );
      await this.reconcileGooglePlacesData(canonicalClinicId, duplicateClinicId, transaction);
      const repointedDrafts = await this.repointDraftReferences(
        canonicalClinicId,
        duplicateClinicId,
        transaction
      );

      const deletedClinicId = await this.archiveAndDeleteClinic(
        duplicateClinicId,
        mergedBy || 'clinic-merge-service',
        transaction
      );

      await this.insertMergeAudit(
        {
          canonicalClinicId,
          duplicateClinicId,
          placeId,
          reason,
          notes,
          mergedBy,
          source,
          reparentedProviders,
          reparentedPhotos,
          repointedDrafts
        },
        transaction
      );

      await transaction.commit();

      return {
        success: true,
        canonicalClinicId,
        duplicateClinicId,
        deletedClinicId,
        placeId,
        reparentedProviders,
        reparentedPhotos,
        repointedDrafts
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getClinicById(clinicId, transaction) {
    const request = new sql.Request(transaction);
    request.input('clinicId', sql.Int, clinicId);
    const result = await request.query(`
      SELECT
        ClinicID,
        ClinicName,
        Address,
        Latitude,
        Longitude,
        PlaceID,
        GoogleRating,
        GoogleReviewCount,
        Phone,
        Website,
        LocationID,
        Providers,
        GoogleReviewsJSON,
        LastRatingUpdate
      FROM Clinics
      WHERE ClinicID = @clinicId
    `);
    return result.recordset[0] || null;
  }

  async reparentProviders(canonicalClinicId, duplicateClinicId, transaction) {
    const request = new sql.Request(transaction);
    request.input('canonicalClinicId', sql.Int, canonicalClinicId);
    request.input('duplicateClinicId', sql.Int, duplicateClinicId);
    const result = await request.query(`
      UPDATE Providers
      SET ClinicID = @canonicalClinicId
      WHERE ClinicID = @duplicateClinicId
    `);
    return result.rowsAffected[0] || 0;
  }

  async reparentClinicPhotos(canonicalClinicId, duplicateClinicId, transaction) {
    const updateRequest = new sql.Request(transaction);
    updateRequest.input('canonicalClinicId', sql.Int, canonicalClinicId);
    updateRequest.input('duplicateClinicId', sql.Int, duplicateClinicId);

    const updateResult = await updateRequest.query(`
      UPDATE ClinicPhotos
      SET ClinicID = @canonicalClinicId
      WHERE ClinicID = @duplicateClinicId
    `);

    const dedupeRequest = new sql.Request(transaction);
    dedupeRequest.input('canonicalClinicId', sql.Int, canonicalClinicId);
    await dedupeRequest.query(`
      ;WITH RankedPhotos AS (
        SELECT
          PhotoID,
          ROW_NUMBER() OVER (
            PARTITION BY ClinicID, COALESCE(PhotoReference, ''), COALESCE(PhotoURL, '')
            ORDER BY IsPrimary DESC, DisplayOrder ASC, PhotoID ASC
          ) AS RowNum
        FROM ClinicPhotos
        WHERE ClinicID = @canonicalClinicId
      )
      DELETE FROM ClinicPhotos
      WHERE PhotoID IN (
        SELECT PhotoID
        FROM RankedPhotos
        WHERE RowNum > 1
      )
    `);

    return updateResult.rowsAffected[0] || 0;
  }

  async reconcileGooglePlacesData(canonicalClinicId, duplicateClinicId, transaction) {
    const canonicalRequest = new sql.Request(transaction);
    canonicalRequest.input('clinicId', sql.Int, canonicalClinicId);
    const canonicalResult = await canonicalRequest.query(`
      SELECT TOP 1 GoogleDataID
      FROM GooglePlacesData
      WHERE ClinicID = @clinicId
      ORDER BY GoogleDataID ASC
    `);

    const duplicateRequest = new sql.Request(transaction);
    duplicateRequest.input('clinicId', sql.Int, duplicateClinicId);
    const duplicateResult = await duplicateRequest.query(`
      SELECT TOP 1 GoogleDataID
      FROM GooglePlacesData
      WHERE ClinicID = @clinicId
      ORDER BY GoogleDataID ASC
    `);

    const hasCanonical = canonicalResult.recordset.length > 0;
    const hasDuplicate = duplicateResult.recordset.length > 0;

    if (!hasDuplicate) {
      return;
    }

    if (!hasCanonical) {
      const moveRequest = new sql.Request(transaction);
      moveRequest.input('canonicalClinicId', sql.Int, canonicalClinicId);
      moveRequest.input('duplicateClinicId', sql.Int, duplicateClinicId);
      await moveRequest.query(`
        UPDATE GooglePlacesData
        SET ClinicID = @canonicalClinicId
        WHERE ClinicID = @duplicateClinicId
      `);
      return;
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('duplicateClinicId', sql.Int, duplicateClinicId);
    await deleteRequest.query(`
      DELETE FROM GooglePlacesData
      WHERE ClinicID = @duplicateClinicId
    `);
  }

  async repointDraftReferences(canonicalClinicId, duplicateClinicId, transaction) {
    const request = new sql.Request(transaction);
    request.input('canonicalClinicId', sql.Int, canonicalClinicId);
    request.input('duplicateClinicId', sql.Int, duplicateClinicId);
    const result = await request.query(`
      UPDATE ClinicDrafts
      SET DuplicateClinicID = @canonicalClinicId
      WHERE DuplicateClinicID = @duplicateClinicId
    `);
    return result.rowsAffected[0] || 0;
  }

  async archiveAndDeleteClinic(clinicId, deletedBy, transaction) {
    const request = new sql.Request(transaction);
    request.input('clinicId', sql.Int, clinicId);
    const clinicResult = await request.query(`
      SELECT
        ClinicID,
        ClinicName,
        Address,
        Latitude,
        Longitude,
        PlaceID,
        GoogleRating,
        GoogleReviewCount,
        Phone,
        Website,
        LocationID,
        Providers,
        GoogleReviewsJSON,
        LastRatingUpdate
      FROM Clinics
      WHERE ClinicID = @clinicId
    `);

    if (clinicResult.recordset.length === 0) {
      throw new Error(`Clinic not found for archival: ${clinicId}`);
    }

    const clinic = clinicResult.recordset[0];

    const archiveRequest = new sql.Request(transaction);
    archiveRequest.input('originalClinicID', sql.Int, clinic.ClinicID);
    archiveRequest.input('clinicName', sql.NVarChar, clinic.ClinicName);
    archiveRequest.input('address', sql.NVarChar, clinic.Address);
    archiveRequest.input('latitude', sql.Decimal(10, 7), clinic.Latitude);
    archiveRequest.input('longitude', sql.Decimal(11, 7), clinic.Longitude);
    archiveRequest.input('placeID', sql.NVarChar, clinic.PlaceID);
    archiveRequest.input('googleRating', sql.Decimal(2, 1), clinic.GoogleRating);
    archiveRequest.input('googleReviewCount', sql.Int, clinic.GoogleReviewCount);
    archiveRequest.input('phone', sql.NVarChar, clinic.Phone);
    archiveRequest.input('website', sql.NVarChar, clinic.Website);
    archiveRequest.input('locationID', sql.Int, clinic.LocationID);
    archiveRequest.input('providers', sql.NVarChar(1000), clinic.Providers);
    archiveRequest.input('googleReviewsJSON', sql.NVarChar(sql.MAX), clinic.GoogleReviewsJSON);
    archiveRequest.input('lastRatingUpdate', sql.DateTime, clinic.LastRatingUpdate);
    archiveRequest.input('deletedBy', sql.NVarChar, deletedBy);

    const deletedResult = await archiveRequest.query(`
      INSERT INTO DeletedClinics (
        OriginalClinicID, ClinicName, Address, Latitude, Longitude, PlaceID,
        GoogleRating, GoogleReviewCount, Phone, Website, LocationID,
        Providers, GoogleReviewsJSON, LastRatingUpdate, DeletedBy
      )
      OUTPUT INSERTED.DeletedClinicID
      VALUES (
        @originalClinicID, @clinicName, @address, @latitude, @longitude, @placeID,
        @googleRating, @googleReviewCount, @phone, @website, @locationID,
        @providers, @googleReviewsJSON, @lastRatingUpdate, @deletedBy
      )
    `);

    const deletedClinicId = deletedResult.recordset[0].DeletedClinicID;

    const deleteClinicRequest = new sql.Request(transaction);
    deleteClinicRequest.input('clinicId', sql.Int, clinicId);
    await deleteClinicRequest.query(`
      DELETE FROM Clinics
      WHERE ClinicID = @clinicId
    `);

    return deletedClinicId;
  }

  async insertMergeAudit(data, transaction) {
    const request = new sql.Request(transaction);
    request.input('canonicalClinicId', sql.Int, data.canonicalClinicId);
    request.input('duplicateClinicId', sql.Int, data.duplicateClinicId);
    request.input('placeId', sql.NVarChar, data.placeId);
    request.input('mergeReason', sql.NVarChar, data.reason);
    request.input('mergeNotes', sql.NVarChar(sql.MAX), data.notes);
    request.input('mergedBy', sql.NVarChar, data.mergedBy);
    request.input('mergeSource', sql.NVarChar, data.source);
    request.input('reparentedProviders', sql.Int, data.reparentedProviders);
    request.input('reparentedPhotos', sql.Int, data.reparentedPhotos);
    request.input('repointedDrafts', sql.Int, data.repointedDrafts);

    await request.query(`
      INSERT INTO ClinicMergeLog (
        CanonicalClinicID,
        DuplicateClinicID,
        PlaceID,
        MergeReason,
        MergeNotes,
        MergedBy,
        MergeSource,
        ReparentedProviders,
        ReparentedPhotos,
        RepointedDrafts
      )
      VALUES (
        @canonicalClinicId,
        @duplicateClinicId,
        @placeId,
        @mergeReason,
        @mergeNotes,
        @mergedBy,
        @mergeSource,
        @reparentedProviders,
        @reparentedPhotos,
        @repointedDrafts
      )
    `);
  }
}

module.exports = new ClinicMergeService();
