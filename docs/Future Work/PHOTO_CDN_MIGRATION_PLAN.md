# Provider & Clinic Photos - CDN Migration & Scaling Plan

**Date**: October 18, 2025  
**Current Status**: Static file serving from local disk  
**Trigger Point**: When scaling to 500+ clinics or global traffic  

---

## 📊 Current State

### What We Have Now

**Architecture**: Hybrid - Database URLs + Static File Serving

```
┌──────────────────────────────────────────┐
│         Frontend Request                  │
│   GET /api/provider-photos/...           │
└─────────────────┬────────────────────────┘
                  ↓
┌──────────────────────────────────────────┐
│      Express Static File Serving          │
│   photos/Provider Pictures/               │
│   • 7-day browser caching                │
│   • ETag/Last-Modified headers           │
└─────────────────┬────────────────────────┘
                  ↓
┌──────────────────────────────────────────┐
│         Local Disk Storage                │
│   • 82 provider photos (~10-15MB)        │
│   • 130+ clinic photos (~50-100MB)       │
│   • Total: ~100-150MB                    │
└──────────────────────────────────────────┘
```

### Current Performance Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| **First Load** | 50-200ms | Static file delivery |
| **Cached Load** | ~5ms | 7-day browser cache |
| **Storage** | ~100-150MB | Local disk |
| **Bandwidth** | Minimal | Browser caching |
| **Global Latency** | 50-500ms | Depends on server location |

### Coverage

- **Provider Photos**: 82 photos (40% of providers)
- **Clinic Photos**: 130+ clinics (100% coverage)
- **Total Files**: ~200-300 images
- **Growth Rate**: +10-20 photos/month

---

## 🎯 When to Migrate to CDN

### Trigger Points

Migrate when **ANY** of these conditions are met:

1. **Scale Trigger**
   - [ ] 500+ clinics
   - [ ] 2000+ providers
   - [ ] 1000+ total photos

2. **Performance Trigger**
   - [ ] >100ms average image load time
   - [ ] High bandwidth costs (>$50/month)
   - [ ] Server CPU usage >60%

3. **Geographic Trigger**
   - [ ] International traffic >20%
   - [ ] Users outside North America
   - [ ] Latency complaints from users

4. **Business Trigger**
   - [ ] Series A funding or major growth
   - [ ] Enterprise clients requiring SLA
   - [ ] Marketing campaigns driving traffic

---

## 🏗️ CDN Migration Architecture

### Target Architecture

```
┌──────────────────────────────────────────┐
│         Frontend Request                  │
│   <img src="https://cdn.glowra.com/..."  │
└─────────────────┬────────────────────────┘
                  ↓
┌──────────────────────────────────────────┐
│         CDN (CloudFront/Cloudflare)       │
│   • Global edge locations                │
│   • Automatic image optimization         │
│   • 99.99% uptime SLA                    │
│   • DDoS protection                      │
└─────────────────┬────────────────────────┘
                  ↓
┌──────────────────────────────────────────┐
│      Cloud Storage (S3/R2/Spaces)         │
│   • Redundant storage                    │
│   • Automatic backups                    │
│   • Low latency                          │
└──────────────────────────────────────────┘
```

### Expected Performance Improvements

| Metric | Current | With CDN | Improvement |
|--------|---------|----------|-------------|
| **Global Latency** | 50-500ms | 10-50ms | 10x faster |
| **Availability** | 99.9% | 99.99% | 10x better |
| **Bandwidth Cost** | Server cost | $1-5/TB | Significant savings |
| **Server Load** | Medium | Minimal | 100% offloaded |

---

## 📋 Migration Plan

### Phase 1: Preparation (1-2 days)

**Goal**: Set up cloud infrastructure without affecting current system

1. **Choose CDN Provider**
   - Recommended: **Cloudflare R2 + CDN** (lowest cost, no egress fees)
   - Alternative: **AWS S3 + CloudFront** (enterprise-grade)
   - Alternative: **DigitalOcean Spaces + CDN** (simplicity)

2. **Create Cloud Storage Bucket**
   ```bash
   # Example: AWS S3
   aws s3 mb s3://glowra-photos
   aws s3api put-bucket-cors --bucket glowra-photos --cors-configuration file://cors.json
   ```

3. **Set Up CDN**
   - Create CloudFront/Cloudflare distribution
   - Configure custom domain: `cdn.glowra.com`
   - Enable image optimization
   - Set cache headers (30 days)

4. **Configure Image Optimization**
   - Enable WebP conversion
   - Auto-resize based on device
   - Lazy loading support

### Phase 2: Upload Existing Photos (2-4 hours)

**Goal**: Migrate all existing photos to cloud storage

1. **Create Upload Script**
   ```javascript
   // scripts/uploadPhotosToS3.js
   const AWS = require('aws-sdk');
   const fs = require('fs');
   const path = require('path');
   
   const s3 = new AWS.S3();
   
   async function uploadPhoto(localPath, s3Key) {
     const fileContent = fs.readFileSync(localPath);
     await s3.putObject({
       Bucket: 'glowra-photos',
       Key: s3Key,
       Body: fileContent,
       ContentType: 'image/png',
       CacheControl: 'max-age=2592000', // 30 days
     }).promise();
   }
   ```

2. **Upload Provider Photos**
   ```bash
   node scripts/uploadPhotosToS3.js --type providers
   ```

3. **Upload Clinic Photos**
   ```bash
   node scripts/uploadPhotosToS3.js --type clinics
   ```

4. **Verify Uploads**
   - Check all files uploaded successfully
   - Test CDN URLs work
   - Verify image optimization

### Phase 3: Update Database URLs (1 hour)

**Goal**: Update all PhotoURL fields to point to CDN

1. **Create Migration Script**
   ```javascript
   // scripts/migratePhotoUrlsToCDN.js
   const { sql, db } = require('../db');
   
   async function migrateUrls() {
     const pool = await db.getConnection();
     
     // Update provider photos
     await pool.request().query(`
       UPDATE Providers
       SET PhotoURL = REPLACE(
         PhotoURL,
         '/api/provider-photos/',
         'https://cdn.glowra.com/providers/'
       )
       WHERE PhotoURL LIKE '/api/provider-photos/%'
     `);
     
     // Update clinic photos (if using ClinicPhotos table)
     await pool.request().query(`
       UPDATE ClinicPhotos
       SET PhotoURL = REPLACE(
         PhotoURL,
         '/api/clinic-photos/',
         'https://cdn.glowra.com/clinics/'
       )
       WHERE PhotoURL LIKE '/api/clinic-photos/%'
     `);
   }
   ```

2. **Run Migration**
   ```bash
   node scripts/migratePhotoUrlsToCDN.js
   ```

3. **Verify Database**
   ```sql
   -- Check provider photos
   SELECT TOP 10 ProviderName, PhotoURL FROM Providers WHERE PhotoURL IS NOT NULL;
   
   -- Check clinic photos
   SELECT TOP 10 ClinicID, PhotoURL FROM ClinicPhotos;
   ```

### Phase 4: Update Backend (30 minutes)

**Goal**: Remove static file serving, update upload logic

1. **Remove Static File Serving**
   ```javascript
   // app.js - REMOVE these lines:
   // app.use('/api/provider-photos', express.static('photos/Provider Pictures'));
   ```

2. **Update Photo Upload Logic**
   ```javascript
   // When adding new photos, upload directly to S3
   const uploadToS3 = async (file, key) => {
     const s3 = new AWS.S3();
     return s3.putObject({
       Bucket: 'glowra-photos',
       Key: key,
       Body: file,
       ContentType: file.mimetype,
     }).promise();
   };
   ```

### Phase 5: Frontend Update (1 hour)

**Goal**: Update frontend to use new CDN URLs

**Good news**: Minimal changes needed! Photos are already served via URLs.

1. **Test New URLs**
   ```jsx
   // Frontend should work automatically since we updated the database
   // provider.PhotoURL now points to: https://cdn.glowra.com/providers/...
   ```

2. **Add Image Optimization**
   ```jsx
   // Optional: Add responsive images
   <img
     src={provider.PhotoURL}
     srcSet={`
       ${provider.PhotoURL}?w=150 150w,
       ${provider.PhotoURL}?w=300 300w,
       ${provider.PhotoURL}?w=600 600w
     `}
     sizes="(max-width: 768px) 150px, 300px"
   />
   ```

### Phase 6: Testing & Rollback Plan (2-4 hours)

**Goal**: Ensure everything works, prepare rollback

1. **Testing Checklist**
   - [ ] All provider photos load correctly
   - [ ] All clinic photos load correctly
   - [ ] Images load fast globally (use tools.pingdom.com)
   - [ ] Mobile images optimized
   - [ ] No broken images
   - [ ] Browser caching works
   - [ ] CDN costs within budget

2. **Rollback Plan**
   ```sql
   -- If needed, revert URLs back to local serving
   UPDATE Providers
   SET PhotoURL = REPLACE(
     PhotoURL,
     'https://cdn.glowra.com/providers/',
     '/api/provider-photos/'
   )
   WHERE PhotoURL LIKE 'https://cdn.glowra.com/providers/%';
   ```

3. **Keep Local Files**
   - Don't delete local photos for 30 days
   - Keep as backup
   - Remove after confirming CDN works

---

## 💰 Cost Analysis

### Current Costs (Static File Serving)

| Item | Cost | Notes |
|------|------|-------|
| **Storage** | $0 | Included in server cost |
| **Bandwidth** | ~$10/month | Part of server bandwidth |
| **Server Resources** | ~$5/month | CPU/memory for serving files |
| **Total** | **~$15/month** | Very low, but doesn't scale |

### CDN Costs (Projected at Scale)

#### Option 1: Cloudflare R2 + CDN (Recommended)

| Item | Cost | Notes |
|------|------|-------|
| **Storage** | $0.015/GB/month | ~$0.15 for 10GB |
| **Bandwidth** | $0 | No egress fees! |
| **Operations** | Minimal | ~$0.05/month |
| **Total** | **~$1-2/month** | 🏆 Best value |

#### Option 2: AWS S3 + CloudFront

| Item | Cost | Notes |
|------|------|-------|
| **S3 Storage** | $0.023/GB/month | ~$0.23 for 10GB |
| **S3 Transfer to CloudFront** | $0 | Free |
| **CloudFront Bandwidth** | $0.085/GB | ~$8.50 for 100GB |
| **Total** | **~$10-20/month** | Enterprise-grade |

#### Option 3: DigitalOcean Spaces + CDN

| Item | Cost | Notes |
|------|------|-------|
| **Storage** | $5/month | Includes 250GB storage + 1TB bandwidth |
| **Overage** | $0.01/GB | After 1TB |
| **Total** | **$5/month** | Simple pricing |

### Cost at Scale (1000 Clinics)

Assuming:
- 4000 providers @ 1 photo each = 4000 photos
- 1000 clinics @ 10 photos each = 10,000 photos
- Total: ~14,000 photos @ 200KB average = ~2.8GB
- Monthly traffic: 100K visitors × 10 photos each = 1M photo loads × 200KB = 200GB bandwidth

| Provider | Storage | Bandwidth | Total |
|----------|---------|-----------|-------|
| **Cloudflare R2** | $0.04 | $0 | **$0.50/month** 🏆 |
| **AWS S3+CloudFront** | $0.06 | $17 | **$17/month** |
| **DigitalOcean Spaces** | $5 | $0 | **$5/month** |

**Recommendation**: Start with **Cloudflare R2** - lowest cost, zero egress fees, excellent performance.

---

## 🔧 Implementation Scripts

### Upload Script Template

```javascript
// scripts/uploadPhotosToS3.js
const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');
const { db } = require('../db');

// Configure AWS (or Cloudflare R2)
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT, // For R2: https://<account>.r2.cloudflarestorage.com
  region: 'auto',
});

async function uploadPhotos() {
  console.log('🚀 Starting photo upload to CDN...\n');
  
  const photosDir = path.join(__dirname, '../photos/Provider Pictures');
  const folders = await fs.readdir(photosDir);
  
  let uploaded = 0;
  let failed = 0;
  
  for (const folder of folders) {
    const folderPath = path.join(photosDir, folder);
    const files = await fs.readdir(folderPath);
    
    for (const file of files) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(file)) continue;
      
      try {
        const filePath = path.join(folderPath, file);
        const fileContent = await fs.readFile(filePath);
        
        // S3 key format: providers/[clinicName]/[providerName].png
        const s3Key = `providers/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
        
        await s3.putObject({
          Bucket: 'glowra-photos',
          Key: s3Key,
          Body: fileContent,
          ContentType: `image/${path.extname(file).slice(1)}`,
          CacheControl: 'max-age=2592000', // 30 days
        }).promise();
        
        console.log(`✅ Uploaded: ${folder}/${file}`);
        uploaded++;
      } catch (error) {
        console.error(`❌ Failed: ${folder}/${file}`, error.message);
        failed++;
      }
    }
  }
  
  console.log(`\n📊 Upload Complete`);
  console.log(`✅ Uploaded: ${uploaded}`);
  console.log(`❌ Failed: ${failed}`);
}

uploadPhotos().catch(console.error);
```

### URL Migration Script

```javascript
// scripts/migratePhotoUrlsToCDN.js
const { sql, db } = require('../db');

const CDN_BASE_URL = 'https://cdn.glowra.com'; // or your CDN domain

async function migrateUrls() {
  console.log('🔄 Migrating photo URLs to CDN...\n');
  
  const pool = await db.getConnection();
  
  try {
    // Migrate provider photos
    const providerResult = await pool.request().query(`
      UPDATE Providers
      SET PhotoURL = REPLACE(
        PhotoURL,
        '/api/provider-photos/',
        '${CDN_BASE_URL}/providers/'
      )
      WHERE PhotoURL LIKE '/api/provider-photos/%'
    `);
    
    console.log(`✅ Updated ${providerResult.rowsAffected[0]} provider photos`);
    
    // Migrate clinic photos (if you have ClinicPhotos table)
    const clinicResult = await pool.request().query(`
      UPDATE ClinicPhotos
      SET PhotoURL = REPLACE(
        PhotoURL,
        '/api/clinic-photos/',
        '${CDN_BASE_URL}/clinics/'
      )
      WHERE PhotoURL LIKE '/api/clinic-photos/%'
    `);
    
    console.log(`✅ Updated ${clinicResult.rowsAffected[0]} clinic photos`);
    
    console.log('\n🎉 Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

migrateUrls().catch(console.error);
```

---

## 📈 Expected Benefits

### Performance

- ✅ **10x faster global delivery** (50-500ms → 10-50ms)
- ✅ **99.99% uptime** vs 99.9%
- ✅ **Automatic image optimization** (WebP, resizing)
- ✅ **DDoS protection** included

### Scalability

- ✅ **Unlimited storage** (pay as you grow)
- ✅ **Unlimited bandwidth** (with R2)
- ✅ **Zero server load** (100% offloaded)
- ✅ **Auto-scaling** (no configuration needed)

### Cost

- ✅ **Lower costs at scale** ($0.50-5/month for 1000 clinics)
- ✅ **No server bandwidth** costs
- ✅ **Predictable pricing**

### Developer Experience

- ✅ **Simple uploads** (S3 SDK)
- ✅ **Automatic backups**
- ✅ **Easy to manage**
- ✅ **Better monitoring**

---

## 🎯 Summary

### Current State (Good for Now)
- ✅ Static file serving works great for <500 clinics
- ✅ Low complexity, easy to maintain
- ✅ ~$15/month total cost
- ✅ Fast enough for US users

### When to Migrate
- 🎯 **Scale**: 500+ clinics or 2000+ providers
- 🎯 **Performance**: Load times >100ms
- 🎯 **Geography**: International users >20%
- 🎯 **Business**: Series A or enterprise clients

### Migration Effort
- ⏱️ **Time**: 1-2 days total
- 💰 **Cost**: $1-20/month (depending on provider)
- 🔧 **Complexity**: Low (mostly automated)
- ⚠️ **Risk**: Very low (easy rollback)

### Recommended Timeline
1. **Now - 500 clinics**: Keep current setup
2. **500-1000 clinics**: Plan migration, choose CDN
3. **1000+ clinics**: Execute migration
4. **Post-migration**: Monitor and optimize

---

**Current Status**: ✅ No action needed until 500 clinics  
**Next Review**: When reaching 400 clinics or 6 months

---

## 📚 Additional Resources

- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Image Optimization Best Practices](https://web.dev/fast/#optimize-your-images)
- [CDN Performance Testing](https://tools.pingdom.com/)

---

**Questions?** This plan is ready to execute when needed. All scripts and architecture are documented above.

