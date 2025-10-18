# Clinic Photos Implementation Guide

**Last Updated**: October 17, 2025  
**Status**: Ready for Implementation  
**Database**: SQL Server (Azure)  

---

## 📋 Overview

This guide explains how to retrieve, store, and serve clinic photos from Google Places API efficiently and cost-effectively.

### ✅ Solution Summary

**Approach**: Store Google photo references in database, serve via Google's CDN

**Why This Works Best**:
- ✅ Zero storage costs
- ✅ Zero bandwidth costs  
- ✅ Google's global CDN (fast delivery worldwide)
- ✅ SEO-friendly (Google-hosted images are already indexed)
- ✅ Automatic image optimization via URL parameters
- ✅ Scalable from 150 to 10,000+ clinics
- ✅ Simple integration with existing Google Places setup

---

## 🏗️ Architecture

### Data Flow

```
1. Google Places API → Fetch photo references (one-time or daily refresh)
2. Photo references → Store in ClinicPhotos table
3. Frontend requests → Backend serves photo URLs from database
4. Browser loads images → Directly from Google's CDN
```

### Database Schema

**New Table: `ClinicPhotos`**

```sql
CREATE TABLE ClinicPhotos (
  PhotoID INT PRIMARY KEY IDENTITY(1,1),
  ClinicID INT NOT NULL,
  PhotoReference NVARCHAR(1000),      -- Google's photo reference
  PhotoURL NVARCHAR(2000),            -- Pre-constructed URL (1600px)
  Width INT,                          -- Original dimensions
  Height INT,
  AttributionText NVARCHAR(500),      -- Required by Google TOS
  IsPrimary BIT DEFAULT 0,            -- Featured photo flag
  DisplayOrder INT DEFAULT 0,         -- Display order (0 = first)
  LastUpdated DATETIME DEFAULT GETDATE(),
  
  FOREIGN KEY (ClinicID) REFERENCES Clinics(ClinicID)
);
```

**Key Features**:
- Stores 10-20 photos per clinic
- First photo (`IsPrimary=1`) is the featured image
- Photos ordered by `DisplayOrder` for consistent display
- Photo references never expire (per Google's documentation)

---

## 🚀 Setup Instructions

### Step 1: Run Database Migration

```bash
# Run the migration to create ClinicPhotos table
node scripts/runMigration.js migrations/addClinicPhotos.sql
```

Or manually execute the SQL file in your database management tool.

### Step 2: Fetch Photos for All Clinics

```bash
# Fetch photos for all clinics (default: max 20 photos per clinic)
node scripts/fetchClinicPhotos.js

# Fetch for a specific clinic
node scripts/fetchClinicPhotos.js --clinic-id=5

# Limit photos per clinic
node scripts/fetchClinicPhotos.js --limit=15
```

**Expected Output**:
```
======================================================================
🏥 CLINIC PHOTOS FETCH & STORAGE SCRIPT
======================================================================
Max photos per clinic: 20
Delay between requests: 200ms

✓ Connected to database

Found 130 clinic(s) to process

📸 Fetching photos for: Advanced Dermatology (ID: 1)
   PlaceID: ChIJ...
   ✓ Found 18 photos from Google
   ✅ Stored 18 photos in database

[... continues for each clinic ...]

======================================================================
📊 SUMMARY
======================================================================
Total clinics processed: 130
✅ Successful: 128
❌ Failed: 2
📸 Total photos stored: 2,145
📈 Average photos per clinic: 16.8

✅ Script completed successfully!
```

### Step 3: Test the API Endpoint

```bash
# Get all photos for a clinic
curl http://localhost:3001/api/clinics/1/photos

# Get only the primary/featured photo
curl http://localhost:3001/api/clinics/1/photos?primary=true

# Get first 5 photos
curl http://localhost:3001/api/clinics/1/photos?limit=5
```

**Sample Response**:
```json
{
  "clinicId": 1,
  "count": 18,
  "photos": [
    {
      "photoId": 1,
      "url": "https://maps.googleapis.com/.../photo?...&maxwidth=1600",
      "urls": {
        "thumbnail": "https://maps.googleapis.com/.../photo?...&maxwidth=400",
        "medium": "https://maps.googleapis.com/.../photo?...&maxwidth=800",
        "large": "https://maps.googleapis.com/.../photo?...&maxwidth=1600"
      },
      "width": 4032,
      "height": 3024,
      "attribution": "John Doe",
      "isPrimary": true,
      "displayOrder": 0,
      "lastUpdated": "2025-10-17T10:30:00.000Z"
    },
    {
      "photoId": 2,
      "url": "...",
      "urls": { ... },
      "isPrimary": false,
      "displayOrder": 1,
      ...
    }
  ]
}
```

---

## 📱 Frontend Integration

### Example: React Component for Clinic Photos

```jsx
import React, { useEffect, useState } from 'react';

function ClinicPhotoGallery({ clinicId }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function fetchPhotos() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/clinics/${clinicId}/photos?limit=20`
        );
        const data = await response.json();
        setPhotos(data.photos);
      } catch (error) {
        console.error('Failed to load photos:', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchPhotos();
  }, [clinicId]);
  
  if (loading) return <div>Loading photos...</div>;
  if (photos.length === 0) return null;
  
  return (
    <div className="photo-gallery">
      {/* Featured/Primary Photo */}
      <div className="featured-photo">
        <img 
          src={photos[0].urls.large}
          alt={`Clinic photo`}
          loading="lazy"
          width={photos[0].width}
          height={photos[0].height}
        />
        {photos[0].attribution && (
          <span className="attribution">Photo: {photos[0].attribution}</span>
        )}
      </div>
      
      {/* Thumbnail Grid */}
      <div className="photo-grid">
        {photos.slice(1).map(photo => (
          <img 
            key={photo.photoId}
            src={photo.urls.thumbnail}
            alt="Clinic"
            loading="lazy"
            width={400}
            height={300}
          />
        ))}
      </div>
    </div>
  );
}

export default ClinicPhotoGallery;
```

### Example: Hero Image for Clinic Page

```jsx
function ClinicHero({ clinicId }) {
  const [primaryPhoto, setPrimaryPhoto] = useState(null);
  
  useEffect(() => {
    async function fetchPrimaryPhoto() {
      const response = await fetch(
        `${API_BASE_URL}/api/clinics/${clinicId}/photos?primary=true`
      );
      const data = await response.json();
      if (data.photos.length > 0) {
        setPrimaryPhoto(data.photos[0]);
      }
    }
    
    fetchPrimaryPhoto();
  }, [clinicId]);
  
  if (!primaryPhoto) return null;
  
  return (
    <div className="hero-image">
      <img 
        src={primaryPhoto.urls.large}
        alt="Clinic"
        width={1600}
        height={900}
      />
    </div>
  );
}
```

---

## 🎯 Image Optimization Best Practices

### 1. Use Appropriate Image Sizes

**Recommendation**:
- **Thumbnails/Cards**: Use `thumbnail` (400px) - Fast loading
- **Gallery Previews**: Use `medium` (800px) - Good balance
- **Full Screen**: Use `large` (1600px) - Best quality
- **Hero Images**: Use `large` with responsive images

```jsx
<img 
  srcSet={`
    ${photo.urls.thumbnail} 400w,
    ${photo.urls.medium} 800w,
    ${photo.urls.large} 1600w
  `}
  sizes="(max-width: 600px) 400px, (max-width: 1200px) 800px, 1600px"
  src={photo.urls.large}
  alt="Clinic"
  loading="lazy"
/>
```

### 2. Implement Lazy Loading

```jsx
// Modern browsers (native lazy loading)
<img src={photo.urls.medium} loading="lazy" alt="Clinic" />

// Or use a library like react-lazyload
import LazyLoad from 'react-lazyload';

<LazyLoad height={200} offset={100}>
  <img src={photo.urls.medium} alt="Clinic" />
</LazyLoad>
```

### 3. Add Proper Dimensions

**Always specify width and height** to prevent layout shifts (CLS):

```jsx
<img 
  src={photo.urls.medium}
  width={photo.width}
  height={photo.height}
  alt="Clinic"
  loading="lazy"
/>
```

### 4. Implement Image Placeholders

```jsx
function OptimizedImage({ photo }) {
  const [loaded, setLoaded] = useState(false);
  
  return (
    <div className="image-container">
      {!loaded && (
        <div 
          className="placeholder" 
          style={{ 
            width: photo.width, 
            height: photo.height,
            backgroundColor: '#f0f0f0'
          }} 
        />
      )}
      <img 
        src={photo.urls.medium}
        onLoad={() => setLoaded(true)}
        style={{ display: loaded ? 'block' : 'none' }}
        alt="Clinic"
      />
    </div>
  );
}
```

### 5. Add Attribution (Required by Google TOS)

**Google requires photo attribution to be displayed**:

```jsx
{photo.attribution && (
  <span className="photo-attribution">
    Photo: {photo.attribution}
  </span>
)}
```

---

## 🔄 Keeping Photos Fresh

### Option 1: Add to Existing Cron Job

Update your existing `jobs/ratingRefresh.js` to also refresh photos:

```javascript
const { fetchPhotosForClinic } = require('../scripts/fetchClinicPhotos');

async function refreshRatingsAndPhotos() {
  // ... existing rating refresh code ...
  
  // Refresh photos weekly (only on Sundays)
  const today = new Date().getDay();
  if (today === 0) { // Sunday
    console.log('Refreshing clinic photos...');
    
    for (const clinic of clinics) {
      await fetchPhotosForClinic(
        pool, 
        clinic.ClinicID, 
        clinic.ClinicName, 
        clinic.PlaceID,
        20 // max photos
      );
    }
  }
}
```

### Option 2: Manual Refresh

```bash
# Refresh photos for all clinics monthly
node scripts/fetchClinicPhotos.js

# Refresh for a specific clinic when needed
node scripts/fetchClinicPhotos.js --clinic-id=5
```

### Recommended Frequency

- **Ratings**: Daily (as you already do)
- **Photos**: Weekly or Monthly
- **Reason**: Photos don't change as frequently as ratings

---

## 💰 Cost Analysis

### API Costs

**Google Places API Pricing** (as of 2025):
- Place Details request: **$0.017 per request**
- Photos field adds: **$0.007 per request**
- **Total with photos**: ~$0.024 per clinic

**Your Costs**:
- **Initial fetch (150 clinics)**: 150 × $0.024 = **$3.60**
- **Monthly refresh (150 clinics)**: 150 × $0.024 = **$3.60/month**
- **At 1000 clinics**: 1000 × $0.024 = **$24/month**

**Storage Costs**: **$0** (no image storage needed)
**Bandwidth Costs**: **$0** (Google's CDN)
**Total Cost**: **$3-24/month** (depending on clinic count)

### Cost Optimization Tips

1. **Refresh photos monthly** instead of daily (photos rarely change)
2. **Only fetch 10-15 photos** instead of 20 per clinic
3. **Batch requests** with delays to avoid rate limiting

---

## ⚡ Performance & SEO

### Web Vitals Impact

✅ **Largest Contentful Paint (LCP)**
- Using Google's CDN ensures fast image loading
- Images served from globally-distributed servers
- Proper image sizing prevents oversized downloads

✅ **Cumulative Layout Shift (CLS)**
- Width/height attributes prevent layout shifts
- Images load in their reserved space

✅ **First Input Delay (FID)**
- Lazy loading prevents blocking the main thread
- Images load as user scrolls

### SEO Benefits

✅ **Image Search Visibility**
- Google-hosted images are already indexed
- Proper alt text improves accessibility
- Fast loading improves page rank

✅ **Rich Snippets**
- Clinic pages can show image thumbnails in search results
- Better click-through rates

✅ **Mobile Optimization**
- Responsive images via `srcset`
- Automatic format optimization by Google

---

## 🔒 Security & Compliance

### Google Terms of Service

**Required**:
- ✅ Display photo attributions
- ✅ Don't cache images locally
- ✅ Don't modify images (except resizing via URL params)
- ✅ Keep data fresh (refresh periodically)

**Implementation**:
```jsx
{photo.attribution && (
  <span className="attribution">
    Photo by {photo.attribution}
  </span>
)}
```

### API Key Security

- ✅ Store API key in `.env` (never commit)
- ✅ Use environment variables in production
- ✅ Restrict API key to specific domains/IPs
- ✅ Monitor API usage in Google Cloud Console

---

## 🧪 Testing

### Test Checklist

- [ ] Database migration runs successfully
- [ ] Photos fetch script completes without errors
- [ ] API endpoint returns photos for all clinics
- [ ] Primary photo filter works (`?primary=true`)
- [ ] Limit parameter works (`?limit=5`)
- [ ] Images load correctly in browser
- [ ] Attribution displays properly
- [ ] Lazy loading works
- [ ] Responsive images load correct sizes
- [ ] Mobile display is optimized

### Manual Testing

```bash
# 1. Check database
SELECT TOP 10 * FROM ClinicPhotos ORDER BY ClinicID;

# 2. Test API
curl http://localhost:3001/api/clinics/1/photos | jq

# 3. Test in browser
open http://localhost:3001/api/clinics/1/photos

# 4. Check photo loads
# Copy a photo URL from API response and open in browser
```

---

## 🐛 Troubleshooting

### Issue: No photos returned

**Check**:
1. Did you run the migration? `SELECT * FROM ClinicPhotos`
2. Did you run the fetch script? Check script output
3. Does the clinic have a PlaceID? `SELECT PlaceID FROM Clinics WHERE ClinicID = X`
4. Check API key: `echo $GOOGLE_PLACES_API_KEY`

### Issue: Photos not loading in browser

**Check**:
1. Open photo URL directly in browser
2. Check browser console for CORS errors
3. Verify API key is valid
4. Check Google Cloud Console for quota limits

### Issue: Attribution showing HTML

**Fix**: Strip HTML tags from attribution

```javascript
// Already handled in fetchClinicPhotos.js
const attributionText = attributions.join('; ').replace(/<[^>]*>/g, '');
```

### Issue: Slow image loading

**Solutions**:
1. Use smaller image sizes (thumbnail/medium)
2. Implement lazy loading
3. Use responsive images with `srcset`
4. Add image placeholders

---

## 📊 Monitoring

### Check Photo Coverage

```sql
-- Clinics with photos
SELECT 
  c.ClinicID,
  c.ClinicName,
  COUNT(p.PhotoID) as PhotoCount
FROM Clinics c
LEFT JOIN ClinicPhotos p ON c.ClinicID = p.ClinicID
WHERE c.PlaceID IS NOT NULL
GROUP BY c.ClinicID, c.ClinicName
ORDER BY PhotoCount DESC;

-- Summary stats
SELECT 
  COUNT(DISTINCT ClinicID) as ClinicsWithPhotos,
  COUNT(*) as TotalPhotos,
  AVG(CAST(PhotosPerClinic AS FLOAT)) as AvgPhotosPerClinic
FROM (
  SELECT ClinicID, COUNT(*) as PhotosPerClinic
  FROM ClinicPhotos
  GROUP BY ClinicID
) AS Stats;
```

### Monitor API Usage

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to APIs & Services → Dashboard
3. Click on "Places API"
4. Check request counts and quotas

---

## ✨ Next Steps

### Enhancements to Consider

1. **Photo Carousel** - Interactive gallery with navigation
2. **Lightbox/Modal** - Full-screen photo viewer
3. **Image Zoom** - Pinch-to-zoom on mobile
4. **Photo Filtering** - Show interior/exterior photos separately
5. **User-Generated Photos** - Allow users to upload clinic photos
6. **Photo Reporting** - Let users report inappropriate photos
7. **A/B Testing** - Test different photo layouts for conversions

### Alternative Solutions (If Needed Later)

**If you outgrow Google's solution**:
1. **Cloudinary** - Advanced image transformations
2. **AWS S3 + CloudFront** - Self-hosted with CDN
3. **Imgix** - Real-time image optimization
4. **NextGen Formats** - Serve WebP/AVIF for better compression

**When to consider alternatives**:
- Need custom watermarks
- Need advanced editing
- Want to cache images indefinitely
- Google pricing becomes too high (>$100/month)

---

## 📚 API Reference

### GET `/api/clinics/:clinicId/photos`

Get photos for a specific clinic.

**Parameters**:
- `clinicId` (path, required): Clinic ID
- `limit` (query, optional): Max number of photos to return
- `primary` (query, optional): If true, return only primary photo

**Response**:
```json
{
  "clinicId": 1,
  "count": 15,
  "photos": [
    {
      "photoId": 1,
      "url": "string",
      "urls": {
        "thumbnail": "string",
        "medium": "string",
        "large": "string"
      },
      "width": 4032,
      "height": 3024,
      "attribution": "string",
      "isPrimary": true,
      "displayOrder": 0,
      "lastUpdated": "2025-10-17T10:30:00.000Z"
    }
  ]
}
```

**Example Requests**:
```bash
# Get all photos
GET /api/clinics/1/photos

# Get primary photo only
GET /api/clinics/1/photos?primary=true

# Get first 5 photos
GET /api/clinics/1/photos?limit=5
```

---

**Implementation Complete! Ready to Use!** 🎉

For questions or issues, refer to the troubleshooting section or check the Google Places API documentation.

