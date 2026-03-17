# Address Normalization

## Overview

Clinic addresses are stored and returned as separate components (street, city, state, zipCode) to prevent duplication in the frontend. Previously, the `Address` field often contained the full address while city/state/zip were also returned separately, causing duplicate display.

## Current Behavior

- **Address** (street only): e.g., `"6545 N Wickham Rd Suite C-101"`
- **City/State/zipCode**: Returned as separate fields in all clinic API responses

## Database Schema

### Clinics Table

| Column | Description |
|--------|-------------|
| `Address` | Street address only (no city/state/zip) |
| `City` | City (nullable) |
| `State` | State/Province (nullable) |
| `PostalCode` | ZIP/Postal code (nullable) |

### GooglePlacesData Table

| Column | Description |
|--------|-------------|
| `Street` | Street address only |
| `City` | City |
| `State` | State/Province |
| `PostalCode` | ZIP/Postal code |
| `FullAddress` | Complete formatted address (optional) |

## API Response Merge Logic

When merging Clinics with GooglePlacesData for API responses:

- **address**: `COALESCE(g.Street, c.Address)` — prefer GooglePlacesData.Street when available
- **city**: `COALESCE(c.City, g.City, l.City)` — Clinics > GooglePlacesData > Locations
- **state**: `COALESCE(c.State, g.State, l.State)`
- **zipCode**: `COALESCE(c.PostalCode, g.PostalCode)`

## When Creating/Updating Clinics

The `normalizeAddressForStorage()` utility in `utils/addressUtils.js`:

1. If the input address looks like a full address (contains commas and a 5-digit zip), parse it into street, city, state, postalCode
2. Otherwise, use the address as street and use provided city/state/zipCode
3. Store street in `Address`, city/state/postalCode in their respective columns

## Data Migration

For existing clinics where `Address` contains a full address:

1. Run the schema migration: `migrations/addClinicAddressColumns.sql`
2. Run the normalization script:
   ```bash
   node scripts/normalizeClinicAddresses.js --dry-run   # Preview changes
   node scripts/normalizeClinicAddresses.js             # Apply changes
   ```

## Frontend Usage

The frontend now receives `address`, `city`, `state`, `zipCode` as separate fields. Use `formatClinicAddress()` to build the display string without duplication.
