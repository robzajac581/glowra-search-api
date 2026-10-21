# Procedures, Clinics, and Locations — database model

This document describes how **`dbo.Procedures`** relates to **`dbo.Clinics`** and **`dbo.Locations`**, and how the application chooses insert values.

> **State described here:** production after **`migrations/dropProceduresLocationIdClinicsFk.sql`** (GLO-87) has been applied. Until it is applied, prod still carries the legacy `FK_Procedures_Clinics` on `LocationID` described under [Legacy constraint](#legacy-constraint-fk_procedures_clinics-on-locationid).

**Related code**

- `utils/proceduresClinicFkShape.js` — reads `sys.foreign_keys` / `INFORMATION_SCHEMA` and decides how to populate `Procedures.LocationID` (and documents assumptions for `Procedures.ClinicID`).
- `clinic-management/services/clinicCreationService.js` — `createProcedure` uses the same helper when inserting live procedures.
- `scripts/importProceduresFromExcel.js` — bulk import uses the same rules.
- `clinic-management/services/clinicMergeService.js` / `clinicDeletionService.js` — the code paths constrained by the `ClinicID` FK.
- `migrations/addClinicIdToProcedures.sql` — added **`Procedures.ClinicID`**, `IX_Procedures_ClinicID`, nullable **`ProviderID`**.
- `migrations/dropProceduresLocationIdClinicsFk.sql` (+ `.rollback.sql`) — GLO-87: moves the clinic FK from `LocationID` to `ClinicID`.

---

## Model

| Column | Role | Constraint |
|--------|------|-----------|
| **`Procedures.ClinicID`** | **Owning clinic.** Primary way the API and search index attach procedures to a clinic. | NOT NULL; **`FK_Procedures_ClinicID`** → `Clinics(ClinicID)`, trusted, NO ACTION on delete/update; indexed by `IX_Procedures_ClinicID`. |
| **`Procedures.LocationID`** | Link to the **geographic** row in **`Locations`**. New rows copy **`Clinics.LocationID`** of the owning clinic. | NULLable; FK → `Locations(LocationID)` (system-named, `FK__Procedure__Locat__08B54D69` in prod); indexed by `IX_Procedures_LocationID`. |
| **`Procedures.ProviderID`** | Optional attribution; may be NULL. | No FK. |
| **`Procedures.CategoryID`** | Category. | FK → `Categories(CategoryID)`. |

`Procedures.ProcedureID` is **not** an IDENTITY column; inserts compute `MAX(ProcedureID) + 1` inside the transaction.

**`Clinics`** (among other columns):

- **`ClinicID`** — primary key of the clinic.
- **`LocationID`** — optional link to **`Locations`** for region / grouping (not the same concept as “clinic id”).

**`Locations`** holds geographic/region rows; **`Locations.LocationID`** is its primary key.

Queries in **`app.js`** and clinic-management routes that list procedures for a clinic use **`p.ClinicID = @clinicId`** (and may **LEFT JOIN** providers or locations as needed). Procedures can exist **without** a provider row.

### What existing `LocationID` values mean

GLO-87 changed constraints only, not data. Existing `Procedures.LocationID` values are a mix of:

- a genuine **`Locations`** key,
- a **legacy copy of the clinic id** (rows written while the legacy FK forced `LocationID = ClinicID`) — still a valid `Locations` key by coincidence, but geographically meaningless,
- **NULL** (rows written while both FKs existed; the helper inserted NULL).

Do not read clinic ownership from `LocationID`; use `ClinicID`.

### Deleting and merging clinics

`FK_Procedures_ClinicID` has no cascade, so a `DELETE FROM Clinics` fails while any procedure still has that `ClinicID`.

- **Merge** (`clinicMergeService.mergeClinics`) reparents `Procedures.ClinicID` to the canonical clinic before deleting the duplicate, in one transaction, so it is unaffected.
- **Delete** (`clinicDeletionService.deleteClinic`) archives the clinic, Google data and photos but does **not** archive or remove procedures, so deleting a clinic that owns procedures fails with an FK error. This is deliberate: cascading would destroy priced procedures that `restoreClinic` cannot bring back.

---

## Runtime resolution (`loadProceduresClinicFkMeta`)

The helper inspects **enabled** foreign keys on **`dbo.Procedures`** (cached for 5 minutes per process):

| `Procedures.LocationID` FKs detected | Behavior |
|-------------------------------------|----------|
| **Only** → **`Locations`** (current prod) | Set **`LocationID`** from **`Clinics.LocationID`** for the owning clinic row. |
| **Only** → **`Clinics(ClinicID)`** (legacy) | Set **`LocationID = Clinics.ClinicID`** (same value as owning clinic id). |
| **Both** → **`Clinics`** and **`Locations`** (prod before GLO-87) | Requires **`Procedures.LocationID`** to be **NULLable**. Inserts use **`NULL`** for **`LocationID`**; clinic ownership is **`Procedures.ClinicID`** only. |

The `Procedures` → `Clinics` FK itself is accepted in three shapes: `(ClinicID)→(ClinicID)` (current prod, `FK_Procedures_ClinicID`), `(ClinicID, LocationID)→(ClinicID, LocationID)`, or legacy `(LocationID)→(ClinicID)`. More than one `Procedures` → `Clinics` FK is rejected.

**Filtering** of “which clinics can receive procedures” for imports uses **`ClinicID`** and any **filtered unique index** metadata on the **`Procedures` → `Clinics`** FK when present.

Duplicate detection during Excel import additionally matches legacy rows where **`LocationID`** stored the clinic id only when a legacy `LocationID` → `Clinics` FK is present.

---

## Legacy constraint: `FK_Procedures_Clinics` on `LocationID`

Older databases (including prod before GLO-87) define **`FK_Procedures_Clinics`** as `FOREIGN KEY (LocationID) REFERENCES Clinics(ClinicID)`, alongside the geographic `LocationID` → `Locations` FK. The column name says “Location” but the value was effectively a **clinic id**.

`migrations/addClinicIdToProcedures.sql` intended to create `FK_Procedures_Clinics` on **`ClinicID`**, but it is guarded by constraint name, so on databases that already had the legacy constraint the `ClinicID` FK was never created. GLO-87 removes the legacy constraint and adds the `ClinicID` FK under a different name (`FK_Procedures_ClinicID`) to avoid that ambiguity.

Because `ClinicID` and `Locations.LocationID` are both small integers, the legacy FK made `DELETE FROM Clinics` fail whenever some unrelated procedure's `LocationID` happened to equal the clinic's id (GLO-86).

Rolling back (`dropProceduresLocationIdClinicsFk.rollback.sql`) re-adds the legacy FK `WITH NOCHECK` (untrusted), because merges done after GLO-87 may leave `LocationID` values with no matching `Clinics` row.

---

## Operational notes

- **Excel import** — `scripts/importProceduresFromExcel.js` resolves clinics from workbook + DB, then inserts **`ClinicID`** from **`Clinics.ClinicID`** and sets **`LocationID`** per the rules above.
- **Optional** — `IMPORT_DISABLE_PROCEDURE_TRIGGERS=1` is documented on the import script only for diagnosing trigger-related failures; not required for normal FK resolution.
- **Backup** — the GLO-87 migration leaves a full copy in `dbo.Procedures_GLO87_Backup`; drop it once clinic deletes/merges (GLO-86) are verified.

---

## See also

- `docs/reports/DATABASE_STRUCTURE.md` — high-level **`Clinics`** / **`GooglePlacesData`** reference for the frontend.
- `clinic-management/docs/TEST_CHECKLIST.md` — clinic-centric procedures checklist.
