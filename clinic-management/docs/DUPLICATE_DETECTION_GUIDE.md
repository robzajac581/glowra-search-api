# Duplicate Detection Guide

## Overview

Clinic deduplication now has two layers:

1. **Detection** - multi-strategy duplicate detection for review workflows.
2. **Prevention + cleanup** - PlaceID-first hardening that prevents new exact duplicates and supports safe backfill merges.

This guide documents both the matching logic and the operational runbook.

## Detection Strategies

The duplicate detector still evaluates multiple signals in confidence order:

1. **Exact PlaceID match** (highest confidence)
2. **Fuzzy clinic name + address**
3. **Phone match**
4. **Website domain match**
5. **Fuzzy clinic name + city/state**
6. **Same normalized street address** (see below)

Only **PlaceID exact match** is used for automatic duplicate linking/merging.

## Same-Address Detection

Code: `utils/addressDuplicateUtils.js` (pure, unit-tested in
`test/addressDuplicateDetection.test.js`), wired into
`duplicateDetectionService.checkDuplicates` and exposed as a whole-table scan at
`GET /duplicates/address-candidates`.

### Why

Two historical import passes created paired half-rows for the same practice: one
row with prices, the other with Google rating and photos. Names and PlaceIDs
differed, so strategies 1-5 missed every pair. The same street address catches
them, but address alone is wrong roughly 15% of the time (multi-location
practices, separate practices in one building, two practices in one suite). So
this strategy only **surfaces candidates with evidence**; it never merges.

### Matching

Two clinics are compared only when the normalized street is identical and the
locality agrees: ZIP when both sides have one (conflicting ZIPs never match),
otherwise city + state. Normalization handles:

- multi-line `Clinics.Address` with an embedded city (`1600 Kapiolani Blvd\nSuite 105\nHonolulu`),
  a practice-name line before the street, and a unit line that also carries the city (`Suite 107 Miami`)
- suite/unit variants: `#420`, `Suite 420`, `STE 202`, `Suite #320`, `UNIT 320`, also when the unit
  sits in the `City` column (`Suite 551\nReston`)
- USPS suffix/directional spellings: Boulevard/Blvd, Freeway/Fwy, Parkway/Pkwy, East/E, ...
- an empty `Clinics.Address`: the GooglePlacesData street, city, state and ZIP are used together
  (rows with an empty Address have been seen with the street number stored as `PostalCode`)

### Classification

Website registrable domain is the most decisive signal; a suite mismatch overrides it.

| Classification | When |
|---|---|
| `excluded` | both sides name a suite/unit and they differ (e.g. 17/121, suite 201 vs 202) |
| `review_only` | website domains differ (e.g. 54/119, same suite, different sites) |
| `review_only` | neither side has a website |
| `review_only` | same website, names dissimilar (< 50 after removing generic words), and both clinics have priced procedures: two practitioners sharing one site (e.g. 32/42) |
| `likely_duplicate` | otherwise: website domain matches, or exactly one side has a website |

Shared hosts (facebook.com, instagram.com, linktr.ee, ...) count as "no website".
In `checkDuplicates`, `likely_duplicate` is reported at `medium` confidence and
`review_only` at `low`; `excluded` pairs are not returned. Every match carries
`addressClassification` and `addressEvidence`.

### Known limitations

- A row with no street at all (empty `Address` and no Google street) cannot be
  compared. Duplicate 4/118 was of this kind and would not have been found.
- Website domain alone is not a duplicate signal: chains (laseraway.com,
  weilerplasticsurgery.com, ...) share one domain across many locations.

### Import history (root cause)

The half-rows were not created by `scripts/importProceduresFromExcel.js` or
`scripts/importGoogleData.js`; neither inserts `Clinics` rows (the first only
attaches procedures to clinics it resolves by PlaceID or exact name + city +
state, the second only updates a clinic it finds by name/address `LIKE`). They
came from the October 2025 Google Places consolidation:
`scripts/analyzeUnmatched.js` scored unmatched Google rows against existing
clinics by name similarity plus lat/lng distance (`scripts/matching-report.json`),
`scripts/consolidateData.js` created a **new** clinic for every Google row with
no or a low-confidence match, and `scripts/identifyBadMatches.js` (confidence
< 60) -> `scripts/verifyBadMatches.js` (name < 85 or far apart) ->
`scripts/revertAndFix.js` undid matches and created those as new clinics too.
No step compared street addresses or website domains, so a practice whose
Google business name differed from the spreadsheet name (Toledo vs Farris,
Lyos, Higa, Surgical Arts) got a second row carrying the Google data while the
original kept the prices. The distance signal was also unreliable: Toledo and
Farris share a street address yet were measured 23.7 km apart, consistent with
the whole-degree coordinates tracked in GLO-61. Any future importer that creates clinics should call
`checkDuplicates` (or `classifyAddressPair`) before inserting and skip or queue
`likely_duplicate` hits for review.

## Current Dedup Policy

### Intake / approval policy

- **Submission + bulk import:** when an exact PlaceID match exists, drafts are linked to the existing clinic via `DuplicateClinicID`.
- **Approval guard:** before creating a new clinic, approval re-checks PlaceID and forces merge flow if the clinic already exists.
- **Non-PlaceID matches:** still returned as suggestions for human review, but not auto-merged.

### Search behavior

Search endpoints now exclude any clinic IDs that are present in `DeletedClinics.OriginalClinicID`, so merged duplicates stop appearing in results after archival.

## Merge Infrastructure

### Database objects

Migration: `migrations/addClinicDedupInfrastructure.sql`

- `ClinicMergeLog` - audit trail for canonical/duplicate merge operations.
- `ClinicDedupReviewQueue` - optional queue for manual review groups.
- `UX_Clinics_PlaceID_NotNull` - filtered unique index on `Clinics.PlaceID` (created only when no duplicate non-empty PlaceIDs remain).

### Merge service

Service: `clinic-management/services/clinicMergeService.js`

Transactional merge steps:

1. Validate canonical + duplicate clinics exist.
2. Re-parent `Providers` from duplicate to canonical.
3. Re-parent `ClinicPhotos` and dedupe identical photos.
4. Reconcile `GooglePlacesData` ownership.
5. Repoint `ClinicDrafts.DuplicateClinicID` from duplicate to canonical.
6. Archive duplicate into `DeletedClinics` and remove it from `Clinics`.
7. Record merge event in `ClinicMergeLog`.

## Historical Backfill Runbook

Script: `scripts/mergeDuplicateClinicsByPlaceId.js`

### 1) Dry run (required first)

```bash
node scripts/mergeDuplicateClinicsByPlaceId.js
```

Optional single group:

```bash
node scripts/mergeDuplicateClinicsByPlaceId.js --placeId ChIJ1234567890
```

### 2) Execute merges

```bash
node scripts/mergeDuplicateClinicsByPlaceId.js --execute --mergedBy admin@example.com
```

Optional source tag:

```bash
node scripts/mergeDuplicateClinicsByPlaceId.js --execute --source one-time-cleanup
```

### 3) Enforce uniqueness

After duplicates are merged, rerun migrations so `UX_Clinics_PlaceID_NotNull` is created.

## API Behavior Notes

- Duplicate suggestions still return confidence/matchReason payloads for manual decisions.
- Exact PlaceID duplicate checks are exposed internally via `findExactPlaceIdDuplicate(...)`.
- Draft duplicate suggestion endpoint now reads normalized camelCase draft fields correctly.

## Recovery / Audit

- Use `ClinicMergeLog` to review merge decisions (`CanonicalClinicID`, `DuplicateClinicID`, `MergedAt`, actor/source, moved-row counts).
- Use `DeletedClinics` to inspect archived duplicates.
- If restoration is needed, use existing deleted clinic restore flow in admin routes.

## Best Practices

1. Always run **dry-run** before `--execute`.
2. Prefer PlaceID as the canonical identity key.
3. Treat name/phone/website/address matches as review hints, not automatic merge triggers.
4. Re-run duplicate backfill before enabling strict PlaceID unique index in environments with legacy data.

