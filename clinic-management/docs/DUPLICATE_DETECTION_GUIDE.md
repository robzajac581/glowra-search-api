# Duplicate Detection Guide

## Overview

The Clinic Management API uses a multi-strategy duplicate detection system to identify potential duplicate clinics before they are added to the database. This prevents data duplication and helps maintain data quality.

## Detection Strategies

The system uses five strategies, in order of confidence:

### 1. PlaceID Match (Highest Confidence)
- **Confidence:** High
- **Similarity Score:** 1.0
- **How it works:** Exact match on Google Places ID
- **When used:** If PlaceID is provided in the draft

**Example:**
- Draft PlaceID: `ChIJ1234567890`
- Existing Clinic PlaceID: `ChIJ1234567890`
- Result: **Exact match** - Highest confidence duplicate

### 2. Fuzzy Name + Address Match
- **Confidence:** High (≥90% similarity) or Medium (75-89% similarity)
- **Similarity Score:** 0.75 - 1.0
- **How it works:** 
  - Compares clinic name using fuzzy string matching (Levenshtein distance)
  - Compares address using fuzzy string matching
  - Combines scores: Name (60%) + Address (40%)
- **Threshold:** 75% combined similarity

**Example:**
- Draft: "Example Medical Spa" at "123 Main Street"
- Existing: "Example Medical Spa" at "123 Main St"
- Result: **High confidence match** (name exact, address very similar)

### 3. Phone Number Match
- **Confidence:** Medium
- **Similarity Score:** 0.9
- **How it works:** Normalizes phone numbers (removes spaces, dashes, parentheses) and compares
- **When used:** If phone number is provided

**Example:**
- Draft: "(555) 123-4567"
- Existing: "555-123-4567"
- Result: **Match** (normalized to "5551234567")

### 4. Website Domain Match
- **Confidence:** Low
- **Similarity Score:** 0.7
- **How it works:** Extracts domain from URL and compares
- **When used:** If website is provided

**Example:**
- Draft: "https://www.example.com"
- Existing: "http://example.com"
- Result: **Match** (both resolve to "example.com")

### 5. Fuzzy Name + City/State Match
- **Confidence:** Medium (≥85% name similarity) or Low (70-84% name similarity)
- **Similarity Score:** 0.7 - 0.85
- **How it works:**
  - Requires exact city and state match
  - Fuzzy matches clinic name
- **Threshold:** 70% name similarity

**Example:**
- Draft: "Example Clinic" in "New York, NY"
- Existing: "Example Medical Clinic" in "New York, NY"
- Result: **Medium confidence match** (same location, similar name)

## Response Format

When duplicates are detected, the API returns:

```json
{
  "hasDuplicates": true,
  "confidence": "high",
  "matches": [
    {
      "clinicId": 123,
      "clinicName": "Existing Clinic Name",
      "address": "123 Main St",
      "city": "New York",
      "state": "NY",
      "phone": "555-1234",
      "website": "https://example.com",
      "placeID": "ChIJ...",
      "matchReason": "PlaceID match",
      "confidence": "high",
      "similarityScore": 1.0,
      "existingData": {
        "clinicId": 123,
        "clinicName": "Existing Clinic Name",
        ...
      }
    }
  ],
  "newClinicData": {
    "clinicName": "New Clinic",
    ...
  }
}
```

## Confidence Levels

- **High:** Very likely a duplicate (PlaceID match, or ≥90% similarity)
- **Medium:** Possibly a duplicate (75-89% similarity, phone match)
- **Low:** Might be a duplicate (70-74% similarity, website match)

## Handling Duplicates

### Option 1: Merge with Existing Clinic
If the draft is indeed a duplicate and you want to update the existing clinic:

```bash
POST /api/clinic-management/drafts/:draftId/merge
{
  "existingClinicId": 123,
  "reviewedBy": "admin@example.com"
}
```

This will:
- Update existing clinic with new data from draft
- Add new providers/procedures
- Mark draft as "merged"

### Option 2: Reject as Duplicate
If the draft is a duplicate but you don't want to merge:

```bash
POST /api/clinic-management/drafts/:draftId/reject-duplicate
{
  "reason": "Already exists, no updates needed"
}
```

### Option 3: Proceed as New Clinic
If it's NOT a duplicate:

```bash
POST /api/clinic-management/drafts/:draftId/reject-duplicate
{
  "reason": "Different location/branch"
}
```

Then complete the draft and approve normally.

## Best Practices

### 1. Review All Matches
- Don't auto-merge based on confidence alone
- Review the comparison data carefully
- Check if it's the same clinic or a different branch

### 2. PlaceID is Most Reliable
- If PlaceID matches, it's almost certainly a duplicate
- If PlaceID doesn't match but other fields do, investigate further

### 3. Name Similarity Can Be Misleading
- Similar names don't always mean duplicates
- "Smith Clinic" vs "Smith Medical Center" might be different
- Check address and other details

### 4. Phone/Website Matches Need Verification
- Phone numbers can be shared (call centers)
- Websites can redirect or change
- Use as supporting evidence, not sole determinant

### 5. Location Matters
- Same name + same city/state = likely duplicate
- Same name + different city = likely different clinic
- Check if it's a chain or franchise

## Example Scenarios

### Scenario 1: Exact Duplicate
- **Draft:** "ABC Clinic", PlaceID: ChIJ123
- **Existing:** "ABC Clinic", PlaceID: ChIJ123
- **Action:** Merge (same clinic, same location)

### Scenario 2: Branch Location
- **Draft:** "ABC Clinic", Address: "456 Oak St", City: "Boston"
- **Existing:** "ABC Clinic", Address: "123 Main St", City: "New York"
- **Action:** Proceed as new (different location, likely a branch)

### Scenario 3: Name Variation
- **Draft:** "Smith Medical Center", Address: "123 Main St"
- **Existing:** "Smith Clinic", Address: "123 Main St"
- **Action:** Review carefully - might be same clinic with name change, or merge

### Scenario 4: Phone Match Only
- **Draft:** "New Clinic Name", Phone: "555-1234"
- **Existing:** "Old Clinic Name", Phone: "555-1234"
- **Action:** Investigate - could be rebranding or phone number reuse

## Technical Details

### Fuzzy Matching Algorithm
- Uses Levenshtein distance (edit distance)
- Normalizes strings (lowercase, trim)
- Returns similarity ratio (0-1)

### Normalization Rules
- **Addresses:** Remove punctuation, normalize spaces
- **Phone:** Remove formatting characters
- **Websites:** Extract domain, remove www prefix
- **Names:** Lowercase, trim whitespace

### Performance
- PlaceID checks are fastest (indexed)
- Fuzzy matching is slower but more flexible
- System checks all strategies but stops at first high-confidence match

## Troubleshooting

### False Positives
If a non-duplicate is flagged:
1. Check the match reason
2. Review similarity scores
3. Reject duplicate flag with reason
4. Proceed with approval

### False Negatives
If a duplicate is not detected:
1. Check if PlaceID was provided
2. Verify name/address spelling
3. Manually check before approval
4. Consider improving data quality

### Multiple Matches
If multiple matches are found:
1. Review all matches
2. Choose the most likely match
3. Merge with the correct clinic
4. Reject other matches

## Integration

Duplicate detection runs automatically:
- During bulk import
- When checking individual clinics
- Can be triggered manually via API

Results are stored with drafts and can be reviewed before approval.

