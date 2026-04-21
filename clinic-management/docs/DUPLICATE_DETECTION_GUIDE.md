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

Only **PlaceID exact match** is used for automatic duplicate linking/merging.

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
3. Treat name/phone/website matches as review hints, not automatic merge triggers.
4. Re-run duplicate backfill before enabling strict PlaceID unique index in environments with legacy data.

