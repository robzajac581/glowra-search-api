# Glowra Search API

Backend API for the Glowra clinic search and rating system.

## Features

- Clinic search with filtering by location, price, specialty, and category
- Google Places API integration for clinic ratings and reviews
- Automatic rating cache with configurable expiration
- Scheduled daily rating refresh
- Admin endpoints for manual rating updates

## Setup

### Prerequisites

- Node.js (v14 or higher)
- SQL Server database
- Google Places API key

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```env
   # Database Configuration
   DB_DRIVER={ODBC Driver 17 for SQL Server}
   DB_SERVER=your_server.database.windows.net
   DB_NAME=your_database_name
   DB_USER=your_username
   DB_PASSWORD=your_password

   # Google Places API
   GOOGLE_PLACES_API_KEY=your_google_places_api_key_here

   # Rating Cache Configuration
   RATING_CACHE_HOURS=24

   # Server Configuration
   PORT=3001
   NODE_ENV=development

   # Timezone for scheduled jobs (optional, defaults to America/New_York)
   TZ=America/Chicago
   ```

4. Run the database schema update script:
   ```sql
   -- Execute the SQL script in schema/add_google_ratings.sql
   -- This will add the necessary columns to your Clinics table
   ```

### Running the Server

```bash
node app.js
```

The server will start on port 3001 (or the port specified in your `.env` file).

## Database Schema

### Required Columns in Clinics Table

The following columns are required for the Google Places integration:

- `PlaceID` (NVARCHAR(255)): Google Place ID for the clinic
- `GoogleRating` (DECIMAL(2,1)): Cached Google rating (0.0 - 5.0)
- `GoogleReviewCount` (INT): Number of Google reviews
- `GoogleReviewsJSON` (NVARCHAR(MAX)): JSON array of review details
- `LastRatingUpdate` (DATETIME): Timestamp of last rating refresh

Run the provided SQL script in `schema/add_google_ratings.sql` to add these columns automatically.

## API Endpoints

### Clinic Endpoints

#### Get Clinic Details
```
GET /api/clinics/:clinicId
```

Returns clinic details including cached Google ratings and reviews from the database. This endpoint never calls the Google Places API directly - data is kept fresh by the scheduled job that runs daily at 2 AM.

**Response:**
```json
{
  "ClinicID": 1,
  "ClinicName": "Example Clinic",
  "Address": "123 Main St",
  "Website": "https://example.com",
  "PlaceID": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "rating": 4.5,
  "reviewCount": 42,
  "reviews": [...],
  "isOpen": true,
  "lastRatingUpdate": "2025-09-29T10:30:00.000Z"
}
```

#### Get Clinic Providers
```
GET /api/clinics/:clinicId/providers
```

Returns list of providers/doctors for the specified clinic.

#### Get Clinic Procedures
```
GET /api/clinics/:clinicId/procedures
```

Returns procedures offered by the clinic, grouped by category.

### Admin Endpoints

#### Manual Rating Refresh
```
POST /api/admin/refresh-ratings
```

Manually trigger a rating refresh for one or all clinics.

**Request Body:**
```json
{
  "clinicId": 1  // Optional: omit to refresh all clinics
}
```

**Response:**
```json
{
  "message": "Rating refresh completed",
  "total": 10,
  "updated": 8,
  "failed": 2,
  "details": [...]
}
```

### Search Endpoints

#### Search Procedures
```
GET /api/procedures?searchQuery=botox&location=Miami&minPrice=100&maxPrice=500
```

Search for procedures with optional filters.

**Query Parameters:**
- `searchQuery`: Search term (searches across procedure name, clinic, provider, specialty, category)
- `location`: City or state
- `minPrice`: Minimum price
- `maxPrice`: Maximum price
- `specialty`: Medical specialty
- `category`: Procedure category
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 100)

## Scheduled Jobs

### Rating Refresh Job

The application runs a scheduled job daily at 2:00 AM to refresh ratings for all clinics with PlaceIDs.

- **Schedule:** Daily at 2:00 AM (configurable timezone)
- **Concurrency:** Processes 10 clinics at a time with 500ms delay between batches
- **Rate Limiting:** Built-in to avoid Google API quota issues
- **Error Handling:** Continues processing even if individual clinics fail

The job logs detailed information about each refresh operation and provides a summary at completion.

## Google Places API Integration

### Architecture

The system uses a **cache-first** approach for optimal performance:

1. **User Requests** → Always return cached data from database (fast, no API calls)
2. **Scheduled Job** → Updates all clinic ratings daily at 2 AM via Google Places API
3. **Manual Refresh** → Admin endpoint for on-demand updates when needed

This ensures:
- ⚡ Fast, consistent response times for users
- 💰 Predictable API costs
- 🛡️ No user-facing timeouts or API errors

### Features

- Fetches rating, review count, reviews, and opening hours
- Automatic retry logic with exponential backoff
- Rate limiting to prevent quota exhaustion
- Scheduled daily updates keep data fresh

### API Cost Optimization

- Only requests necessary fields (`rating`, `user_ratings_total`, `reviews`, `opening_hours`)
- Implements caching with configurable expiration (default: 24 hours)
- Batch processing with rate limiting for bulk updates
- Automatic retry logic for transient failures

### Rate Limits

- Maximum 5 concurrent requests during live requests
- Maximum 10 concurrent requests during scheduled refreshes
- 200-500ms delay between batches
- Exponential backoff on failures

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_SERVER` | Yes | - | SQL Server hostname |
| `DB_NAME` | Yes | - | Database name |
| `DB_USER` | Yes | - | Database username |
| `DB_PASSWORD` | Yes | - | Database password |
| `DB_DRIVER` | No | `{ODBC Driver 17 for SQL Server}` | ODBC driver |
| `GOOGLE_PLACES_API_KEY` | Yes | - | Google Places API key |
| `RATING_CACHE_HOURS` | No | `24` | Hours before cache expires |
| `PORT` | No | `3001` | Server port |
| `NODE_ENV` | No | `development` | Environment (development/production) |
| `TZ` | No | `America/New_York` | Timezone for scheduled jobs |

## Error Handling

The API implements comprehensive error handling:

- **Database Errors:** Returns 500 with error details in development mode
- **API Failures:** Falls back to cached data when available
- **Missing PlaceID:** Returns default values (0 rating, 0 reviews)
- **Rate Limiting:** Implements exponential backoff and retry logic
- **Scheduled Job Errors:** Logs errors but continues processing

## Development

### Project Structure

```
glowra-search-api/
├── app.js                      # Main application file
├── db.js                       # Database connection manager
├── package.json                # Dependencies
├── .env                        # Environment variables (not in git)
├── schema/
│   └── add_google_ratings.sql  # Database schema updates
├── utils/
│   └── googlePlaces.js         # Google Places API integration
├── jobs/
│   └── ratingRefresh.js        # Scheduled rating refresh job
└── services/
    └── clinicSearchService.js  # Clinic search service
```

### Adding New Features

1. Follow existing patterns for error handling
2. Use connection pooling from `db.js`
3. Add appropriate logging for debugging
4. Document new endpoints in this README

## Testing

### Manual Testing Checklist

- [ ] Test with a clinic that has a valid PlaceID
- [ ] Test with a clinic missing a PlaceID (should handle gracefully)
- [ ] Test cache expiration logic (modify RATING_CACHE_HOURS)
- [ ] Test manual refresh endpoint
- [ ] Verify database updates are working
- [ ] Check that frontend displays ratings correctly
- [ ] Test scheduled job (can manually trigger via admin endpoint)
- [ ] Test error handling (invalid API key, network errors)

### Testing the Admin Endpoint

```bash
# Refresh a specific clinic
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" \
  -d '{"clinicId": 1}'

# Refresh all clinics
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Troubleshooting

### Common Issues

**"GOOGLE_PLACES_API_KEY is not configured"**
- Ensure your `.env` file contains the `GOOGLE_PLACES_API_KEY` variable
- Verify the API key is valid and has Places API enabled

**"Could not establish database connection"**
- Check database credentials in `.env`
- Verify SQL Server is accessible from your network
- Ensure firewall allows connections

**"Google Places API quota exceeded"**
- Check your Google Cloud Console for API usage
- Consider increasing `RATING_CACHE_HOURS` to reduce API calls
- Review rate limiting settings in `utils/googlePlaces.js`

**Scheduled job not running**
- Check server logs for initialization errors
- Verify `TZ` environment variable is set correctly
- Ensure node-cron is installed (`npm list node-cron`)

## License

Proprietary - All rights reserved

## Support

For issues or questions, please contact the development team.