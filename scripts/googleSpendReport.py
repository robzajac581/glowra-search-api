#!/usr/bin/env python3
"""
Weekly Google Places spend report for Glowra. Read-only.

Data sources:
  - Cloud Monitoring: exact daily Places API call counts by method
    (serviceruntime request_count on places-backend.googleapis.com)
  - Service Usage: the daily request quota currently in force
  - glowra-search-api /api/health/photo-status: the code-side photo budget

Cost is an ESTIMATE from call counts x list price. The real invoice lags
about a day and lives in the console: Billing -> Reports (rob.glowra@gmail.com).

Needs: gcloud signed in as rob.glowra@gmail.com.
Usage: python3 -I scripts/googleSpendReport.py [days=7]   (docs/GOOGLE_PLACES_COSTS.md)
"""

import datetime as dt
import json
import subprocess
import sys
import urllib.parse
import urllib.request

PROJECT = "serious-hall-474015-p6"
SERVICE = "places-backend.googleapis.com"
HEALTH_URL = "https://glowra-search-api.onrender.com/api/health/photo-status"
DAILY_QUOTA_LIMIT = (
    "projects/511828631489/services/places-backend.googleapis.com/consumerQuotaMetrics/"
    "places-backend.googleapis.com%2Fbillable_default/limits/%2Fd%2Fproject"
)

# Legacy Places list prices and monthly free allowances, derived exactly from
# the October 2026 invoice, e.g. Details (14,060 - 5,000) x $0.017 = $154.02.
DETAILS_PRICE, DETAILS_FREE = 0.017, 5000
ATMOSPHERE_PRICE, ATMOSPHERE_FREE = 0.005, 1000   # billed on rating-refresh Details calls
PHOTO_PRICE, PHOTO_FREE = 0.007, 1000

# Expected steady state after the 2026-11-12 fixes (rating refresh monthly,
# photo fetches capped at 500/day). Anything above these is worth flagging.
EXPECTED_DETAILS_PER_DAY = 60          # ~15 ratings + spikes; Sundays add ~450 photo refresh


def token():
    out = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("gcloud is not signed in. Run: gcloud auth login (pick rob.glowra@gmail.com)")
    return out.stdout.strip()


def get(url, tok, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"} if tok else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def daily_calls(tok, days):
    end = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - dt.timedelta(days=days)
    d = get(
        f"https://monitoring.googleapis.com/v3/projects/{PROJECT}/timeSeries",
        tok,
        {
            "filter": f'metric.type="serviceruntime.googleapis.com/api/request_count" '
                      f'AND resource.labels.service="{SERVICE}"',
            "interval.startTime": start.isoformat().replace("+00:00", "Z"),
            "interval.endTime": end.isoformat().replace("+00:00", "Z"),
            "aggregation.alignmentPeriod": "86400s",
            "aggregation.perSeriesAligner": "ALIGN_SUM",
            "aggregation.crossSeriesReducer": "REDUCE_SUM",
            "aggregation.groupByFields": "resource.labels.method",
        },
    )
    table = {}  # method -> {date: count}
    for ts in d.get("timeSeries", []):
        method = ts["resource"]["labels"].get("method", "unknown")
        for p in ts.get("points", []):
            day = p["interval"]["endTime"][:10]
            table.setdefault(method, {})[day] = int(p["value"].get("int64Value", 0))
    return table


def quota(tok):
    try:
        d = get(f"https://serviceusage.googleapis.com/v1beta1/{DAILY_QUOTA_LIMIT}", tok)
        b = (d.get("quotaBuckets") or [{}])[0]
        return b.get("effectiveLimit")
    except Exception as e:  # noqa: BLE001
        return f"unknown ({e})"


def photo_budget():
    try:
        return get(HEALTH_URL, None).get("googlePhotoBudget")
    except Exception as e:  # noqa: BLE001
        return f"unavailable ({e})"


def month_to_date_cost(tok):
    """Estimated cost this calendar month, after free allowances. Atmosphere is
    a range: the rating refresh bills it, the photo refresh does not, and the
    two cannot be told apart from call counts."""
    now = dt.datetime.now(dt.timezone.utc)
    days = now.day
    t = daily_calls(tok, days)
    month = now.strftime("%Y-%m")
    det = sum(n for d, n in t.get("google.places.Details.Http", {}).items() if d.startswith(month))
    pho = sum(n for d, n in t.get("google.places.GetPhoto.Http", {}).items() if d.startswith(month))
    base = max(0, det - DETAILS_FREE) * DETAILS_PRICE + max(0, pho - PHOTO_FREE) * PHOTO_PRICE
    atm_hi = max(0, det - ATMOSPHERE_FREE) * ATMOSPHERE_PRICE
    return det, pho, base, base + atm_hi


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    tok = token()
    table = daily_calls(tok, days)
    dates = sorted({d for m in table.values() for d in m})

    short = {"google.places.Details.Http": "Details", "google.places.GetPhoto.Http": "Photo"}
    methods = sorted(table)
    print(f"Glowra Google Places, last {days} days (project {PROJECT})\n")
    print("date        " + "  ".join(f"{short.get(m, m.split('.')[-2]):>8}" for m in methods))
    for d in dates:
        print(f"{d}  " + "  ".join(f"{table[m].get(d, 0):>8}" for m in methods))

    print("\nTotals:")
    for m in methods:
        print(f"  {short.get(m, m)}: {sum(table[m].values())} calls")

    det, pho, lo, hi = month_to_date_cost(tok)
    print(f"\nMonth to date: {det} Details, {pho} Photo calls")
    print(f"Estimated month-to-date cost: ${lo:.2f}–${hi:.2f} before tax "
          f"(after free tiers: {DETAILS_FREE} Details, {ATMOSPHERE_FREE} Atmosphere, {PHOTO_FREE} Photo)")
    print("Budget alert: $60/month. Real invoice: console -> Billing -> Reports (rob.glowra@gmail.com).")

    details = table.get("google.places.Details.Http", {})
    busy = sorted((d for d in dates if details.get(d, 0) > EXPECTED_DETAILS_PER_DAY),
                  key=lambda d: details[d], reverse=True)
    noisy = sorted(busy[1:])  # one big day a week is the Sunday photo refresh
    print("\nFlags:")
    if hi > 60:
        print("  ! Month-to-date estimate is above the $60 budget")
    if noisy:
        print(f"  ! Details calls above {EXPECTED_DETAILS_PER_DAY}/day on more than one day: {', '.join(noisy)}")
    if hi <= 60 and not noisy:
        print("  none")

    print(f"\nGoogle daily request quota: {quota(tok)}")
    print(f"Code photo budget (24h): {photo_budget()}")


if __name__ == "__main__":
    main()
