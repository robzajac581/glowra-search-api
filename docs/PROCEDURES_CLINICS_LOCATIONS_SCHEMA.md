# Procedures, Clinics, and Locations — database model

This document describes how **`dbo.Procedures`** relates to **`dbo.Clinics`** and **`dbo.Locations`**, including legacy constraints still seen in some environments and how the application chooses insert values.

**Related code**

- `utils/proceduresClinicFkShape.js` — reads `sys.foreign_keys` / `INFORMATION_SCHEMA` and decides how to populate `Procedures.LocationID` (and documents assumptions for `Procedures.ClinicID`).
- `clinic-management/services/clinicCreationService.js` — `createProcedure` uses the same helper when inserting live procedures.
- `scripts/importProceduresFromExcel.js` — bulk import uses the same rules.
- `migrations/addClinicIdToProcedures.sql` — intended migration: add **`Procedures.ClinicID`**, FK to **`Clinics`**, nullable **`ProviderID`**.

---

## Intended model (clinic-centric)

After **`migrations/addClinicIdToProcedures.sql`** is applied as written in this repo:

| Column | Role |
|--------|------|
| **`Procedures.ClinicID`** | **Owning clinic** (NOT NULL, FK to **`Clinics.ClinicID`**). Primary way the API and search index attach procedures to a clinic. |
| **`Procedures.ProviderID`** | Optional attribution; may be NULL. |
| **`Procedures.LocationID`** | Semantically a link to the **geographic** row in **`Locations`**, when the schema follows “`LocationID` → `Locations`” only. Often copied from **`Clinics.LocationID`** for the same clinic. |

**`Clinics`** (among other columns):

- **`ClinicID`** — primary key of the clinic.
- **`LocationID`** — optional FK-style link to **`Locations`** for region / grouping (not the same concept as “clinic id”).

**`Locations`** holds geographic/region rows; **`Locations.LocationID`** is its primary key.

Queries in **`app.js`** and clinic-management routes that list procedures for a clinic use **`p.ClinicID = @clinicId`** (and may **LEFT JOIN** providers or locations as needed). Procedures can exist **without** a provider row.

---

## Legacy and mixed constraints (why `LocationID` is confusing)

Older databases may define **both** of the following on **`Procedures.LocationID`**:

1. **Legacy clinic link** — `FOREIGN KEY (LocationID) REFERENCES Clinics(ClinicID)`  
   The column name says “Location” but the value stored was effectively **clinic id** (misleading naming).

2. **Geographic link** — `FOREIGN KEY (LocationID) REFERENCES Locations(LocationID)`  
   The value must exist in **`Locations`**.

A **single integer** cannot simultaneously equal an arbitrary **`ClinicID`** and a **`Locations.LocationID`** unless those id spaces overlap by design (they usually do not). So inserts that copy **`Clinics.LocationID`** can violate (1), and inserts that set **`LocationID = ClinicID`** can violate (2).

### Runtime resolution (`loadProceduresClinicFkMeta`)

The helper inspects **enabled** foreign keys on **`dbo.Procedures`**:

| `Procedures.LocationID` FKs detected | Behavior |
|-------------------------------------|----------|
| **Only** → **`Locations`** | Set **`LocationID`** from **`Clinics.LocationID`** for the owning clinic row. |
| **Only** → **`Clinics(ClinicID)`** (legacy) | Set **`LocationID = Clinics.ClinicID`** (same value as owning clinic id). |
| **Both** → **`Clinics`** and **`Locations`** | Requires **`Procedures.LocationID`** to be **NULLable**. Inserts use **`NULL`** for **`LocationID`**; **clinic ownership** is **`Procedures.ClinicID`** only until a DBA removes the obsolete **`LocationID` → `Clinics`** constraint or realigns schema. |

**Filtering** of “which clinics can receive procedures” for imports still uses **`ClinicID`** and any **filtered unique index** metadata on the **`Procedures` → `Clinics`** FK when present.

Duplicate detection during Excel import accounts for legacy rows where **`LocationID`** stored the clinic id.

---

## What your database “looks like” in practice

- **`Clinics`** rows are keyed by **`ClinicID`**; each row may point at a **`Locations`** row via **`Clinics.LocationID`**.
- **`Procedures`** rows include pricing/category fields and:
  - **`ClinicID`** — canonical owner after migration (required for clinic-centric API behavior in this repo).
  - **`LocationID`** — meaning depends on which FKs exist:
    - geographic **`Locations`** key,
    - legacy duplicate of **`ClinicID`**, or
    - **NULL** when both legacy and geographic FKs apply and the column allows NULL.

---

## Operational notes

- **Excel import** — `scripts/importProceduresFromExcel.js` resolves clinics from workbook + DB, then inserts **`ClinicID`** from **`Clinics.ClinicID`** and sets **`LocationID`** per the rules above.
- **Optional** — `IMPORT_DISABLE_PROCEDURE_TRIGGERS=1` is documented on the import script only for diagnosing trigger-related failures; not required for normal FK resolution.
- **Schema cleanup (optional DBA task)** — To match the intended model cleanly: drop the obsolete **`Procedures.LocationID` → `Clinics`** constraint if **`Procedures.ClinicID` → `Clinics`** already enforces clinic ownership, then keep **`Procedures.LocationID` → `Locations`** only (or leave **`LocationID`** NULL when unused). Any such change belongs in a dedicated migration after backup and staging validation.

---

## See also

- `docs/reports/DATABASE_STRUCTURE.md` — high-level **`Clinics`** / **`GooglePlacesData`** reference for the frontend.
- `clinic-management/docs/TEST_CHECKLIST.md` — clinic-centric procedures checklist.
- `migrations/addClinicIdToProcedures.sql` — adds **`Procedures.ClinicID`** and related FK/index.
