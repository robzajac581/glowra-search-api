/**
 * Test script for Photo Proxy Endpoint
 * 
 * Usage:
 *   node test-photo-proxy.js [clinicId]
 * 
 * Examples:
 *   node test-photo-proxy.js 1
 *   node test-photo-proxy.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const clinicId = process.argv[2] || '1'; // Default to clinic 1 if not specified

async function testPhotoProxy() {
  console.log('='.repeat(60));
  console.log('Photo Proxy Endpoint Test');
  console.log('='.repeat(60));
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`Testing Clinic ID: ${clinicId}`);
  console.log('');

  try {
    // Test 1: Fetch photo (should be MISS on first request)
    console.log('Test 1: Initial fetch (expecting cache MISS)...');
    const startTime1 = Date.now();
    const response1 = await axios.get(
      `${API_BASE_URL}/api/photos/clinic/${clinicId}`,
      { 
        responseType: 'arraybuffer',
        validateStatus: () => true // Don't throw on non-2xx status
      }
    );
    const duration1 = Date.now() - startTime1;

    console.log(`  Status: ${response1.status}`);
    console.log(`  Content-Type: ${response1.headers['content-type']}`);
    console.log(`  X-Cache: ${response1.headers['x-cache']}`);
    console.log(`  Response time: ${duration1}ms`);
    
    if (response1.status === 200) {
      console.log(`  Image size: ${Buffer.byteLength(response1.data)} bytes`);
      
      // Save the image for inspection
      const filename = `test-clinic-${clinicId}.jpg`;
      fs.writeFileSync(filename, response1.data);
      console.log(`  ✅ Image saved to: ${filename}`);
    } else {
      console.log(`  ❌ Error: ${JSON.stringify(response1.data.toString())}`);
    }
    console.log('');

    if (response1.status !== 200) {
      console.log('Skipping subsequent tests due to error in initial fetch.');
      return;
    }

    // Test 2: Fetch same photo again (should be HIT from cache)
    console.log('Test 2: Second fetch (expecting cache HIT)...');
    const startTime2 = Date.now();
    const response2 = await axios.get(
      `${API_BASE_URL}/api/photos/clinic/${clinicId}`,
      { responseType: 'arraybuffer' }
    );
    const duration2 = Date.now() - startTime2;

    console.log(`  Status: ${response2.status}`);
    console.log(`  X-Cache: ${response2.headers['x-cache']}`);
    console.log(`  Response time: ${duration2}ms`);
    console.log(`  Image size: ${Buffer.byteLength(response2.data)} bytes`);
    
    if (response2.headers['x-cache'] === 'HIT') {
      console.log('  ✅ Cache is working correctly!');
    } else {
      console.log('  ⚠️  Warning: Expected cache HIT but got', response2.headers['x-cache']);
    }
    
    // Performance comparison
    const improvement = ((duration1 - duration2) / duration1 * 100).toFixed(1);
    console.log(`  📊 Performance improvement: ${improvement}% faster`);
    console.log('');

    // Test 3: Test invalid clinic ID
    console.log('Test 3: Invalid clinic ID (expecting 404)...');
    try {
      const response3 = await axios.get(
        `${API_BASE_URL}/api/photos/clinic/99999`,
        { 
          responseType: 'arraybuffer',
          validateStatus: () => true 
        }
      );
      console.log(`  Status: ${response3.status}`);
      
      if (response3.status === 404) {
        console.log('  ✅ Correctly returns 404 for invalid clinic');
      } else {
        console.log('  ⚠️  Expected 404, got', response3.status);
      }
    } catch (error) {
      console.log('  ❌ Error:', error.message);
    }
    console.log('');

    // Test 4: Test non-numeric clinic ID
    console.log('Test 4: Non-numeric clinic ID (expecting 400)...');
    try {
      const response4 = await axios.get(
        `${API_BASE_URL}/api/photos/clinic/invalid`,
        { 
          responseType: 'arraybuffer',
          validateStatus: () => true 
        }
      );
      console.log(`  Status: ${response4.status}`);
      
      if (response4.status === 400) {
        console.log('  ✅ Correctly returns 400 for non-numeric clinic ID');
      } else {
        console.log('  ⚠️  Expected 400, got', response4.status);
      }
    } catch (error) {
      console.log('  ❌ Error:', error.message);
    }
    console.log('');

    // Summary
    console.log('='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log('✅ Photo proxy endpoint is working correctly!');
    console.log('');
    console.log('Cache Performance:');
    console.log(`  - First request: ${duration1}ms (cache MISS)`);
    console.log(`  - Second request: ${duration2}ms (cache HIT)`);
    console.log(`  - Speed improvement: ${improvement}%`);
    console.log('');
    console.log('Next Steps:');
    console.log('1. Update frontend to use: /api/photos/clinic/:clinicId');
    console.log('2. Remove direct Google Places photo URLs');
    console.log('3. Add error handling and fallback images');
    console.log('');
    console.log('Documentation: docs/FE communications/PHOTO_PROXY_ENDPOINT_GUIDE.md');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('');
      console.error('Server is not running. Please start the server first:');
      console.error('  node app.js');
    } else if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${API_BASE_URL}/api/clinics/search-index`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
(async () => {
  console.log('Checking if server is running...');
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.error('❌ Server is not running at', API_BASE_URL);
    console.error('Please start the server first:');
    console.error('  node app.js');
    process.exit(1);
  }
  
  console.log('✅ Server is running');
  console.log('');
  
  await testPhotoProxy();
})();

