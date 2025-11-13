# Clinic Management API Documentation

## Overview

The Clinic Management API provides endpoints for bulk importing clinics, managing draft submissions, detecting duplicates, and integrating with public forms. All submissions go through a draft/approval workflow to ensure data quality.

## Base URL

All endpoints are prefixed with `/api/clinic-management`

## Authentication

Most endpoints require API key authentication via the `X-API-Key` header:

```
X-API-Key: <your-api-key>
```

Set the API key in your environment variables:
```bash
CLINIC_MANAGEMENT_API_KEY=your-secret-key-here
```

Form submission endpoints use optional authentication (rate limiting recommended for production).

## Endpoints

### Bulk Import

#### POST `/bulk-import`
Upload Excel file and create drafts with duplicate detection.

**Authentication:** Required

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Form data with `file` field containing Excel file
- Headers:
  - `X-API-Key`: Your API key
  - `X-Submitted-By`: (Optional) User identifier

**Response:**
```json
{
  "success": true,
  "draftsCreated": 15,
  "duplicatesFound": 3,
  "drafts": [
    {
      "draftId": 101,
      "clinicName": "New Clinic",
      "status": "pending_review",
      "duplicates": [
        {
          "clinicId": 45,
          "clinicName": "Existing Clinic",
          "confidence": "high",
          "matchReason": "PlaceID match",
          "similarityScore": 1.0
        }
      ],
      "missingRequiredFields": ["Website", "Phone"]
    }
  ],
  "validationWarnings": []
}
```

#### POST `/bulk-import/validate`
Validate Excel file structure without creating drafts.

**Authentication:** Required

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Form data with `file` field

**Response:**
```json
{
  "isValid": true,
  "errors": [],
  "warnings": ["Clinic 'ABC Clinic' missing PlaceID"],
  "summary": {
    "clinics": 10,
    "providers": 25,
    "procedures": 50,
    "errorCount": 0,
    "warningCount": 1
  }
}
```

#### GET `/bulk-import/template`
Download standardized Excel template.

**Authentication:** Required

**Response:** Excel file download

### Draft Management

#### GET `/drafts`
List all drafts with optional filters.

**Authentication:** Required

**Query Parameters:**
- `status` - Filter by status (draft, pending_review, approved, rejected, merged)
- `source` - Filter by source (form, bulk_import, manual)
- `fromDate` - Filter drafts submitted after this date
- `toDate` - Filter drafts submitted before this date
- `limit` - Limit number of results

**Response:**
```json
{
  "drafts": [
    {
      "DraftID": 101,
      "ClinicName": "Example Clinic",
      "Status": "pending_review",
      "Source": "bulk_import",
      "SubmittedAt": "2025-01-15T10:00:00Z"
    }
  ],
  "count": 1
}
```

#### GET `/drafts/:draftId`
Get draft details with providers and procedures.

**Authentication:** Required

**Response:**
```json
{
  "DraftID": 101,
  "ClinicName": "Example Clinic",
  "Address": "123 Main St",
  "City": "New York",
  "State": "NY",
  "Website": "https://example.com",
  "Phone": "555-1234",
  "Email": "info@example.com",
  "PlaceID": "ChIJ...",
  "Category": "Medical Spa",
  "Status": "pending_review",
  "providers": [
    {
      "ProviderName": "Dr. Smith",
      "Specialty": "Plastic Surgery"
    }
  ],
  "procedures": [
    {
      "ProcedureName": "Breast Augmentation",
      "Category": "Breast",
      "AverageCost": 5000
    }
  ]
}
```

#### PUT `/drafts/:draftId`
Update draft.

**Authentication:** Required

**Request Body:**
```json
{
  "website": "https://newwebsite.com",
  "phone": "555-9999",
  "email": "newemail@example.com",
  "placeID": "ChIJ...",
  "category": "Plastic Surgery",
  "providers": [...],
  "procedures": [...]
}
```

#### POST `/drafts/:draftId/approve`
Approve draft and create clinic.

**Authentication:** Required

**Headers:**
- `X-Reviewed-By`: (Optional) User who approved

**Response:**
```json
{
  "success": true,
  "message": "Draft approved and clinic created",
  "clinicId": 456,
  "clinicName": "Example Clinic",
  "status": "approved"
}
```

#### POST `/drafts/:draftId/reject`
Reject draft.

**Authentication:** Required

**Request Body:**
```json
{
  "notes": "Reason for rejection",
  "reviewedBy": "admin@example.com"
}
```

#### POST `/drafts/:draftId/merge`
Merge draft with existing clinic.

**Authentication:** Required

**Request Body:**
```json
{
  "existingClinicId": 123,
  "reviewedBy": "admin@example.com"
}
```

#### POST `/drafts/:draftId/reject-duplicate`
Mark duplicate as not a duplicate.

**Authentication:** Required

**Request Body:**
```json
{
  "reason": "Different location"
}
```

### Duplicate Detection

#### POST `/duplicates/check`
Check single clinic for duplicates.

**Authentication:** Required

**Request Body:**
```json
{
  "clinicName": "Example Clinic",
  "address": "123 Main St",
  "city": "New York",
  "state": "NY",
  "phone": "555-1234",
  "website": "https://example.com",
  "placeID": "ChIJ..."
}
```

**Response:**
```json
{
  "hasDuplicates": true,
  "confidence": "high",
  "matches": [
    {
      "clinicId": 123,
      "clinicName": "Existing Clinic",
      "address": "123 Main St",
      "matchReason": "PlaceID match",
      "confidence": "high",
      "similarityScore": 1.0
    }
  ],
  "newClinicData": {...}
}
```

#### GET `/duplicates/:draftId`
Get duplicate suggestions for a draft.

**Authentication:** Required

### Form Integration

#### POST `/forms/submit`
Accept form submission and create draft.

**Authentication:** Optional

**Request Body:**
```json
{
  "requestId": "uuid-here",
  "clinicName": "New Clinic",
  "address": "123 Main St",
  "city": "New York",
  "state": "NY",
  "website": "https://example.com",
  "email": "info@example.com",
  "phone": "555-1234",
  "clinicCategory": "Medical Spa",
  "requestType": "list_clinic"
}
```

#### POST `/forms/adjustment`
Handle adjustment request.

**Authentication:** Optional

**Request Body:**
```json
{
  "requestId": "uuid-here",
  "existingClinicId": 123,
  "changes": {
    "phone": "new-phone",
    "website": "new-website"
  }
}
```

#### GET `/forms/requests/:requestId`
Get draft linked to a request ID.

**Authentication:** Required

### Health Check

#### GET `/health`
Health check endpoint (no auth required).

**Response:**
```json
{
  "status": "ok",
  "service": "clinic-management",
  "timestamp": "2025-01-15T10:00:00Z"
}
```

## Error Responses

All endpoints return standard error responses:

```json
{
  "error": "Error type",
  "message": "Detailed error message (development only)"
}
```

Common HTTP status codes:
- `400` - Bad Request (validation errors, missing fields)
- `401` - Unauthorized (invalid or missing API key)
- `404` - Not Found (draft/clinic not found)
- `500` - Internal Server Error

## Required Fields

### For Draft Creation:
- `clinicName` (required)
- `address` (required)
- `city` (required)
- `state` (required)

### For Approval:
- `website` (required)
- `phone` (required)
- `email` (required)
- `placeID` (required)
- `category` (required)

## Status Values

- `draft` - Initial draft state
- `pending_review` - Awaiting review
- `approved` - Approved and clinic created
- `rejected` - Rejected
- `merged` - Merged with existing clinic

## Integration Example

### Bulk Import Flow

```javascript
// 1. Download template
const templateResponse = await fetch('/api/clinic-management/bulk-import/template', {
  headers: { 'X-API-Key': 'your-key' }
});
const templateBlob = await templateResponse.blob();

// 2. Fill template with data
// ... user fills Excel file ...

// 3. Upload file
const formData = new FormData();
formData.append('file', excelFile);

const uploadResponse = await fetch('/api/clinic-management/bulk-import', {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-key',
    'X-Submitted-By': 'teammate-name'
  },
  body: formData
});

const result = await uploadResponse.json();

// 4. Review duplicates
for (const draft of result.drafts) {
  if (draft.duplicates.length > 0) {
    // Show duplicate comparison to user
    // User decides: merge or proceed
  }
}

// 5. Complete missing fields
await fetch(`/api/clinic-management/drafts/${draftId}`, {
  method: 'PUT',
  headers: {
    'X-API-Key': 'your-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    website: 'https://clinic.com',
    phone: '555-1234',
    email: 'info@clinic.com',
    placeID: 'ChIJ...',
    category: 'Medical Spa'
  })
});

// 6. Approve draft
await fetch(`/api/clinic-management/drafts/${draftId}/approve`, {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-key',
    'X-Reviewed-By': 'admin-name'
  }
});
```

## Notes

- All dates are in ISO 8601 format
- All monetary values are in USD
- Duplicate detection uses multiple strategies (PlaceID, fuzzy matching, phone, website)
- Drafts can be updated multiple times before approval
- Once approved, drafts cannot be modified (create new draft for changes)

