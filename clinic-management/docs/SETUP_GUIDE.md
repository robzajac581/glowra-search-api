# Setup Guide

## Prerequisites

- Node.js 16+ installed
- SQL Server database access
- npm or yarn package manager

## Installation

### 1. Install Dependencies

```bash
npm install
```

This will install all required packages including:
- `express` - Web framework
- `mssql` - SQL Server driver
- `xlsx` - Excel file handling
- `multer` - File upload handling
- `fuzzball` - Fuzzy string matching

### 2. Database Setup

Run the migration to create required tables:

**Option 1: Using Node.js script (Recommended)**

```bash
npm run migrate:clinic-management
```

**Option 2: Using SQL Server command line**

```bash
sqlcmd -S your-server -d your-database -i migrations/addClinicManagementTables.sql
```

**Option 3: Using SQL client**

Open `migrations/addClinicManagementTables.sql` in your SQL client (Azure Data Studio, SSMS, etc.) and execute it.

### 3. Environment Variables

Create or update your `.env` file:

```bash
# Database Configuration (existing)
DB_SERVER=your-server.database.windows.net
DB_NAME=your-database
DB_USER=your-username
DB_PASSWORD=your-password
DB_DRIVER={ODBC Driver 17 for SQL Server}

# Clinic Management API Key
CLINIC_MANAGEMENT_API_KEY=your-secret-api-key-here

# Optional: API Base URL (for provider photos, etc.)
API_BASE_URL=https://your-api-domain.com
```

**Important:** Generate a strong, random API key:
```bash
# Generate a random API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Verify Database Connection

Test your database connection:

```bash
node -e "const { db } = require('./db'); db.getConnection().then(() => console.log('Connected!')).catch(console.error)"
```

## Configuration

### API Key Security

1. **Never commit API keys** to version control
2. **Use different keys** for development and production
3. **Rotate keys** periodically
4. **Restrict key access** to authorized users only

### Database Permissions

Ensure your database user has permissions to:
- CREATE TABLE (for migrations)
- INSERT, UPDATE, DELETE on all tables
- SELECT on Clinics, Providers, Procedures, Categories, Specialties, Locations

### CORS Configuration

The service uses the existing CORS configuration from `app.js`. Update if needed for your frontend domain.

## Running the Service

### Development

```bash
npm start
```

The service will start on port 3001 (or PORT environment variable).

### Production

Use a process manager like PM2:

```bash
pm2 start app.js --name glowra-api
```

Or deploy to your preferred hosting platform (Render, Heroku, etc.).

## Verification

### 1. Health Check

```bash
curl http://localhost:3001/api/clinic-management/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "clinic-management",
  "timestamp": "2025-01-15T10:00:00Z"
}
```

### 2. Test API Key Authentication

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:3001/api/clinic-management/drafts
```

Should return list of drafts (empty initially).

### 3. Download Template

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:3001/api/clinic-management/bulk-import/template \
  -o template.xlsx
```

Should download Excel template file.

## File Structure

```
clinic-management/
├── docs/
│   ├── API_DOCUMENTATION.md
│   ├── EXCEL_TEMPLATE_GUIDE.md
│   ├── DUPLICATE_DETECTION_GUIDE.md
│   ├── INTEGRATION_GUIDE.md
│   └── SETUP_GUIDE.md (this file)
├── middleware/
│   └── auth.js
├── routes/
│   ├── bulkImportRoutes.js
│   ├── draftRoutes.js
│   ├── duplicateRoutes.js
│   └── formRoutes.js
├── services/
│   ├── bulkImportService.js
│   ├── clinicCreationService.js
│   ├── draftService.js
│   ├── duplicateDetectionService.js
│   └── formIntegrationService.js
├── templates/
│   └── clinic-import-template.xlsx (generated on first use)
├── utils/
│   ├── excelParser.js
│   ├── excelValidator.js
│   └── templateGenerator.js
└── index.js
```

## Troubleshooting

### Database Connection Issues

**Error:** "Database Connection Failed"

**Solutions:**
1. Check database credentials in `.env`
2. Verify database server is accessible
3. Check firewall rules
4. Verify ODBC driver is installed

### API Key Not Working

**Error:** "Unauthorized"

**Solutions:**
1. Verify `CLINIC_MANAGEMENT_API_KEY` is set in `.env`
2. Check header name: `X-API-Key` (case-sensitive)
3. Restart server after changing `.env`

### Excel File Upload Fails

**Error:** "No file uploaded"

**Solutions:**
1. Verify `multer` is installed: `npm install multer`
2. Check Content-Type is `multipart/form-data`
3. Verify file field name is `file`

### Template Generation Fails

**Error:** "Cannot find module 'xlsx'"

**Solutions:**
1. Install dependencies: `npm install`
2. Verify `xlsx` is in `package.json`
3. Check Node.js version (16+ required)

### Duplicate Detection Not Working

**Error:** No duplicates found when expected

**Solutions:**
1. Verify `fuzzball` is installed
2. Check database has existing clinics
3. Verify PlaceID format is correct
4. Check similarity thresholds in code

## Maintenance

### Regular Tasks

1. **Review Drafts:** Check pending drafts regularly
2. **Clean Old Drafts:** Archive or delete old rejected drafts
3. **Monitor Errors:** Check logs for issues
4. **Update API Keys:** Rotate keys periodically
5. **Backup Database:** Regular backups of draft tables

### Database Maintenance

```sql
-- View draft statistics
SELECT Status, COUNT(*) as Count
FROM ClinicDrafts
GROUP BY Status;

-- Find old drafts
SELECT DraftID, ClinicName, Status, SubmittedAt
FROM ClinicDrafts
WHERE SubmittedAt < DATEADD(month, -3, GETDATE())
  AND Status IN ('rejected', 'merged');

-- Clean up old drafts (be careful!)
-- DELETE FROM ClinicDrafts
-- WHERE SubmittedAt < DATEADD(month, -6, GETDATE())
--   AND Status IN ('rejected', 'merged');
```

## Upgrading

When updating the service:

1. **Backup database** before migrations
2. **Review changelog** for breaking changes
3. **Run migrations** if new ones exist
4. **Update dependencies:** `npm install`
5. **Test thoroughly** before production
6. **Update API keys** if needed

## Security Considerations

1. **API Keys:** Use strong, random keys
2. **HTTPS:** Always use HTTPS in production
3. **Rate Limiting:** Implement for public endpoints
4. **Input Validation:** All inputs are validated
5. **SQL Injection:** Using parameterized queries
6. **File Uploads:** Validate file types and sizes

## Performance

### Optimization Tips

1. **Indexes:** Database indexes are created automatically
2. **Batch Operations:** Bulk import processes in batches
3. **Caching:** Consider caching for duplicate detection
4. **Connection Pooling:** Already implemented in `db.js`

### Monitoring

Monitor these metrics:
- API response times
- Database query performance
- File upload sizes
- Duplicate detection accuracy
- Draft approval rates

## Support

For issues or questions:

1. Check documentation in `docs/` folder
2. Review error logs
3. Test with sample data
4. Contact system administrator

## Next Steps

After setup:

1. **Generate API key** for your teammate
2. **Download template** and test with sample data
3. **Integrate forms** using integration guide
4. **Set up admin dashboard** (if needed)
5. **Train users** on Excel template format

## Additional Resources

- [API Documentation](./API_DOCUMENTATION.md)
- [Excel Template Guide](./EXCEL_TEMPLATE_GUIDE.md)
- [Duplicate Detection Guide](./DUPLICATE_DETECTION_GUIDE.md)
- [Integration Guide](./INTEGRATION_GUIDE.md)

