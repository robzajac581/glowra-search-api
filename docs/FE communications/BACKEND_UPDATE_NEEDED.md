# Backend Update Required for Google Places Data

## Issue
The frontend is ready to display Google Places data, but the backend API `/api/clinics/:id` endpoint is not returning the data from the `GooglePlacesData` table.

## Current Backend Response
Only returns fields from `Clinics` table:
```javascript
{
  ClinicID, ClinicName, Address, Website, LocationID, PlaceID, 
  rating, reviewCount, reviews, isOpen, lastRatingUpdate
}
```

## Required Backend Response
Needs to include fields from `GooglePlacesData` table via LEFT JOIN:

```javascript
{
  // From Clinics table
  ClinicID,
  ClinicName,
  Address,
  Phone,
  Website,
  Latitude,
  Longitude,
  PlaceID,
  GoogleRating,        // ← Add this (from Clinics table)
  GoogleReviewCount,   // ← Add this (from Clinics table)
  
  // From GooglePlacesData table (LEFT JOIN)
  Photo,               // ← Add this
  Logo,                // ← Add this
  StreetView,          // ← Add this
  Description,         // ← Add this
  WorkingHours,        // ← Add this (JSON string)
  AboutJSON,           // ← Add this (JSON string)
  Verified,            // ← Add this (boolean/bit)
  Facebook,            // ← Add this
  Instagram,           // ← Add this
  LinkedIn,            // ← Add this
  Twitter,             // ← Add this
  YouTube,             // ← Add this
  GoogleProfileLink,   // ← Add this
  ReviewsLink,         // ← Add this
  BookingAppointmentLink, // ← Add this
  BusinessStatus,      // ← Add this
  // ... any other GooglePlacesData fields
}
```

## Backend SQL Query Update

**Current query** (approximate):
```sql
SELECT * FROM Clinics WHERE ClinicID = @id
```

**Updated query needed**:
```sql
SELECT 
  c.*,
  g.Photo,
  g.Logo,
  g.StreetView,
  g.Description,
  g.WorkingHours,
  g.AboutJSON,
  g.Verified,
  g.Facebook,
  g.Instagram,
  g.LinkedIn,
  g.Twitter,
  g.YouTube,
  g.GoogleProfileLink,
  g.ReviewsLink,
  g.BookingAppointmentLink,
  g.BusinessStatus,
  g.Category,
  g.Subtypes
FROM Clinics c
LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
WHERE c.ClinicID = @id
```

## Backend Code Example (Node.js/Express with SQL Server)

```javascript
app.get('/api/clinics/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = await db.getConnection();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT 
          c.ClinicID,
          c.ClinicName,
          c.Address,
          c.Phone,
          c.Website,
          c.Latitude,
          c.Longitude,
          c.PlaceID,
          c.GoogleRating,
          c.GoogleReviewCount,
          c.LocationID,
          c.LastRatingUpdate,
          
          -- Google Places Data fields
          g.Photo,
          g.Logo,
          g.StreetView,
          g.Description,
          g.WorkingHours,
          g.AboutJSON,
          g.Verified,
          g.Facebook,
          g.Instagram,
          g.LinkedIn,
          g.Twitter,
          g.YouTube,
          g.GoogleProfileLink,
          g.ReviewsLink,
          g.BookingAppointmentLink,
          g.BusinessStatus,
          g.Category,
          g.Subtypes,
          g.BusinessName,
          g.Email
        FROM Clinics c
        LEFT JOIN GooglePlacesData g ON c.ClinicID = g.ClinicID
        WHERE c.ClinicID = @id
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Clinic not found' });
    }
    
    const clinic = result.recordset[0];
    
    // Optional: Parse JSON fields server-side for easier frontend consumption
    // if (clinic.WorkingHours) {
    //   try {
    //     clinic.WorkingHours = JSON.parse(clinic.WorkingHours);
    //   } catch (e) {
    //     console.error('Error parsing WorkingHours:', e);
    //   }
    // }
    
    res.json(clinic);
  } catch (error) {
    console.error('Error fetching clinic:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

## Key Points

1. **Use LEFT JOIN** - Not all clinics have GooglePlacesData yet (110 out of 130 do)
2. **Keep JSON as strings** - The frontend hook will parse them (WorkingHours, AboutJSON)
3. **Test the endpoint** - After updating, visit: `http://localhost:3001/api/clinics/1` to verify
4. **Check your database** - Make sure GooglePlacesData table has data for this clinic

## Testing the Backend Update

After updating your backend, test with:
```bash
curl http://localhost:3001/api/clinics/1 | jq
```

You should see all the Google Places fields in the response.

## What Happens Next

Once the backend returns these fields:
1. Frontend will automatically display real photos in the gallery
2. Clinic banner will show real logo and Google ratings
3. Working hours will appear with open/closed status
4. About section will show real clinic description
5. All components will use real data!

---

**Action Required**: Update your backend API endpoint as shown above, then refresh the clinic page.

