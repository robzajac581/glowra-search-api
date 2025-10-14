# Google Places API Rating System - Setup Guide

## ✅ Implementation Complete

All components have been successfully implemented for the Google Places API rating system with database caching.

## 📋 What Was Implemented

### 1. Database Schema Updates
**File:** `schema/add_google_ratings.sql`

Added the following columns to the Clinics table:
- `PlaceID` - Google Place ID
- `GoogleRating` - Cached rating (DECIMAL 2,1)
- `GoogleReviewCount` - Number of reviews (INT)
- `GoogleReviewsJSON` - Full review data (NVARCHAR MAX)
- `LastRatingUpdate` - Last refresh timestamp (DATETIME)

### 2. Google Places API Integration
**File:** `utils/googlePlaces.js`

Features:
- ✅ Fetch place details from Google Places API
- ✅ Retry logic with exponential backoff
- ✅ Rate limiting for batch operations
- ✅ Comprehensive error handling
- ✅ Cache freshness checking
- ✅ Structured review parsing

### 3. Updated Clinic Endpoint
**File:** `app.js` - GET `/api/clinics/:clinicId`

Features:
- ✅ Always returns cached data from database (never calls Google API)
- ✅ Fast, consistent response times for users
- ✅ No risk of API timeouts affecting user experience
- ✅ Returns real rating/review data from database cache

### 4. Admin Refresh Endpoint
**File:** `app.js` - POST `/api/admin/refresh-ratings`

Features:
- ✅ Refresh single clinic or all clinics
- ✅ Batch processing with rate limiting
- ✅ Detailed response with success/failure counts
- ✅ Individual clinic update tracking

### 5. Scheduled Rating Refresh Job
**File:** `jobs/ratingRefresh.js`

Features:
- ✅ Daily execution at 2:00 AM (configurable timezone)
- ✅ Processes all clinics with PlaceIDs
- ✅ Rate limiting to avoid API quota issues
- ✅ Detailed logging and summary statistics
- ✅ Graceful error handling

### 6. Dependencies Installed
- ✅ `node-cron` - Job scheduling
- ✅ `axios` - HTTP requests

### 7. Documentation
- ✅ Comprehensive README.md
- ✅ Environment variables documented
- ✅ API endpoint documentation
- ✅ Troubleshooting guide

## 🚀 Setup Instructions

### Step 1: Run Database Schema Update

Execute the SQL script to add required columns:

```sql
-- Connect to your database and run:
-- File: schema/add_google_ratings.sql
```

The script includes checks to prevent duplicate columns if re-run.

### Step 2: Update Environment Variables

Add to your `.env` file:

```env
# Google Places API Key (REQUIRED)
GOOGLE_PLACES_API_KEY=your_api_key_here

# Cache duration in hours (OPTIONAL, default: 24)
RATING_CACHE_HOURS=24

# Timezone for scheduled jobs (OPTIONAL, default: America/Chicago)
TZ=America/Chicago
```

### Step 3: Obtain Google Places API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Places API** (New)
4. Create credentials → API Key
5. Restrict the API key to Places API for security
6. Copy the key to your `.env` file

### Step 4: Populate PlaceID Column

For each clinic, you need to obtain its Google Place ID:

**Option A: Manual Lookup**
1. Search for the clinic on [Google Maps](https://maps.google.com)
2. Copy the Place ID from the URL or use the [Place ID Finder](https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder)

**Option B: Bulk Update SQL**
```sql
-- Example: Update PlaceIDs for clinics
UPDATE Clinics 
SET PlaceID = 'ChIJN1t_tDeuEmsRUsoyG83frY4' 
WHERE ClinicID = 1;

-- Add more updates as needed
```

### Step 5: Restart Server

```bash
node app.js
```

You should see:
```
Connected to MSSQL
Initializing rating refresh cron job...
Schedule: Daily at 2:00 AM (0 2 * * *)
Rating refresh cron job initialized successfully
Scheduled jobs initialized
Server running on port 3001
```

## 🧪 Testing

### Test 1: Individual Clinic Rating Fetch

```bash
# Visit a clinic with a valid PlaceID
curl http://localhost:3001/api/clinics/1
```

Expected behavior:
- Always returns cached data from database immediately
- Fast response time (no API calls during user requests)
- Data is refreshed daily by the scheduled job at 2 AM
- Use the admin endpoint to manually refresh if needed

### Test 2: Manual Refresh (Single Clinic)

```bash
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" \
  -d '{"clinicId": 1}'
```

Expected response:
```json
{
  "message": "Rating refresh completed",
  "total": 1,
  "updated": 1,
  "failed": 0,
  "details": [
    {
      "clinicId": 1,
      "clinicName": "Example Clinic",
      "status": "success",
      "rating": 4.5,
      "reviewCount": 42
    }
  ]
}
```

### Test 3: Manual Refresh (All Clinics)

```bash
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Test 4: Verify Database Updates

```sql
-- Check cached rating data
SELECT 
  ClinicID,
  ClinicName,
  PlaceID,
  GoogleRating,
  GoogleReviewCount,
  LastRatingUpdate
FROM Clinics
WHERE PlaceID IS NOT NULL;
```

### Test 5: Verify Fast Response Times

1. Request clinic endpoint: `curl http://localhost:3001/api/clinics/1`
2. Check response time - should be very fast (< 100ms)
3. Check logs - should see no Google API calls during user requests
4. All Google API calls happen only during:
   - Scheduled job (daily at 2 AM)
   - Manual admin refresh endpoint

## 📊 Monitoring

### Check Scheduled Job Logs

The cron job runs daily at 2 AM and logs:
```
=== Starting scheduled rating refresh ===
Time: 2025-09-29T06:00:00.000Z
Found 10 clinic(s) with PlaceIDs to refresh
Fetching data from Google Places API...
Updating database...
✓ Updated clinic 1 (Example Clinic): 4.5 stars, 42 reviews
✓ Updated clinic 2 (Another Clinic): 4.8 stars, 156 reviews
...
--- Refresh Summary ---
Total clinics: 10
Successfully updated: 8
Failed: 2
Skipped: 0
=== Scheduled rating refresh completed ===
```

### Monitor API Usage

Check your Google Cloud Console to monitor:
- Daily API request count
- Quota usage
- Costs (if applicable)

**Optimization Tips:**
- Increase `RATING_CACHE_HOURS` to reduce API calls
- Schedule refresh during off-peak hours
- Consider processing only clinics with recent activity

## 🔧 Configuration Options

### Adjust Cache Duration

```env
RATING_CACHE_HOURS=48  # Refresh every 2 days instead of daily
```

### Change Scheduled Job Time

Edit `jobs/ratingRefresh.js`:
```javascript
// Current: Daily at 2 AM
const cronSchedule = '0 2 * * *';

// Examples:
// '0 3 * * *'     - Daily at 3 AM
// '0 2 * * 0'     - Sundays at 2 AM
// '0 2 1,15 * *'  - 1st and 15th of month at 2 AM
// '0 */6 * * *'   - Every 6 hours
```

### Adjust Rate Limiting

Edit `utils/googlePlaces.js` or endpoint calls:
```javascript
// Current settings for batch refresh:
batchFetchPlaceDetails(placeIds, 10, 500)
//                                ^^  ^^^
//                                |    |
//                                |    Delay (ms) between batches
//                                Concurrent requests per batch

// To be more aggressive (higher API usage):
batchFetchPlaceDetails(placeIds, 20, 200)

// To be more conservative (lower API usage):
batchFetchPlaceDetails(placeIds, 5, 1000)
```

## ⚠️ Important Notes

### API Costs

- Google Places API is **not free** after certain limits
- Check [current pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- Place Details requests typically cost $0.017 per request
- Monitor usage in Google Cloud Console

### Security

- **Never commit** `.env` file to version control
- Restrict API key to specific IPs or domains in production
- Consider implementing authentication on admin endpoints
- Use HTTPS in production

### Database Maintenance

- Consider adding indexes for performance:
  ```sql
  CREATE INDEX IX_Clinics_LastRatingUpdate ON Clinics(LastRatingUpdate);
  ```
- Archive old review data if needed
- Monitor `GoogleReviewsJSON` column size

## 🐛 Troubleshooting

### Issue: No ratings showing up

**Check:**
1. Does the clinic have a `PlaceID` in the database?
2. Is `GOOGLE_PLACES_API_KEY` set in `.env`?
3. Check server logs for API errors
4. Verify the Place ID is valid on Google Maps

### Issue: "REQUEST_DENIED" error

**Solutions:**
1. Verify Places API is enabled in Google Cloud Console
2. Check API key restrictions
3. Ensure billing is enabled on Google Cloud project

### Issue: Ratings not updating

**Check:**
1. `LastRatingUpdate` timestamp in database
2. `RATING_CACHE_HOURS` setting
3. Server logs for errors
4. Scheduled job is running (`node-cron` initialized)

### Issue: High API costs

**Solutions:**
1. Increase `RATING_CACHE_HOURS` (e.g., 48 or 72 hours)
2. Reduce scheduled job frequency
3. Only request ratings for active/popular clinics
4. Implement smart refresh (prioritize clinics with recent traffic)

## 📞 Support

If you encounter issues:

1. Check server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test Google API key with curl:
   ```bash
   curl "https://maps.googleapis.com/maps/api/place/details/json?place_id=YOUR_PLACE_ID&fields=rating&key=YOUR_API_KEY"
   ```
4. Review this setup guide and README.md

## ✨ Next Steps

Consider implementing:

- [ ] Authentication for admin endpoints
- [ ] Webhooks to notify when ratings change significantly
- [ ] Analytics dashboard for rating trends
- [ ] Smart refresh (prioritize recently viewed clinics)
- [ ] Email alerts for failed refreshes
- [ ] A/B testing different cache durations
- [ ] Review sentiment analysis

---

**Implementation Date:** September 29, 2025
**Version:** 1.0.0

