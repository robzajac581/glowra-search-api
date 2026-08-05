const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Stub collaborators before requiring the job, which destructures them on load
const googlePlaces = require('../utils/googlePlaces');
const photoCache = require('../utils/photoCache');
const { db } = require('../db');

let googlePhotos = [];
let expiredPhotoIds = [];

googlePlaces.fetchPlacePhotos = async () => googlePhotos;
photoCache.expirePhotoCache = async (photoId) => { expiredPhotoIds.push(photoId); };

let statements = [];
let existingPhotoRows = [];

function makePhoto(reference) {
  return { reference, urls: { large: `https://example.com/${reference}` }, width: 800, height: 600, attributions: [] };
}

// Minimal mssql pool stub: records every statement and answers the SELECTs
// refreshAllClinicPhotos issues.
db.getConnection = async () => ({
  request() {
    const inputs = {};
    const req = {
      input(name, _type, value) { inputs[name] = value; return req; },
      async query(text) {
        statements.push({ text: text.replace(/\s+/g, ' ').trim(), inputs });

        if (text.includes('FROM Clinics')) {
          return { recordset: [{ ClinicID: 24, ClinicName: 'Test Clinic', PlaceID: 'place-24' }] };
        }
        if (text.includes('SELECT PhotoID, PhotoReference')) {
          return { recordset: existingPhotoRows };
        }
        if (text.includes('MAX(DisplayOrder)')) {
          return { recordset: [{ MaxOrder: -1 }] }; // no user-uploaded photos
        }
        return { recordset: [] };
      }
    };
    return req;
  }
});

const { refreshAllClinicPhotos } = require('../jobs/scheduledRefresh');

const statementsOfType = (type) => statements.filter((s) => s.text.startsWith(type));

describe('refreshAllClinicPhotos', () => {
  beforeEach(() => {
    statements = [];
    expiredPhotoIds = [];
  });

  test('updates existing Google photos in place so PhotoIDs stay stable', async () => {
    existingPhotoRows = [
      { PhotoID: 990001, PhotoReference: 'old-ref-a' },
      { PhotoID: 990002, PhotoReference: 'old-ref-b' }
    ];
    googlePhotos = [makePhoto('new-ref-a'), makePhoto('new-ref-b')];

    await refreshAllClinicPhotos();

    const updates = statementsOfType('UPDATE');
    assert.equal(updates.length, 2, 'both existing rows should be updated');
    assert.deepEqual(updates.map((s) => s.inputs.photoId), [990001, 990002]);
    assert.deepEqual(updates.map((s) => s.inputs.photoReference), ['new-ref-a', 'new-ref-b']);

    // The destructive part of the old implementation must be gone
    assert.equal(statementsOfType('DELETE').length, 0, 'existing rows must not be deleted');
    assert.equal(statementsOfType('INSERT').length, 0, 'existing rows must not be re-inserted');
  });

  test('expires cached images only for photos whose reference changed', async () => {
    existingPhotoRows = [
      { PhotoID: 990001, PhotoReference: 'unchanged-ref' },
      { PhotoID: 990002, PhotoReference: 'old-ref' }
    ];
    googlePhotos = [makePhoto('unchanged-ref'), makePhoto('brand-new-ref')];

    await refreshAllClinicPhotos();

    assert.deepEqual(expiredPhotoIds, [990002]);
  });

  test('inserts additional rows when Google returns more photos than stored', async () => {
    existingPhotoRows = [{ PhotoID: 990001, PhotoReference: 'ref-a' }];
    googlePhotos = [makePhoto('ref-a'), makePhoto('ref-b')];

    await refreshAllClinicPhotos();

    assert.equal(statementsOfType('UPDATE').length, 1);
    const inserts = statementsOfType('INSERT');
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].inputs.photoReference, 'ref-b');
    assert.equal(inserts[0].inputs.displayOrder, 1);
  });

  test('removes surplus rows when Google returns fewer photos than stored', async () => {
    existingPhotoRows = [
      { PhotoID: 990001, PhotoReference: 'ref-a' },
      { PhotoID: 990002, PhotoReference: 'ref-b' },
      { PhotoID: 990003, PhotoReference: 'ref-c' }
    ];
    googlePhotos = [makePhoto('ref-a')];

    await refreshAllClinicPhotos();

    const deletes = statementsOfType('DELETE');
    assert.deepEqual(deletes.map((s) => s.inputs.photoId), [990002, 990003]);
  });

  test('removes all Google rows when the place has no photos', async () => {
    existingPhotoRows = [{ PhotoID: 990001, PhotoReference: 'ref-a' }];
    googlePhotos = [];

    await refreshAllClinicPhotos();

    assert.deepEqual(statementsOfType('DELETE').map((s) => s.inputs.photoId), [990001]);
    assert.equal(statementsOfType('UPDATE').length, 0);
  });
});
