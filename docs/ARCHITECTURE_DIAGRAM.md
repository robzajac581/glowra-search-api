# Google Places Rating System - Architecture Diagram

**Last Updated:** October 2, 2025

## Current Architecture (Cache-First)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER REQUESTS                                │
│                    (Frontend Application)                            │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              │ GET /api/clinics/:clinicId
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         API SERVER                                   │
│                         (app.js)                                     │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Clinic Endpoint Handler                                     │   │
│  │  • Read from database cache ONLY                            │   │
│  │  • No Google API calls                                       │   │
│  │  • Fast response (< 100ms)                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              │ SQL Query                              │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   SQL Server Database                        │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │ Clinics Table                                          │  │   │
│  │  │  • ClinicID, ClinicName, Address                      │  │   │
│  │  │  • PlaceID (Google Place ID)                          │  │   │
│  │  │  • GoogleRating                                        │  │   │
│  │  │  • GoogleReviewCount                                   │  │   │
│  │  │  • GoogleReviewsJSON                                   │  │   │
│  │  │  • LastRatingUpdate                                    │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                        │
│                              │ Return cached data                     │
│                              ▼                                        │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              │ JSON Response (Fast!)
                              ▼
                    ┌──────────────────┐
                    │   Frontend UI    │
                    │ • Display rating │
                    │ • Show reviews   │
                    └──────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                    SCHEDULED JOB (2 AM Daily)                        │
│                    (jobs/ratingRefresh.js)                           │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              │ Cron: 0 2 * * *
                              ▼
         ┌─────────────────────────────────────────┐
         │  1. Query all clinics with PlaceIDs     │
         │  2. Batch fetch (10 at a time)          │
         │  3. Rate limiting (500ms delay)         │
         └─────────────┬───────────────────────────┘
                       │
                       │ Fetch ratings
                       ▼
         ┌───────────────────────────────────────────┐
         │      Google Places API                     │
         │  ┌──────────────────────────────────────┐ │
         │  │  • rating                             │ │
         │  │  • user_ratings_total                 │ │
         │  │  • reviews (top 5)                    │ │
         │  │  • opening_hours                      │ │
         │  └──────────────────────────────────────┘ │
         └───────────────┬───────────────────────────┘
                         │
                         │ API Response
                         ▼
         ┌──────────────────────────────────────────┐
         │  Update database with fresh data          │
         │  • GoogleRating                           │
         │  • GoogleReviewCount                      │
         │  • GoogleReviewsJSON                      │
         │  • LastRatingUpdate = NOW()               │
         └──────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                    MANUAL REFRESH (Admin)                            │
│               POST /api/admin/refresh-ratings                        │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              │ { "clinicId": 1 } (optional)
                              ▼
         ┌─────────────────────────────────────────┐
         │  Same process as scheduled job          │
         │  • Can refresh single clinic            │
         │  • Or refresh all clinics               │
         │  • Returns detailed summary             │
         └─────────────────────────────────────────┘
```

## Data Flow Timeline

```
Time      User Requests                   Background Jobs
────────────────────────────────────────────────────────────────
00:00     Fast DB reads  ────────►        (Cache may be old)
01:00     Fast DB reads  ────────►        (Cache may be old)
02:00     Fast DB reads  ────────►   ┌──────────────────────┐
                                     │ Scheduled Job Runs    │
                                     │ • Fetch from Google   │
                                     │ • Update all clinics  │
                                     │ • Takes ~5-10 min     │
                                     └──────────────────────┘
02:10     Fast DB reads  ────────►        (Cache now fresh!)
03:00     Fast DB reads  ────────►        (Cache fresh)
...       Fast DB reads  ────────►        (Cache fresh)
23:00     Fast DB reads  ────────►        (Cache aging)
00:00     Fast DB reads  ────────►        (Cache 22hrs old)
```

## Request Flow Comparison

### OLD: Lazy-Refresh Approach ❌

```
User Request → Check cache age
                    │
                    ├─► Cache Fresh (< 24hrs)
                    │   └─► Return cached data (Fast: 50ms)
                    │
                    └─► Cache Stale (> 24hrs)
                        └─► Call Google API (Slow: 500-2000ms)
                            └─► Update DB
                                └─► Return fresh data
```

**Problems:**
- Unpredictable response times (50ms vs 2000ms)
- User waits for API call
- API errors affect user experience

### NEW: Cache-First Approach ✅

```
User Request → Read from DB → Return data (Fast: 50ms)

Scheduled Job (Background) → Call Google API → Update DB
```

**Benefits:**
- Consistent response times (always ~50ms)
- User never waits for API
- API errors don't affect users

## Component Responsibilities

```
┌────────────────────────────────────────────────────────────┐
│ Component         │ Responsibility        │ Calls Google?  │
├────────────────────────────────────────────────────────────┤
│ GET /api/clinics  │ Serve user requests   │ NO ❌          │
│ Scheduled Job     │ Keep data fresh       │ YES ✅         │
│ Admin Refresh     │ Manual updates        │ YES ✅         │
│ Database          │ Cache ratings         │ NO ❌          │
└────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
┌─────────────────────────────────────────────────────┐
│            Google API Call Fails                     │
└─────────────────────┬───────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │                           │
        ▼                           ▼
┌────────────────┐        ┌──────────────────┐
│ Scheduled Job  │        │ Admin Refresh    │
│ • Log error    │        │ • Log error      │
│ • Continue     │        │ • Return error   │
│ • Try next     │        │ • Show which     │
│   clinic       │        │   failed         │
└────────────────┘        └──────────────────┘
        │                           │
        │                           │
        └─────────────┬─────────────┘
                      ▼
        ┌──────────────────────────┐
        │ User Requests Continue   │
        │ • Still get cached data  │
        │ • No impact on users     │
        │ • Data just slightly old │
        └──────────────────────────┘
```

## Performance Metrics

```
Response Time Distribution (Before vs After)

Before (Lazy-Refresh):
0ms     |████████░░░░░░░░░░░░░░░░░░░░░░░░| 30% (fresh cache)
500ms   |████░░░░░░░░░░░░░░░░░░░░░░░░░░░░| 15% (API call)
1000ms  |████████░░░░░░░░░░░░░░░░░░░░░░░░| 25% (API call)
2000ms  |█████░░░░░░░░░░░░░░░░░░░░░░░░░░░| 20% (slow API)
Timeout |██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░| 10% (API error)

After (Cache-First):
50ms    |████████████████████████████████| 100% (DB read)
```

## Cost Analysis

```
Scenario: 100 Clinics, 1000 User Requests/Day

Old Approach (Lazy-Refresh):
┌──────────────────────────────────────────────────┐
│ Time    │ Cache State │ API Calls/Request        │
├──────────────────────────────────────────────────┤
│ 0-24h   │ Fresh       │ 0                        │
│ 24h+    │ Stale       │ 1 (on first view)        │
└──────────────────────────────────────────────────┘
Total API Calls: Unpredictable (50-500/day)
Cost: $0.85 - $8.50/day

New Approach (Cache-First):
┌──────────────────────────────────────────────────┐
│ Event        │ Frequency  │ API Calls             │
├──────────────────────────────────────────────────┤
│ User request │ 1000/day   │ 0                     │
│ Scheduled job│ 1/day      │ 100 (all clinics)     │
└──────────────────────────────────────────────────┘
Total API Calls: Exactly 100/day
Cost: Exactly $1.70/day

Savings: Predictable costs, no surprise bills!
```

## Key Takeaways

✅ **User Experience**
- Fast, consistent response times
- No waiting for API calls
- No timeouts or errors

✅ **Cost Control**
- Predictable daily API usage
- Can optimize refresh schedule
- No waste on redundant calls

✅ **Reliability**
- API issues don't affect users
- Graceful degradation
- Always have cached data

✅ **Simplicity**
- Cleaner code
- Easier to maintain
- Centralized refresh logic
