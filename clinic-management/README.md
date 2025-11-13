# Clinic Management API Service

A comprehensive API service for managing clinic submissions, bulk imports, duplicate detection, and draft/approval workflows.

## Features

- ✅ **Bulk Import** - Upload Excel files with standardized template
- ✅ **Duplicate Detection** - Multi-strategy detection (PlaceID, fuzzy matching, phone, website)
- ✅ **Draft/Approval Workflow** - Safe submission process with review
- ✅ **Form Integration** - Integrate with existing clinic listing forms
- ✅ **API Key Authentication** - Secure access control
- ✅ **Comprehensive Validation** - Data validation before approval
- ✅ **Audit Trail** - Track all actions and changes

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Database Migration

```bash
# Execute migrations/addClinicManagementTables.sql in your SQL Server database
```

### 3. Configure Environment

Add to your `.env` file:

```bash
CLINIC_MANAGEMENT_API_KEY=your-secret-key-here
```

### 4. Start Server

```bash
npm start
```

### 5. Test Health Check

```bash
curl http://localhost:3001/api/clinic-management/health
```

## API Endpoints

All endpoints are prefixed with `/api/clinic-management`

### Bulk Import
- `POST /bulk-import` - Upload Excel file
- `POST /bulk-import/validate` - Validate Excel file
- `GET /bulk-import/template` - Download template

### Draft Management
- `GET /drafts` - List drafts
- `GET /drafts/:id` - Get draft details
- `PUT /drafts/:id` - Update draft
- `POST /drafts/:id/approve` - Approve draft
- `POST /drafts/:id/reject` - Reject draft
- `POST /drafts/:id/merge` - Merge with existing clinic

### Duplicate Detection
- `POST /duplicates/check` - Check for duplicates
- `GET /duplicates/:draftId` - Get duplicates for draft

### Form Integration
- `POST /forms/submit` - Submit form data
- `POST /forms/adjustment` - Submit adjustment request

See [API Documentation](./docs/API_DOCUMENTATION.md) for details.

## Documentation

- [Quick Start Guide](./docs/QUICK_START.md) - Get started quickly with Swagger UI
- [API Documentation](./docs/API_DOCUMENTATION.md) - Complete API reference
- [Excel Template Guide](./docs/EXCEL_TEMPLATE_GUIDE.md) - How to use the template
- [Duplicate Detection Guide](./docs/DUPLICATE_DETECTION_GUIDE.md) - How duplicate detection works
- [Integration Guide](./docs/INTEGRATION_GUIDE.md) - Integration with other systems
- [Setup Guide](./docs/SETUP_GUIDE.md) - Installation and configuration
- [Test Checklist](./docs/TEST_CHECKLIST.md) - Comprehensive testing guide
- [Production Readiness](./docs/PRODUCTION_READINESS.md) - Production deployment guide

## Architecture

The service is designed as a self-contained module that can be easily extracted to a separate microservice:

```
clinic-management/
├── docs/           # Documentation
├── middleware/     # Authentication middleware
├── routes/         # Express route handlers
├── services/       # Business logic
├── templates/      # Excel templates
├── utils/          # Utility functions
└── index.js        # Main router
```

## Usage Examples

### Bulk Import

```javascript
const formData = new FormData();
formData.append('file', excelFile);

const response = await fetch('/api/clinic-management/bulk-import', {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-key',
    'X-Submitted-By': 'teammate-name'
  },
  body: formData
});

const result = await response.json();
// Handle result with drafts and duplicates
```

### Approve Draft

```javascript
await fetch(`/api/clinic-management/drafts/${draftId}/approve`, {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-key',
    'X-Reviewed-By': 'admin-name'
  }
});
```

## Required Fields

### For Draft Creation
- ClinicName, Address, City, State

### For Approval
- Website, Phone, Email, PlaceID, Category

## Status Flow

```
draft → pending_review → approved/rejected/merged
```

## Security

- API key authentication required for most endpoints
- Form endpoints use optional authentication (rate limiting recommended)
- All inputs are validated
- SQL injection protection via parameterized queries

## Database Schema

The service uses three new tables:
- `ClinicDrafts` - Draft clinic submissions
- `DraftProviders` - Providers associated with drafts
- `DraftProcedures` - Procedures associated with drafts

See migration file: `migrations/addClinicManagementTables.sql`

## Development

### File Structure
- Services contain business logic
- Routes handle HTTP requests
- Utils provide helper functions
- Middleware handles authentication

### Adding New Features

1. Add service method in appropriate service file
2. Add route handler in routes directory
3. Register route in `index.js`
4. Update documentation

## Testing

### Swagger UI (Recommended)

Access interactive API documentation at:
```
http://localhost:3001/api/clinic-management/docs
```

Click "Authorize" and enter your API key to test endpoints directly.

### Manual Testing

See [Test Checklist](./docs/TEST_CHECKLIST.md) for comprehensive testing guide.

Quick test examples:

```bash
# Health check
curl http://localhost:3001/api/clinic-management/health

# List drafts (requires API key)
curl -H "X-API-Key: your-key" \
  http://localhost:3001/api/clinic-management/drafts
```

## Support

For issues or questions:
1. Check documentation in `docs/` folder
2. Review error messages
3. Check server logs
4. Contact system administrator

## License

ISC

