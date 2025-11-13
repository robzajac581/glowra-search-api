# Clinic Management API - Test Checklist

This checklist helps verify that all clinic-management endpoints are working correctly.

## Prerequisites

- [ ] Database migration completed (`npm run migrate:clinic-management`)
- [ ] `CLINIC_MANAGEMENT_API_KEY` set in `.env` file
- [ ] Server running (`npm start`)
- [ ] API key value available for testing

## Health Check

- [ ] **GET** `/api/clinic-management/health`
  - Expected: `200 OK` with `{"status": "ok", "service": "clinic-management", "timestamp": "..."}`
  - No authentication required

## Swagger UI

- [ ] **GET** `/api/clinic-management/docs`
  - Expected: Swagger UI loads successfully
  - [ ] Click "Authorize" button
  - [ ] Enter API key (from your `.env` file)
  - [ ] Click "Authorize" and verify green checkmark appears
  - [ ] Verify all endpoint sections are visible (Bulk Import, Drafts, Duplicates, Forms)

## Bulk Import Endpoints

### Template Download

- [ ] **GET** `/api/clinic-management/bulk-import/template`
  - Expected: Excel file downloads (`clinic-import-template.xlsx`)
  - Verify file opens correctly in Excel
  - Verify template has correct columns (see EXCEL_TEMPLATE_GUIDE.md)

### File Validation

- [ ] **POST** `/api/clinic-management/bulk-import/validate`
  - Upload valid Excel file
  - Expected: `200 OK` with `{"isValid": true, "errors": [], "warnings": []}`
  - Upload invalid Excel file (wrong columns)
  - Expected: `200 OK` with `{"isValid": false, "errors": [...]}`

### Bulk Import

- [ ] **POST** `/api/clinic-management/bulk-import`
  - Upload valid Excel file with test data
  - Include header: `X-Submitted-By: TestUser`
  - Expected: `200 OK` with:
    - `success: true`
    - `draftsCreated: > 0`
    - `drafts` array with draft objects
    - Check for duplicate detection results
  - Verify drafts appear in database (`ClinicDrafts` table)

## Draft Management Endpoints

### List Drafts

- [ ] **GET** `/api/clinic-management/drafts`
  - Expected: `200 OK` with `{"drafts": [...], "count": N}`
  - Test filters:
    - `?status=draft`
    - `?status=pending_review`
    - `?source=bulk_import`
    - `?limit=10`

### Get Draft Details

- [ ] **GET** `/api/clinic-management/drafts/:draftId`
  - Use draft ID from list endpoint
  - Expected: `200 OK` with full draft object including:
    - `providers` array
    - `procedures` array
    - All clinic fields
  - Test invalid ID: Expected `404 Not Found`

### Update Draft

- [ ] **PUT** `/api/clinic-management/drafts/:draftId`
  - Update draft fields (e.g., add website, phone)
  - Expected: `200 OK` with updated draft object
  - Verify changes saved in database

### Approve Draft

- [ ] **POST** `/api/clinic-management/drafts/:id/approve`
  - Use draft with all required fields (website, phone, email, placeID, category)
  - Include header: `X-Reviewed-By: TestReviewer`
  - Expected: `200 OK` with:
    - `success: true`
    - `clinicId: <number>`
    - `clinicName: "..."`
    - `status: "approved"`
  - Verify clinic created in `Clinics` table
  - Verify providers created in `Providers` table
  - Verify procedures created in `Procedures` table
  - Verify draft status updated to `approved`

### Reject Draft

- [ ] **POST** `/api/clinic-management/drafts/:id/reject`
  - Include body: `{"notes": "Test rejection reason"}`
  - Include header: `X-Reviewed-By: TestReviewer`
  - Expected: `200 OK` with `{"success": true, "message": "Draft rejected", "draft": {...}}`
  - Verify draft status updated to `rejected`
  - Verify `ReviewedBy` and `ReviewedAt` fields set

### Merge Draft

- [ ] **POST** `/api/clinic-management/drafts/:id/merge`
  - Use draft with existing clinic ID
  - Include body: `{"existingClinicId": <valid-clinic-id>}`
  - Expected: `200 OK` with `{"success": true, "status": "merged", ...}`
  - Verify draft status updated to `merged`
  - Verify existing clinic updated (if applicable)

### Reject Duplicate

- [ ] **POST** `/api/clinic-management/drafts/:id/reject-duplicate`
  - Include body: `{"reason": "Not actually a duplicate"}`
  - Expected: `200 OK` with success message
  - Verify notes updated in draft

## Duplicate Detection

- [ ] **POST** `/api/clinic-management/duplicates/check`
  - Include body with clinic data (name, address, phone, website, placeID)
  - Expected: `200 OK` with duplicate detection results
  - Test with known duplicate: Should return matches
  - Test with new clinic: Should return `hasDuplicates: false`

- [ ] **GET** `/api/clinic-management/duplicates/:draftId`
  - Use draft ID from bulk import
  - Expected: `200 OK` with duplicate suggestions for that draft

## Form Integration Endpoints

### Submit Form

- [ ] **POST** `/api/clinic-management/forms/submit`
  - Include body:
    ```json
    {
      "clinicName": "Test Clinic",
      "address": "123 Test St",
      "city": "Test City",
      "state": "TS",
      "website": "https://test.com",
      "phone": "555-1234",
      "email": "test@example.com"
    }
    ```
  - Expected: `201 Created` with `{"success": true, "draftId": <number>, "status": "draft"}`
  - Verify draft created with `source: "form"`

### Adjustment Request

- [ ] **POST** `/api/clinic-management/forms/adjustment`
  - Include body with `existingClinicId` field
  - Expected: `201 Created` with draft created
  - Verify draft created with `source: "form_adjustment"`

### Get Draft by Request ID

- [ ] **GET** `/api/clinic-management/forms/requests/:requestId`
  - Use valid UUID request ID
  - Expected: `200 OK` with draft object OR `404 Not Found` if no match

## Error Handling Tests

- [ ] Test missing API key:
  - Expected: `401 Unauthorized` with `{"error": "Unauthorized", "message": "Invalid or missing API key"}`
- [ ] Test invalid API key:
  - Expected: `401 Unauthorized`
- [ ] Test invalid draft ID:
  - Expected: `400 Bad Request` or `404 Not Found`
- [ ] Test missing required fields on approval:
  - Expected: `400 Bad Request` with error message about missing fields

## Integration Tests

- [ ] **Complete Workflow Test**:
  1. Download template
  2. Fill with test data (include duplicate clinic)
  3. Validate file
  4. Upload file
  5. Review drafts list
  6. Check duplicate detection results
  7. Update draft with missing required fields
  8. Approve draft
  9. Verify clinic created in database
  10. Verify clinic appears in main clinic endpoints

## Production Readiness Checklist

- [ ] API key rotation strategy documented
- [ ] Rate limiting configured for public form endpoints (if needed)
- [ ] Error handling tested and working
- [ ] Database connection pooling verified
- [ ] Migration idempotency confirmed (safe to run multiple times)
- [ ] Swagger documentation complete for all endpoints
- [ ] Logging configured for production
- [ ] Monitoring/alerting set up (if applicable)

## Notes

- All authenticated endpoints require `X-API-Key` header
- Form endpoints (`/forms/*`) use optional authentication
- Draft approval requires: website, phone, email, placeID, category
- Duplicate detection runs automatically on bulk import
- Drafts start as `draft` status, move to `pending_review` after import

## Troubleshooting

**"401 Unauthorized"**
- Check API key is set correctly in `.env`
- Verify `X-API-Key` header is included in request
- Check API key matches exactly (no extra spaces)

**"Draft missing required fields"**
- Check draft has: website, phone, email, placeID, category
- Use PUT endpoint to update draft before approval

**"Migration errors"**
- Migration is idempotent - safe to run multiple times
- Check database connection settings
- Verify SQL Server permissions

**"Swagger UI not loading"**
- Check server is running
- Verify route is mounted: `/api/clinic-management/docs`
- Check browser console for errors

