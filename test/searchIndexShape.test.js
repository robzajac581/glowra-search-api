// GLO-121: pin the /api/clinics/search-index response shape the FE reads.
//
// The search page and the home page (LocalDoctors, FindCosmetics) load every
// clinic from this endpoint. These tests call the real route handler with the
// database stubbed, so a backend change that renames, drops or retypes a field
// the FE depends on fails CI instead of breaking the site.
//
// No network, no database, no Google: db.getConnection is replaced with an
// in-memory pool, and app.listen is replaced with a no-op so requiring app.js
// does not bind port 3001.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DISABLE_SCHEDULED_JOBS = 'true';
process.env.API_BASE_URL = 'https://api.test';

const express = require('express');
const { db } = require('../db');
const { photoBudget } = require('../utils/googlePhotoBudget');

// app.js calls app.listen() at load; keep it from binding a real port.
express.application.listen = function noopListen() { return { close() {} }; };
// app.js reloads the photo budget from the DB at boot; nothing to reload here.
photoBudget.hydrate = async () => 0;

const norm = (text) => text.replace(/\s+/g, ' ').trim();

let clinicRows = [];
let procedureRows = [];
let photoRows = [];
let statements = [];

db.getConnection = async () => ({
  request() {
    const req = {
      input() { return req; },
      async query(text) {
        const q = norm(text);
        statements.push(q);
        if (q.includes('INFORMATION_SCHEMA.COLUMNS')) return { recordset: [{ ok: 1 }] };
        if (q.includes('FROM Procedures p JOIN Clinics c')) return { recordset: procedureRows };
        if (q.includes('FROM Clinics c LEFT JOIN Locations l')) return { recordset: clinicRows };
        if (q.startsWith('SELECT ClinicID, PhotoID, DisplayOrder FROM ClinicPhotos')) return { recordset: photoRows };
        return { recordset: [] };
      }
    };
    return req;
  }
});

const app = require('../app');

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function clinicRow(overrides = {}) {
  return {
    ClinicID: 101,
    ClinicName: 'Glow Med Spa',
    Address: '1 Ocean Dr',
    City: 'Miami',
    State: 'FL',
    PostalCode: '33139',
    Latitude: 25.77,
    Longitude: -80.13,
    GoogleRating: 4.8,
    GoogleReviewCount: 210,
    ClinicCategory: 'Medical Spa',
    PrimaryPhotoID: 555,
    PrimaryPhotoReference: 'AciIO2-google-photo-reference-abcdefghijklmnopqrstuvwxyz',
    PrimaryPhotoURL: null,
    GooglePhoto: null,
    ...overrides
  };
}

function procedureRow(overrides = {}) {
  return {
    ClinicID: 101,
    ProcedureID: 9001,
    ProcedureName: 'Botox',
    AverageCost: 12,
    PriceUnit: '/unit',
    IsPromotional: null,
    ProcedureCategory: 'Injectables',
    ...overrides
  };
}

async function getSearchIndex(query = '') {
  const res = await fetch(`${baseUrl}/api/clinics/search-index${query}`);
  assert.equal(res.status, 200);
  return res.json();
}

describe('GET /api/clinics/search-index response shape', () => {
  beforeEach(() => {
    statements = [];
    clinicRows = [clinicRow()];
    procedureRows = [
      procedureRow(),
      procedureRow({ ProcedureID: 9002, ProcedureName: 'Lip Filler', AverageCost: 650, PriceUnit: null, IsPromotional: true, ProcedureCategory: 'Fillers' })
    ];
    photoRows = [
      { ClinicID: 101, PhotoID: 555, DisplayOrder: 0 },
      { ClinicID: 101, PhotoID: 556, DisplayOrder: 1 }
    ];
  });

  test('top level is { clinics: [], meta: { totalClinics, timestamp, filters } }', async () => {
    const body = await getSearchIndex();

    assert.deepEqual(Object.keys(body).sort(), ['clinics', 'meta']);
    assert.ok(Array.isArray(body.clinics));
    assert.equal(body.meta.totalClinics, body.clinics.length);
    assert.equal(typeof body.meta.timestamp, 'string');
    assert.ok(!Number.isNaN(Date.parse(body.meta.timestamp)));
    // Search.jsx reads these to tell a location search from a procedure search
    assert.deepEqual(Object.keys(body.meta.filters).sort(),
      ['clinicName', 'latitude', 'location', 'longitude', 'procedure', 'radius']);
  });

  test('each clinic carries the fields the FE reads, with the right types', async () => {
    const { clinics } = await getSearchIndex();
    assert.equal(clinics.length, 1);
    const clinic = clinics[0];

    assert.deepEqual(Object.keys(clinic).sort(), [
      'address', 'city', 'clinicCategory', 'clinicId', 'clinicName', 'galleryPhotos',
      'latitude', 'longitude', 'photoURL', 'procedures', 'rating', 'reviewCount',
      'state', 'zipCode'
    ]);

    assert.equal(clinic.clinicId, 101);
    assert.equal(clinic.clinicName, 'Glow Med Spa');
    assert.equal(clinic.address, '1 Ocean Dr');
    assert.equal(clinic.city, 'Miami');
    assert.equal(clinic.state, 'FL');
    assert.equal(clinic.zipCode, '33139');
    assert.equal(typeof clinic.latitude, 'number');
    assert.equal(typeof clinic.longitude, 'number');
    assert.equal(clinic.rating, 4.8);
    assert.equal(clinic.reviewCount, 210);
    assert.equal(typeof clinic.clinicCategory, 'string');

    // Primary photo goes through our own proxy; the Google key never appears.
    assert.equal(clinic.photoURL, 'https://api.test/api/photos/proxy/555?size=medium');
    assert.ok(!/key=/i.test(JSON.stringify(clinic)), 'no API key in the payload');

    assert.deepEqual(clinic.galleryPhotos, [
      'https://api.test/api/photos/proxy/555?size=thumbnail',
      'https://api.test/api/photos/proxy/556?size=thumbnail'
    ]);
  });

  test('each procedure has id, name, numeric price, category; priceUnit/isPromotional only when set', async () => {
    const { clinics } = await getSearchIndex();
    const [botox, filler] = clinics[0].procedures;

    assert.deepEqual(botox, {
      procedureId: 9001,
      procedureName: 'Botox',
      price: 12,
      category: 'Injectables',
      priceUnit: '/unit'
    });
    assert.ok(!('isPromotional' in botox), 'unassessed promo flag must be absent, not false');

    assert.deepEqual(filler, {
      procedureId: 9002,
      procedureName: 'Lip Filler',
      price: 650,
      category: 'Fillers',
      isPromotional: true
    });
  });

  test('missing optional values fall back to the documented defaults', async () => {
    clinicRows = [clinicRow({
      PostalCode: null, Latitude: null, Longitude: null,
      GoogleRating: null, GoogleReviewCount: null,
      PrimaryPhotoID: null, PrimaryPhotoReference: null
    })];
    procedureRows = [procedureRow({ AverageCost: null, PriceUnit: null })];
    photoRows = [];

    const [clinic] = (await getSearchIndex()).clinics;
    assert.equal(clinic.zipCode, null);
    assert.equal(clinic.latitude, null);
    assert.equal(clinic.longitude, null);
    assert.equal(clinic.rating, 0);
    assert.equal(clinic.reviewCount, 0);
    assert.equal(clinic.photoURL, null);
    assert.equal(clinic.galleryPhotos, null);
    assert.equal(clinic.procedures[0].price, 0);
    assert.ok(!('priceUnit' in clinic.procedures[0]));
  });

  test('search gate: both queries require a photo, a procedure, and not deleted', async () => {
    await getSearchIndex();

    const clinicQuery = statements.find((q) => q.includes('FROM Clinics c LEFT JOIN Locations l'));
    const procedureQuery = statements.find((q) => q.includes('FROM Procedures p JOIN Clinics c'));
    assert.ok(clinicQuery && procedureQuery);

    for (const q of [clinicQuery, procedureQuery]) {
      assert.ok(q.includes('(g.Photo IS NOT NULL OR cp.PhotoURL IS NOT NULL)'), 'photo gate missing');
      assert.ok(q.includes('NOT EXISTS ( SELECT 1 FROM DeletedClinics dc WHERE dc.OriginalClinicID = c.ClinicID )'), 'deleted gate missing');
    }
    assert.ok(clinicQuery.includes('AND EXISTS (SELECT 1 FROM Procedures p WHERE p.ClinicID = c.ClinicID)'),
      'clinics with no procedures must be excluded');
  });

  test('search gate: procedures of a clinic the gated clinic query did not return are dropped', async () => {
    // Clinic 202 has no photo, so the clinic query (stubbed here) does not
    // return it; any procedure rows for it must not create a clinic.
    procedureRows.push(procedureRow({ ClinicID: 202, ProcedureID: 9100 }));

    const { clinics, meta } = await getSearchIndex();
    assert.deepEqual(clinics.map((c) => c.clinicId), [101]);
    assert.equal(meta.totalClinics, 1);
  });

  test('a clinic with no procedure rows is still returned with an empty procedures array, never undefined', async () => {
    procedureRows = [];
    const [clinic] = (await getSearchIndex()).clinics;
    assert.deepEqual(clinic.procedures, []);
  });
});
