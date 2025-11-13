# Integration Guide

## Overview

This guide explains how to integrate the Clinic Management API with existing systems, particularly the clinic listing forms.

## Form Integration

### Existing Clinic Listing Forms

If you have existing forms that submit to `ClinicListingRequests`, you can integrate them with the draft system.

#### Step 1: Update Form Handler

In your form submission handler, after creating the `ClinicListingRequest`, also create a draft:

```javascript
const { createListingRequest } = require('./services/clinicListingService');
const formIntegrationService = require('./clinic-management/services/formIntegrationService');

async function handleFormSubmission(formData) {
  // Existing: Create ClinicListingRequest
  const request = await createListingRequest(formData);
  
  // New: Create draft
  const draft = await formIntegrationService.createDraftFromForm({
    ...formData,
    requestId: request.requestId
  });
  
  return {
    requestId: request.requestId,
    draftId: draft.DraftID,
    status: 'draft'
  };
}
```

#### Step 2: API Endpoint Integration

Alternatively, call the API endpoint directly:

```javascript
// In your form handler
const response = await fetch('http://your-api/api/clinic-management/forms/submit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
    // Optional: 'X-API-Key': 'your-key' for authenticated requests
  },
  body: JSON.stringify({
    requestId: request.requestId, // Link to ClinicListingRequest
    clinicName: formData.clinicName,
    address: formData.address,
    city: formData.city,
    state: formData.state,
    website: formData.website,
    email: formData.email,
    phone: formData.phone,
    clinicCategory: formData.category,
    requestType: 'list_clinic', // or 'adjustment'
    message: formData.message,
    additionalDetails: formData.additionalDetails
  })
});
```

### Adjustment Request Forms

For adjustment requests that modify existing clinics:

```javascript
const response = await fetch('http://your-api/api/clinic-management/forms/adjustment', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    requestId: request.requestId,
    existingClinicId: formData.clinicId, // ID of clinic to update
    changes: {
      phone: formData.newPhone,
      website: formData.newWebsite,
      // ... other changes
    },
    message: formData.message
  })
});
```

## Admin Dashboard Integration

### Listing Drafts

```javascript
// Get all pending drafts
const response = await fetch('/api/clinic-management/drafts?status=pending_review', {
  headers: {
    'X-API-Key': 'your-key'
  }
});

const { drafts } = await response.json();
```

### Reviewing a Draft

```javascript
// Get draft details
const draftResponse = await fetch(`/api/clinic-management/drafts/${draftId}`, {
  headers: {
    'X-API-Key': 'your-key'
  }
});

const draft = await draftResponse.json();

// Check for duplicates
const duplicateResponse = await fetch(`/api/clinic-management/duplicates/${draftId}`, {
  headers: {
    'X-API-Key': 'your-key'
  }
});

const duplicates = await duplicateResponse.json();
```

### Approving a Draft

```javascript
// Complete missing fields if needed
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

// Approve draft
await fetch(`/api/clinic-management/drafts/${draftId}/approve`, {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-key',
    'X-Reviewed-By': 'admin@example.com'
  }
});
```

## Bulk Import Integration

### Frontend Upload Component

```javascript
async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/clinic-management/bulk-import', {
    method: 'POST',
    headers: {
      'X-API-Key': 'your-key',
      'X-Submitted-By': 'teammate-name'
    },
    body: formData
  });

  const result = await response.json();
  
  // Show results to user
  console.log(`Created ${result.draftsCreated} drafts`);
  console.log(`Found ${result.duplicatesFound} duplicates`);
  
  // Handle duplicates
  for (const draft of result.drafts) {
    if (draft.duplicates.length > 0) {
      // Show duplicate comparison UI
      showDuplicateComparison(draft);
    }
  }
}
```

### Validation Before Upload

```javascript
async function validateFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/clinic-management/bulk-import/validate', {
    method: 'POST',
    headers: {
      'X-API-Key': 'your-key'
    },
    body: formData
  });

  const result = await response.json();
  
  if (!result.isValid) {
    // Show errors to user
    console.error('Validation errors:', result.errors);
    return false;
  }
  
  // Show warnings
  if (result.warnings.length > 0) {
    console.warn('Warnings:', result.warnings);
  }
  
  return true;
}
```

## Webhook Integration (Future)

For future webhook support, you can listen for draft status changes:

```javascript
// Example webhook handler (to be implemented)
app.post('/webhooks/clinic-management', (req, res) => {
  const { event, data } = req.body;
  
  switch (event) {
    case 'draft.approved':
      // Handle approved draft
      notifyAdmin(data);
      break;
    case 'draft.rejected':
      // Handle rejected draft
      notifySubmitter(data);
      break;
  }
  
  res.json({ received: true });
});
```

## Error Handling

### Standard Error Response

All endpoints return consistent error formats:

```javascript
try {
  const response = await fetch('/api/clinic-management/drafts/123/approve', {
    method: 'POST',
    headers: { 'X-API-Key': 'your-key' }
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error);
  }
  
  const result = await response.json();
} catch (error) {
  // Handle error
  console.error('Error:', error.message);
}
```

### Common Error Scenarios

1. **Missing Required Fields**
   - Status: 400
   - Response: `{ error: "Validation failed", errors: [...] }`
   - Solution: Complete missing fields before approval

2. **Invalid API Key**
   - Status: 401
   - Response: `{ error: "Unauthorized" }`
   - Solution: Check API key configuration

3. **Draft Not Found**
   - Status: 404
   - Response: `{ error: "Draft not found" }`
   - Solution: Verify draft ID

4. **Database Error**
   - Status: 500
   - Response: `{ error: "Internal server error" }`
   - Solution: Check server logs, contact administrator

## Rate Limiting

For public form endpoints, consider implementing rate limiting:

```javascript
const rateLimit = require('express-rate-limit');

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5 // 5 requests per window
});

app.use('/api/clinic-management/forms', formLimiter);
```

## Testing

### Test Form Submission

```bash
curl -X POST http://localhost:3001/api/clinic-management/forms/submit \
  -H "Content-Type: application/json" \
  -d '{
    "clinicName": "Test Clinic",
    "address": "123 Test St",
    "city": "Test City",
    "state": "NY",
    "email": "test@example.com",
    "requestType": "list_clinic"
  }'
```

### Test Bulk Import

```bash
curl -X POST http://localhost:3001/api/clinic-management/bulk-import \
  -H "X-API-Key: your-key" \
  -H "X-Submitted-By: test-user" \
  -F "file=@test-clinics.xlsx"
```

## Migration from Old System

If migrating from an old system:

1. **Export existing data** to Excel format
2. **Map fields** to new template format
3. **Validate** using validation endpoint
4. **Import** via bulk import endpoint
5. **Review duplicates** carefully
6. **Approve** drafts after verification

## Best Practices

1. **Always validate** before importing
2. **Review duplicates** before merging
3. **Complete required fields** before approval
4. **Use API keys** for authenticated endpoints
5. **Handle errors** gracefully in your application
6. **Log actions** for audit trail
7. **Test thoroughly** before production use

## Support

For integration questions or issues:
1. Check API documentation
2. Review error messages
3. Test with sample data
4. Contact system administrator

