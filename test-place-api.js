// Quick test script to check if API can fetch ANY place data
require('dotenv').config();
const axios = require('axios');

async function testPlaceAPI() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  
  console.log('=== Testing Google Places API ===\n');
  
  // Test with places that definitely have ratings
  const testPlaces = [
    {
      name: 'Apple Store (Fifth Avenue NYC)',
      placeId: 'ChIJNy4vLC1ZwokRpoTkanbb_EQ'
    },
    {
      name: 'Central Park NYC',
      placeId: 'ChIJ4zGFAZpYwokRGUGph3Mf37k'
    },
    {
      name: 'Your Clinic',
      placeId: 'ChIJ1-7oglRMW4YR8kqLJMhdPW4'  // Your actual clinic
    }
  ];
  
  for (const place of testPlaces) {
    console.log(`\n--- Testing: ${place.name} ---`);
    console.log(`Place ID: ${place.placeId}`);
    
    try {
      // Test with minimal fields first
      const minimalResponse = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
        params: {
          place_id: place.placeId,
          fields: 'name,rating',  // Minimal fields
          key: apiKey
        }
      });
      
      console.log('\n📊 Minimal Fields Test (name,rating):');
      console.log('Status:', minimalResponse.data.status);
      console.log('Result:', JSON.stringify(minimalResponse.data.result, null, 2));
      
      // Test with full fields
      const fullResponse = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
        params: {
          place_id: place.placeId,
          fields: 'rating,user_ratings_total,reviews,opening_hours,business_status',
          key: apiKey
        }
      });
      
      console.log('\n📊 Full Fields Test:');
      console.log('Status:', fullResponse.data.status);
      console.log('Result:', JSON.stringify(fullResponse.data.result, null, 2));
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      if (error.response) {
        console.error('Response:', error.response.data);
      }
    }
  }
  
  console.log('\n=== Test Complete ===');
}

testPlaceAPI();

