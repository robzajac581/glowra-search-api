# Provider Photos - Quick Start

## 🚀 Setup Instructions

### 1. Run Database Migration
```bash
# From project root
node scripts/runMigration.js migrations/addProviderPhotos.sql
```

### 2. Import Existing Photos
```bash
# Match and import the 83 provider photos
node scripts/importProviderPhotos.js
```

### 3. Restart Server
```bash
# Server will now serve provider photos
npm start
```

---

## 📡 API Usage

### Get Providers with Photos
```javascript
fetch('/api/clinics/123/providers')
  .then(res => res.json())
  .then(providers => {
    providers.forEach(provider => {
      console.log(provider.ProviderName);
      console.log(provider.PhotoURL);  // Photo URL or placeholder
      console.log(provider.hasPhoto);  // true/false
    });
  });
```

### Response Example
```json
[
  {
    "ProviderID": 456,
    "ProviderName": "Dr. Shannon S. Joseph",
    "Specialty": "Oculofacial Plastic Surgery",
    "PhotoURL": "/api/provider-photos/JOSEPH%20Advanced%20Oculofacial%20Plastic%20Surgery/Dr.Shannon%20S.Joseph.png",
    "hasPhoto": true
  }
]
```

---

## 💻 Frontend Example

```jsx
function ProviderCard({ provider }) {
  return (
    <div className="provider-card">
      <img
        src={provider.PhotoURL}
        alt={provider.ProviderName}
        loading="lazy"
        onError={(e) => e.target.src = '/img/doctor/placeholder.png'}
      />
      <h3>{provider.ProviderName}</h3>
      <p>{provider.Specialty}</p>
    </div>
  );
}
```

---

## 📊 Current Coverage

- **83 provider photos** matched and imported
- **74 clinics** have provider photos
- **~14-18%** of all providers have photos
- **Automatic fallback** to placeholder for providers without photos

---

## 🔧 Adding New Photos

1. Place photo in: `photos/Provider Pictures/[ClinicName]/[ProviderName].png`
2. Run: `node scripts/importProviderPhotos.js`
3. Script auto-matches using fuzzy name matching

---

## 📚 Full Documentation

See **[PROVIDER_PHOTOS_GUIDE.md](./PROVIDER_PHOTOS_GUIDE.md)** for:
- Complete API documentation
- React/Next.js examples
- SEO best practices
- Performance optimization
- Troubleshooting guide

---

## ✅ Architecture Highlights

✅ **Efficient**: Single query returns provider + photo URL  
✅ **Fast**: 7-day browser caching, static file serving  
✅ **Scalable**: Easy to migrate to CDN later  
✅ **SEO-friendly**: Proper alt tags, lazy loading  
✅ **Reliable**: Graceful fallbacks, error handling

---

**Status**: ✅ Production Ready

