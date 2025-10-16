# Quick Start: Google Reviews

## ✅ Status: WORKING

Google reviews are now fully operational in your API.

## Quick Test

```bash
# View reviews for CG Cosmetic (has 5 reviews)
curl http://localhost:3001/api/clinics/9 | jq '.reviews'
```

## What You Have Now

- **130 clinics** with fresh Google data
- **~90% have review text** (up to 5 reviews each)
- **Automatic daily refresh** at 2 AM EST
- **Manual refresh available** via admin endpoint

## API Response Format

```json
{
  "ClinicID": 9,
  "ClinicName": "CG Cosmetic",
  "GoogleRating": 4.5,
  "GoogleReviewCount": 10632,
  "reviews": [
    {
      "author": "John Doe",
      "rating": 5,
      "text": "Great experience...",
      "time": "2024-03-15T10:30:00.000Z",
      "relativeTime": "8 months ago",
      "profilePhoto": "https://..."
    }
  ]
}
```

## Automatic Refresh System

✅ **Already configured and running**

- **Location:** `jobs/ratingRefresh.js`
- **Schedule:** Daily at 2:00 AM
- **Status:** Active
- **No action needed**

## Manual Refresh (if needed)

```bash
# Refresh all clinics
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" -d '{}'

# Refresh specific clinic
curl -X POST http://localhost:3001/api/admin/refresh-ratings \
  -H "Content-Type: application/json" -d '{"clinicId": 9}'
```

## For Frontend Team

Copy this message:

---

**Google Reviews Now Available! 🎉**

The backend API now provides Google review text for all clinics.

**Endpoint:** `GET /api/clinics/:clinicId`

**New fields in response:**
- `reviews` - Array of up to 5 reviews with full text
- Each review has: `author`, `rating`, `text`, `time`, `relativeTime`, `profilePhoto`

**Coverage:**
- ~90% of clinics have review text
- 100% have ratings and review counts
- For clinics without review text, use `ReviewsLink` field to link to Google

**No changes needed to your existing API calls** - just use the new `reviews` field!

---

## Documentation

Full details in: `/docs/reports/GOOGLE_REVIEWS_UPDATE.md`

**Last refresh:** October 15, 2025  
**Next auto-refresh:** October 16, 2025 at 2:00 AM
