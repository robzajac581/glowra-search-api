#!/usr/bin/env node
/**
 * Bulk-enrich pending clinic drafts missing PlaceID: Google Place lookup, rating/review JSON, photos.
 *
 * Requires: GOOGLE_PLACES_API_KEY, DB_* env vars (see db.js).
 *
 * Usage:
 *   node scripts/bulkEnrichPendingDraftsGoogle.js [options]
 *
 * Options:
 *   --dry-run              No database writes (still calls Google APIs)
 *   --min-confidence N     Minimum lookup confidence 0..1 (default: 0)
 *   --limit N              Max drafts to process (default: 500, max: 10000)
 *   --draft-id ID          Only this draft (must be pending_review and missing PlaceID)
 *   --delay-ms N           Pause between drafts in ms (default: 200)
 *   --output PATH          Write JSON report file
 *   -h, --help             Show help
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const draftGoogleEnrichmentService = require('../clinic-management/services/draftGoogleEnrichmentService');

function parseArgs(argv) {
  const out = {
    dryRun: false,
    minConfidence: 0,
    limit: 500,
    draftId: null,
    delayMs: 200,
    output: null,
    help: false,
    unknown: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--min-confidence') {
      const v = parseFloat(argv[++i]);
      out.minConfidence = v;
    } else if (a === '--limit') {
      out.limit = parseInt(argv[++i], 10);
    } else if (a === '--draft-id') {
      out.draftId = parseInt(argv[++i], 10);
    } else if (a === '--delay-ms') {
      out.delayMs = parseInt(argv[++i], 10);
    } else if (a === '--output') {
      out.output = argv[++i];
    } else if (a === '--help' || a === '-h') out.help = true;
    else {
      console.error('Unknown argument:', a);
      out.unknown = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`
bulkEnrichPendingDraftsGoogle.js — enrich pending_review drafts with no PlaceID from Google.

Options:
  --dry-run              No database writes
  --min-confidence N     Min Place lookup confidence (default: 0)
  --limit N              Max rows (default: 500)
  --draft-id ID          Single draft only
  --delay-ms N           Delay between drafts ms (default: 200)
  --output PATH          Write report JSON
  -h, --help             This help
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.unknown) {
    printHelp();
    process.exit(1);
  }

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error('Missing GOOGLE_PLACES_API_KEY in environment.');
    process.exit(1);
  }

  let minConfidence = Number.isFinite(args.minConfidence) ? args.minConfidence : 0;
  minConfidence = Math.min(1, Math.max(0, minConfidence));

  let limit = Number.isFinite(args.limit) ? args.limit : 500;
  limit = Math.min(10000, Math.max(1, limit));

  let delayMs = Number.isFinite(args.delayMs) ? args.delayMs : 200;
  delayMs = Math.min(60000, Math.max(0, delayMs));

  const draftId =
    args.draftId != null && !Number.isNaN(args.draftId) ? args.draftId : null;

  console.log('Bulk enrich pending drafts (missing PlaceID)', {
    dryRun: args.dryRun,
    minConfidence,
    limit,
    draftId,
    delayMs
  });

  const { summary, results } =
    await draftGoogleEnrichmentService.bulkEnrichPendingDraftsMissingPlaceId({
      dryRun: args.dryRun,
      minConfidence,
      limit,
      draftId,
      delayMs
    });

  console.log('Summary:', summary);

  const report = {
    finishedAt: new Date().toISOString(),
    options: {
      dryRun: args.dryRun,
      minConfidence,
      limit,
      draftId,
      delayMs
    },
    summary,
    results
  };

  if (args.output) {
    const outPath = path.isAbsolute(args.output)
      ? args.output
      : path.join(process.cwd(), args.output);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('Wrote report:', outPath);
  }

  const hasErrors = summary.errors > 0;
  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
