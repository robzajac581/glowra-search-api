# Using the Clinic Management API - Quick Guide

## Accessing the API Documentation

Once your server is running, you can access the interactive API documentation at:

**http://localhost:3001/api/clinic-management/docs**

Or in production:
**https://your-api-domain.com/api/clinic-management/docs**

## Getting Started

### 1. Set Your API Key

Add this to your `.env` file:
```
CLINIC_MANAGEMENT_API_KEY=your-api-key-here
```

### 2. Open Swagger UI

1. Start the server: `npm start`
2. Open your browser to: `http://localhost:3001/api/clinic-management/docs`
3. Click the "Authorize" button at the top
4. Enter your API key (from your `.env` file)
5. Click "Authorize" and "Close"

### 3. Using the API

#### Download Template
1. Go to **Bulk Import** section
2. Click on `GET /bulk-import/template`
3. Click "Try it out"
4. Click "Execute"
5. Download the Excel file

#### Upload Excel File
1. Fill out the Excel template with clinic data
2. Go to **Bulk Import** → `POST /bulk-import`
3. Click "Try it out"
4. Click "Choose File" and select your Excel file
5. Optionally add `X-Submitted-By` header with your name
6. Click "Execute"
7. Review the results - check for duplicates!

#### Review Drafts
1. Go to **Drafts** → `GET /drafts`
2. Click "Try it out"
3. Optionally add filters (status, source, etc.)
4. Click "Execute"
5. See all your drafts

#### Approve a Draft
1. Get the draft ID from the list
2. Go to **Drafts** → `POST /drafts/{draftId}/approve`
3. Click "Try it out"
4. Enter the draft ID
5. Optionally add `X-Reviewed-By` header
6. Click "Execute"

## Tips

- **Always validate first**: Use `/bulk-import/validate` before importing
- **Check duplicates**: Review duplicate detection results carefully
- **Complete required fields**: Website, Phone, Email, PlaceID, Category are required for approval
- **Use filters**: Filter drafts by status to see what needs attention

## Common Workflow

1. Download template → Fill with data → Validate → Upload → Review duplicates → Complete missing fields → Approve

## Need Help?

- Check the full documentation in `clinic-management/docs/`
- Review the Excel template guide
- Contact your team lead

