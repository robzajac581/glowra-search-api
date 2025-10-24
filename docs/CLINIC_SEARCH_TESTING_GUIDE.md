# Clinic Search API Testing Guide

Quick reference for testing the new clinic-based search endpoint.

---

## Quick Test Commands

### 1. Test New Endpoint
```bash
# Basic test - get all clinics
curl http://localhost:3001/api/clinics/search-index

# Pretty print with jq
curl http://localhost:3001/api/clinics/search-index | jq '.'

# Count total clinics
curl -s http://localhost:3001/api/clinics/search-index | jq '.meta.totalClinics'

# View first clinic
curl -s http://localhost:3001/api/clinics/search-index | jq '.clinics[0]'

# Count procedures for first clinic
curl -s http://localhost:3001/api/clinics/search-index | jq '.clinics[0].procedures | length'
```

### 2. Measure Performance
```bash
# Response time
time curl -s http://localhost:3001/api/clinics/search-index > /dev/null

# Response size
curl -w "Size: %{size_download} bytes\nTime: %{time_total}s\n" \
  -o /dev/null -s \
  http://localhost:3001/api/clinics/search-index
```

### 3. Validate Data Structure
```bash
# Check required fields exist
curl -s http://localhost:3001/api/clinics/search-index | \
  jq '.clinics[0] | keys'

# Expected output:
# [
#   "address",
#   "city",
#   "clinicCategory",
#   "clinicId",
#   "clinicName",
#   "procedures",
#   "rating",
#   "reviewCount",
#   "state"
# ]

# Check procedure fields
curl -s http://localhost:3001/api/clinics/search-index | \
  jq '.clinics[0].procedures[0] | keys'

# Expected output:
# [
#   "category",
#   "price",
#   "procedureId",
#   "procedureName"
# ]
```

### 4. Verify Data Quality
```bash
# Find clinics with most procedures
curl -s http://localhost:3001/api/clinics/search-index | \
  jq '.clinics | map({name: .clinicName, count: (.procedures | length)}) | sort_by(.count) | reverse | .[0:5]'

# Find clinics with highest ratings
curl -s http://localhost:3001/api/clinics/search-index | \
  jq '.clinics | map({name: .clinicName, rating: .rating, reviews: .reviewCount}) | sort_by(.rating) | reverse | .[0:5]'

# Check for duplicate procedures in a clinic
curl -s http://localhost:3001/api/clinics/search-index | \
  jq '.clinics[0].procedures | group_by(.procedureId) | map(select(length > 1))'

# Should return: [] (empty array - no duplicates)
```

---

## Node.js Testing Script

Save as `test-clinic-search.js`:

```javascript
const fetch = require('node-fetch');

async function testClinicSearchAPI() {
  console.log('🧪 Testing /api/clinics/search-index endpoint\n');

  try {
    // Test 1: Fetch data
    console.log('1. Fetching data...');
    const startTime = Date.now();
    const response = await fetch('http://localhost:3001/api/clinics/search-index');
    const data = await response.json();
    const fetchTime = Date.now() - startTime;
    
    console.log(`✅ Fetch successful (${fetchTime}ms)`);
    console.log(`   Total clinics: ${data.meta.totalClinics}`);
    console.log(`   Timestamp: ${data.meta.timestamp}\n`);

    // Test 2: Validate structure
    console.log('2. Validating data structure...');
    const clinic = data.clinics[0];
    
    const requiredFields = ['clinicId', 'clinicName', 'procedures', 'rating', 'reviewCount'];
    const hasAllFields = requiredFields.every(field => field in clinic);
    
    if (hasAllFields) {
      console.log('✅ All required fields present');
    } else {
      console.log('❌ Missing required fields');
      return;
    }

    // Test 3: Procedure structure
    console.log('\n3. Validating procedure structure...');
    const procedure = clinic.procedures[0];
    const procFields = ['procedureId', 'procedureName', 'price', 'category'];
    const hasProcFields = procFields.every(field => field in procedure);
    
    if (hasProcFields) {
      console.log('✅ Procedure structure valid');
    } else {
      console.log('❌ Invalid procedure structure');
      return;
    }

    // Test 4: Check for duplicates
    console.log('\n4. Checking for duplicate procedures...');
    let hasDuplicates = false;
    
    for (const clinic of data.clinics) {
      const procIds = clinic.procedures.map(p => p.procedureId);
      const uniqueIds = new Set(procIds);
      
      if (procIds.length !== uniqueIds.size) {
        console.log(`❌ Duplicate procedures found in clinic: ${clinic.clinicName}`);
        hasDuplicates = true;
      }
    }
    
    if (!hasDuplicates) {
      console.log('✅ No duplicate procedures found');
    }

    // Test 5: Statistics
    console.log('\n5. Data statistics:');
    const totalProcedures = data.clinics.reduce((sum, c) => sum + c.procedures.length, 0);
    const avgProcedures = (totalProcedures / data.clinics.length).toFixed(1);
    const avgRating = (data.clinics.reduce((sum, c) => sum + c.rating, 0) / data.clinics.length).toFixed(2);
    
    console.log(`   Total procedures: ${totalProcedures}`);
    console.log(`   Avg procedures per clinic: ${avgProcedures}`);
    console.log(`   Avg rating: ${avgRating}⭐`);
    
    // Test 6: Category distribution
    console.log('\n6. Procedure category distribution:');
    const categories = {};
    data.clinics.forEach(clinic => {
      clinic.procedures.forEach(proc => {
        categories[proc.category] = (categories[proc.category] || 0) + 1;
      });
    });
    
    Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        console.log(`   ${cat}: ${count}`);
      });

    // Test 7: Top clinics
    console.log('\n7. Top 5 clinics by rating:');
    data.clinics
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5)
      .forEach((clinic, i) => {
        console.log(`   ${i + 1}. ${clinic.clinicName} - ${clinic.rating}⭐ (${clinic.reviewCount} reviews)`);
      });

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run tests
testClinicSearchAPI();
```

Run with:
```bash
node test-clinic-search.js
```

---

## Browser Console Testing

Open browser console and paste:

```javascript
// Test 1: Basic fetch
async function testAPI() {
  const start = performance.now();
  const response = await fetch('http://localhost:3001/api/clinics/search-index');
  const data = await response.json();
  const time = performance.now() - start;
  
  console.log('📊 API Test Results:');
  console.log(`⏱️  Response time: ${time.toFixed(0)}ms`);
  console.log(`🏥 Total clinics: ${data.meta.totalClinics}`);
  console.log(`💉 Total procedures: ${data.clinics.reduce((s, c) => s + c.procedures.length, 0)}`);
  console.log(`⭐ Avg rating: ${(data.clinics.reduce((s, c) => s + c.rating, 0) / data.clinics.length).toFixed(2)}`);
  
  return data;
}

const data = await testAPI();
console.log('First clinic:', data.clinics[0]);
```

---

## Expected Results

### Response Time
- **Good:** < 1 second
- **Acceptable:** 1-2 seconds
- **Needs optimization:** > 2 seconds

### Response Size
- **Expected:** 500KB - 2MB
- **Acceptable:** < 5MB
- **Needs optimization:** > 5MB

### Data Quality
- No duplicate procedures per clinic
- No "Please Request Consult" providers
- All clinics have at least 1 procedure
- Ratings between 0-5
- All required fields present

### Structure Validation
```javascript
// All clinics should have this structure
{
  clinicId: number (positive integer),
  clinicName: string (non-empty),
  address: string (may be empty),
  city: string (may be empty),
  state: string (may be empty),
  rating: number (0-5),
  reviewCount: number (>= 0),
  clinicCategory: string (non-empty),
  photoURL: string | null (Google Places photo URL),
  procedures: array (length >= 1)
}

// All procedures should have this structure
{
  procedureId: number (positive integer),
  procedureName: string (non-empty),
  price: number (>= 0),
  category: string (non-empty)
}
```

---

## Troubleshooting

### Empty Response
```bash
# Check if server is running
curl http://localhost:3001/

# Check database connection
# Look at server logs for connection errors
```

### Wrong Port
```bash
# Check .env file for PORT setting
grep PORT .env

# Try different port
curl http://localhost:3000/api/clinics/search-index
```

### SQL Errors
Check server console for errors:
- Table not found → Run migrations
- Column not found → Schema mismatch
- Join errors → Check table relationships

### Slow Response
- Check database indexes exist
- Verify database connection pool settings
- Monitor SQL query execution time

---

## Success Checklist

- [ ] Endpoint returns 200 OK
- [ ] Response time < 2 seconds
- [ ] Response structure matches schema
- [ ] All required fields present
- [ ] No duplicate procedures per clinic
- [ ] Procedures array not empty for all clinics
- [ ] Rating values between 0-5
- [ ] Price values >= 0
- [ ] Metadata includes totalClinics and timestamp
- [ ] No SQL errors in server logs
- [ ] No linting errors in code

---

## Next Steps

Once all tests pass:
1. ✅ Backend implementation verified
2. → Frontend team can begin integration
3. → Update frontend API calls
4. → Test with real search queries
5. → Deploy to staging environment
6. → QA testing
7. → Production deployment

---

**Created:** October 23, 2025  
**For:** Backend and QA testing  
**Status:** Ready for testing

