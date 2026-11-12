# Google Places costs: how they work and how they're controlled

Read this before adding, changing, or running anything that calls Google Places
(jobs, scripts, admin endpoints, the photo proxy, ingestion). Google is the only
part of Glowra that bills per request, and it has cost real money by surprise.

Last verified: 2026-11-12.

## Accounts and where to look

| What | Value |
|---|---|
| Google account that owns billing | **rob.glowra@gmail.com**. NOT rzajac581@gmail.com, which only sees personal projects. |
| Cloud project | `serious-hall-474015-p6` (named "My First Project"; project number 511828631489) |
| Billing account | `0115AC-53B429-05C3AC` ("My Billing Account") |
| API in use | Legacy **Places API**: `places-backend.googleapis.com` (`maps.googleapis.com/maps/api/place/...`). "Places API (New)" is enabled but unused. |
| Real invoice | Console → Billing → Reports / Cost table, signed in as rob.glowra (`?authuser=` the right index) |
| CLI | `gcloud`, signed in as rob.glowra@gmail.com, default project set. Re-auth with `gcloud auth login`. |

## What actually costs money

From the **October 2026 invoice ($253.41, incl. $33.05 tax)**:

| SKU | Calls | Cost | Source in code |
|---|---|---|---|
| Places Details | 14,060 | $154.02 | rating refresh + weekly photo refresh |
| Atmosphere Data | 13,362 | $61.81 | `rating,user_ratings_total` fields on the rating refresh |
| Places Photo | 1,480 | $3.36 | photo proxy cache misses |
| Contact Data | 1,391 | $1.17 | old field set, since trimmed |

Prices and **monthly free allowances**, derived exactly from that invoice:

| SKU | Price | Free per month |
|---|---|---|
| Details | $0.017/call | 5,000 |
| Atmosphere | $0.005/call | 1,000 |
| Photo | $0.007/call | 1,000 |

**The October cost was the rating refresh running daily for every clinic**
(~443 Details+Atmosphere calls a night). Photos were negligible. Assumptions
made before 2026-11-12 that photos were the main cost were wrong.

## Controls in place

| Layer | Control | Where |
|---|---|---|
| Code | Rating refresh is **monthly per clinic**: a clinic is refreshed only once `LastRatingUpdate` is >30 days old, stalest first, **max 50 per night** (`RATING_REFRESH_MAX_PER_RUN`). No rating refresh at startup. | `jobs/scheduledRefresh.js` |
| Code | Photo proxy stops calling Google after **500 fetches per rolling 24h** (`GOOGLE_PHOTO_FETCH_LIMIT`), serving stale cache or a 503 placeholder. The count is persisted hourly in `dbo.GooglePhotoFetchBuckets`, so deploys don't reset it. | `utils/googlePhotoBudget.js`, `utils/googlePhotoBudgetStore.js` |
| Google | **Daily quota: 1,200 requests/day** on legacy Places (`billable_default`, `1/d/{project}`). Was unlimited. Over it, Google returns errors and the site degrades. | Consumer quota override on the project |
| Google | **Budget alert $60/month**, emailing billing admins at 50/90/100/150% ($30/$54/$60/$90). | Billing → Budgets & caps |
| Ops | **Weekly report** every Monday ~9am: call counts, month-to-date cost estimate, flags. Read-only. | `scripts/googleSpendReport.py`; scheduled task `glowra-google-spend-weekly` on Rob's Mac |

**Hard monthly dollar caps are not available for Places API.** Google's
"spend cap enforcement" only supports Cloud Run, Cloud Run Functions, Gemini API
and Vertex AI. The daily quota is the hard stop.

## Expected steady state (after 2026-11-12)

- ~15 Details calls a night (ratings), plus the 7 clinics Google has no rating
  for, which retry nightly (~$0.15/day).
- ~450 Details calls on Sunday nights (weekly photo refresh, `refreshAllClinicPhotos`).
- Up to 500 photo fetches a day, usually far fewer.
- Roughly **$10–40/month**.

## Known risks and traps

- **`POST /api/admin/refresh-ratings` and `POST /api/admin/refresh-photos`**
  require the `X-API-Key` header (`CLINIC_MANAGEMENT_API_KEY`) since 2026-11-12
  (GLO-93; before that they were anonymous). Without a `clinicId`,
  refresh-ratings refreshes every clinic: ~$8–10 of Google calls per request.
- **Starting the API locally against prod without `DISABLE_SCHEDULED_JOBS=true`**
  runs the startup photo-overdue check, which can trigger a full photo refresh.
  The root `.claude/launch.json` `search-api` entry sets the flag.
- **New scripts or jobs that loop over all clinics** cost ~$0.022 per clinic per
  pass (Details + Atmosphere). Estimate before running; Rob's rule is approval
  before any spend over $50.
- **Lowering a quota** through the Service Usage API needs `?force=true`; Google
  rejects reductions over 10% by default.
- `/api/clinics/:id` still emits a blank-key Google URL in its `photo` field
  (no key leaked; the URL just doesn't load).

## How to check spend

```bash
python3 -I scripts/googleSpendReport.py 7
```

Exact daily call counts come from Cloud Monitoring
(`serviceruntime.googleapis.com/api/request_count`, grouped by method). The
month-to-date estimate applies the free allowances and matched the console
within $0.02 on 2026-11-12. The upper bound assumes every Details call also
billed Atmosphere.

Live photo-budget usage: `GET https://glowra-search-api.onrender.com/api/health/photo-status`
→ `googlePhotoBudget`.

## How to change a control

- **Rating cadence**: `RATING_REFRESH_INTERVAL_DAYS` / `RATING_REFRESH_MAX_PER_RUN` in `jobs/scheduledRefresh.js` (the latter is also an env var).
- **Photo budget**: `GOOGLE_PHOTO_FETCH_LIMIT` / `GOOGLE_PHOTO_FETCH_WINDOW_HOURS` env vars on Render.
- **Daily quota**: Console → APIs & Services → Places API → Quotas, or the
  Service Usage API (`consumerQuotaMetrics/places-backend.googleapis.com%2Fbillable_default/limits/%2Fd%2Fproject/consumerOverrides`).
- **Budget**: Console → Billing → Budgets & caps → "$60 Monthly Budget Alert".

## History

- 2026-10-07: API key leak via stored photo URLs; key rotated (GLO-88).
- 2026-11-12: real invoice read for the first time. Daily rating refresh found
  to be ~85% of cost and moved to monthly per clinic. Photo budget breaker
  shipped (GLO-76). 1,200/day quota and $60 alert set. Weekly report scheduled.
