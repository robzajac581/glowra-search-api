# AI Context Document

**Last Updated:** October 15, 2025

This document provides high-level context for AI assistants working with the Glowra Search API codebase.

## Project Overview

**Glowra Search API** is a backend API for a cosmetic/plastic surgery clinic directory and search platform. It provides:
- Clinic information and search functionality
- Provider/doctor listings by clinic
- Procedure pricing and availability
- Google Places integration (ratings, reviews, business info)
- Location-based search capabilities

## Tech Stack

- **Runtime:** Node.js with Express.js
- **Database:** Microsoft SQL Server (Azure SQL)
- **External APIs:** Google Places API (legacy version)
- **Scheduled Jobs:** node-cron for automated tasks

## Key Components

### 1. Core API Endpoints (`app.js`)

- **`GET /api/clinics`** - Search clinics by location, specialty, procedure
- **`GET /api/clinics/:clinicId`** - Get detailed clinic information with reviews
- **`GET /api/clinics/:clinicId/providers`** - Get providers for a clinic
- **`GET /api/clinics/:clinicId/procedures`** - Get procedures offered by a clinic
- **`POST /api/admin/refresh-ratings`** - Manually refresh Google ratings/reviews

### 2. Database Layer (`db.js`)

- Connection pooling for SQL Server
- Singleton pattern for connection management
- Environment-based configuration

### 3. Google Places Integration

**Files:**
- `utils/googlePlaces.js` - Google Places API wrapper
- `jobs/ratingRefresh.js` - Scheduled refresh job

**What it does:**
- Fetches ratings (1-5 stars)
- Fetches review counts
- Fetches up to 5 review texts per clinic
- Updates cached data daily at 2 AM

**Important limitations:**
- Google returns max 5 reviews per place
- Some medical facilities may have restricted review data
- Requires billing enabled in Google Cloud Console
- Uses legacy "Places API" (not "Places API (New)")

### 4. Scheduled Jobs

**Rating Refresh Job:**
- Runs daily at 2:00 AM EST
- Refreshes all clinics with PlaceIDs
- Rate-limited (10 concurrent, 500ms delay)
- Logs results to console

## Database Schema (Key Tables)

### Clinics
Primary clinic information:
- Basic info: Name, Address, Phone, Website
- Location: Latitude, Longitude, LocationID
- Google data: PlaceID, GoogleRating, GoogleReviewCount, GoogleReviewsJSON
- Last update tracking: LastRatingUpdate

### GooglePlacesData
Rich Google Places information:
- Visual: Photo, Logo, StreetView
- Business: Description, Category, BusinessStatus, WorkingHours
- Social: Facebook, Instagram, LinkedIn, Twitter, YouTube
- Links: GoogleProfileLink, ReviewsLink, BookingAppointmentLink

### Providers
Doctor/provider information linked to clinics

### Procedures
Procedures offered with pricing, linked to providers and clinics

### Locations
Geographic locations for filtering/search

## Environment Variables Required

```
# Database
DB_SERVER=your-server.database.windows.net
DB_NAME=your-database
DB_USER=your-username
DB_PASSWORD=your-password

# Google Places API
GOOGLE_PLACES_API_KEY=your-api-key

# Server
PORT=3000 (or 3001)
TZ=America/New_York (optional, for cron jobs)
```

## Recent Changes (October 2025)

### October 15: Google Reviews Enabled
- Fixed review text retrieval from Google Places API
- All 130 clinics refreshed successfully
- ~90% of clinics now have review text available
- Confirmed automatic refresh system is operational

### October 13: Initial Import
- Imported Google Places data for all clinics
- Consolidated unmatched clinics
- Fixed incorrect matches
- Established database structure

## Common Tasks

### Manual Rating Refresh
```bash
# All clinics
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" -d '{}'

# Specific clinic
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" -d '{"clinicId": 9}'
```

### Check Clinic Reviews
```bash
curl http://localhost:3001/api/clinics/9 | jq '.reviews'
```

### Server Startup
```bash
node app.js
# Server runs on port from env or default 3000
# Cron jobs initialize automatically
```

## Known Issues & Considerations

1. **Google API Quota:**
   - Daily refresh hits API 130 times
   - Manual refreshes count toward quota
   - Monitor usage in Google Cloud Console

2. **Review Text Availability:**
   - Not all clinics have reviews on Google
   - Some hospitals may have restricted data
   - Empty reviews array doesn't mean error - clinic may have no reviews

3. **Database Connection:**
   - Uses singleton pattern - one pool for entire app
   - Pool handles reconnection automatically
   - May need manual restart if Azure SQL maintenance occurs

4. **Scheduled Jobs:**
   - Require server to be continuously running
   - Use a process manager (PM2) or container orchestration for production
   - Check logs to verify cron jobs are running

## Architecture Notes

### Cache-First Design
- Google Places data is cached in database
- API endpoints read from cache (fast)
- Background job updates cache daily
- No real-time API calls from user requests (cost-effective)

### Rate Limiting
- Batch processing with concurrency limits
- Delays between batches to respect Google limits
- Retry logic with exponential backoff

### Error Handling
- Failed API calls don't crash the app
- Errors logged but continue processing other clinics
- Manual retry available via admin endpoint

## Testing Recommendations

When modifying code:

1. **Test with known good clinic:**
   - Clinic ID 9 (CG Cosmetic) - has 5 reviews
   - Clinic ID 13 (Seduction Cosmetic) - has 5 reviews

2. **Test edge cases:**
   - Clinics with no reviews
   - Clinics with missing PlaceIDs
   - Invalid clinic IDs

3. **Check logs:**
   - Detailed logging in googlePlaces.js
   - Database update confirmations
   - Error messages with context

## Additional Resources

- **Documentation:** `/docs/` folder
- **Setup Guide:** `/docs/GOOGLE_PLACES_SETUP.md`
- **Architecture Diagrams:** `/docs/ARCHITECTURE_DIAGRAM.md`
- **Recent Reports:** `/docs/reports/`

---

**For AI Assistants:**
This project is well-documented and has working automated systems. Before suggesting new features:
1. Check if functionality already exists
2. Review `/docs/reports/` for recent changes
3. Test with the manual endpoints before modifying code
4. Preserve existing patterns (singleton DB, batch processing, error handling)
