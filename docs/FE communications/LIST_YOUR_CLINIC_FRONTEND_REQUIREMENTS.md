# List Your Clinic - Frontend Requirements

**Version**: 1.0  
**Date**: December 2024  
**Status**: Planning  

---

## Overview

Replace the current "List Your Clinic" modal with a full multi-step wizard that lives as its own page/section on Glowra. This creates a proper onboarding flow for clinics, allowing anyone to submit clinic data for review before it goes live.

---

## User Flows

### Flow 1: Add New Clinic (Primary)

```
Entry Point → Choose Action → Clinic Info → Providers → Procedures → Review → Success
```

### Flow 2: Add to Existing Clinic

```
Entry Point → Choose Action → Search Clinic → Select Match → Providers → Procedures → Review → Success
```

---

## Entry Points

| Entry Point | Behavior |
|-------------|----------|
| "List Your Clinic" button (header/footer) | Goes to `/list-your-clinic` |
| "Add Your Clinic" CTA on homepage | Goes to `/list-your-clinic` |
| "Is this your clinic? Add info" on clinic detail page | Goes to `/list-your-clinic?clinicId=123` (pre-fills clinic) |
| Direct URL `/list-your-clinic` | Starts fresh wizard |

---

## Page Structure

### URL: `/list-your-clinic`

This is a standalone page (not a modal) with its own layout. Consider a clean, focused design similar to onboarding flows on Typeform, Stripe, or Notion.

---

## Step-by-Step Wizard

### Step 0: Choose Action

**Purpose**: Let user choose between adding a new clinic or adding to an existing one.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                      🏥 List Your Clinic on Glowra                      │
│                                                                         │
│         Help patients find the best aesthetic treatments near them      │
│                                                                         │
│  ┌─────────────────────────────┐   ┌─────────────────────────────┐     │
│  │                             │   │                             │     │
│  │    ➕ Add a New Clinic      │   │   📝 Add to Existing        │     │
│  │                             │   │                             │     │
│  │  List a clinic that isn't  │   │  Add providers, procedures  │     │
│  │  on Glowra yet             │   │  to a clinic already listed │     │
│  │                             │   │                             │     │
│  │        [ Start ]            │   │        [ Search ]           │     │
│  └─────────────────────────────┘   └─────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**If `?clinicId=123` in URL**: Skip this step, go directly to Step 2 (Providers) with clinic pre-loaded.

**If `?submitterKey=xyz` in URL**: Pre-fill the submitter key field (see below).

**Submitter Key (Optional)**: At the bottom of Step 0, include a subtle collapsible section:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ▸ Have a submitter key? (optional)                                     │
└─────────────────────────────────────────────────────────────────────────┘

// When expanded:
┌─────────────────────────────────────────────────────────────────────────┐
│  ▾ Have a submitter key? (optional)                                     │
│                                                                         │
│    Submitter Key                                                        │
│    ┌────────────────────────────────────────────────────────────────┐  │
│    │                                                                │  │
│    └────────────────────────────────────────────────────────────────┘  │
│    If you were given a key, enter it here. Otherwise, leave blank.     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

This keeps it available but unobtrusive - most users will ignore it.

---

### Step 1A: Search for Existing Clinic (Add to Existing flow)

**Purpose**: Find the clinic they want to add to.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                                                    Step 1 of 5  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      Find Your Clinic                                   │
│                                                                         │
│  Search by clinic name or address                                       │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 🔍  Skin Solutions Miami                                       │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ✓  Skin Solutions Miami                                         │   │
│  │    123 Collins Ave, Miami Beach, FL                             │   │
│  │    ⭐ 4.8 (234 reviews) • Med Spa                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │    Skin Solutions                                                │   │
│  │    456 Ocean Drive, Miami, FL                                   │   │
│  │    ⭐ 4.5 (89 reviews) • Dermatology                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Don't see your clinic? [ Add it as new ]                              │
│                                                                         │
│                                              [ Continue with Selected ] │
└─────────────────────────────────────────────────────────────────────────┘
```

**API Call**: `GET /api/clinics/search?q={query}`

**On Select**: Store `clinicId` in wizard state, skip to Step 2 (Providers).

---

### Step 1B: Clinic Information (New Clinic flow)

**Purpose**: Collect basic clinic details.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                                                    Step 1 of 5  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      Clinic Information                                 │
│                                                                         │
│  Clinic Name *                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ Skin Solutions Miami                                           │    │
│  └────────────────────────────────────────────────────────────────┘    │
│  The official name as it appears on the clinic's website               │
│                                                                         │
│  Street Address *                                                       │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 123 Collins Ave, Suite 400                                     │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  City *                              State *                            │
│  ┌─────────────────────────┐        ┌─────────────────────────┐        │
│  │ Miami Beach             │        │ Florida            ▼    │        │
│  └─────────────────────────┘        └─────────────────────────┘        │
│                                                                         │
│  Zip Code                                                               │
│  ┌─────────────────────────┐                                           │
│  │ 33139                   │                                           │
│  └─────────────────────────┘                                           │
│                                                                         │
│  Clinic Category *                                                      │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ Med Spa / Aesthetics                                      ▼    │    │
│  └────────────────────────────────────────────────────────────────┘    │
│  Options: Plastic Surgery, Med Spa / Aesthetics, Medical,              │
│           Dermatology, Other                                           │
│                                                                         │
│  Website                                                                │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ https://skinsolutionsmiami.com                                 │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Phone                                                                  │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ (305) 555-1234                                                 │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Email                                                                  │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ info@skinsolutionsmiami.com                                    │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│                                                     [ Continue → ]      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Required Fields**: Clinic Name, Address, City, State, Category

**Optional Fields**: Zip Code, Website, Phone, Email

**Validation**:
- Website must start with `http://` or `https://`
- Phone format: `(XXX) XXX-XXXX` or `XXX-XXX-XXXX`
- Email must be valid format

**On Continue**: Check for duplicates via API, warn if match found.

---

### Step 2: Providers (Optional)

**Purpose**: Add providers/practitioners at the clinic.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                                                    Step 2 of 5  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      Providers at This Clinic                           │
│                                                                         │
│  Add the doctors, nurses, or practitioners at this clinic.             │
│  You can skip this step if you don't have this information.            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Provider Name *                    Specialty                    │   │
│  │  ┌─────────────────────────┐       ┌─────────────────────────┐  │   │
│  │  │ Dr. Sarah Johnson       │       │ Plastic Surgery    ▼    │  │   │
│  │  └─────────────────────────┘       └─────────────────────────┘  │   │
│  │                                                         [ ✕ ]   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Provider Name *                    Specialty                    │   │
│  │  ┌─────────────────────────┐       ┌─────────────────────────┐  │   │
│  │  │ Maria Garcia, RN        │       │ Aesthetics         ▼    │  │   │
│  │  └─────────────────────────┘       └─────────────────────────┘  │   │
│  │                                                         [ ✕ ]   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│                      [ + Add Another Provider ]                         │
│                                                                         │
│  [ Skip this step ]                                 [ Continue → ]      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Specialty Options**:
- Plastic Surgery
- Med Spa / Aesthetics
- Medical
- Dermatology
- Other

**Behavior**:
- Start with one empty provider row
- "Add Another Provider" adds a new row
- Can remove rows (except keep at least one visible)
- Can skip entirely (empty providers array)

---

### Step 3: Procedures (Optional)

**Purpose**: Add procedures offered at the clinic.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                                                    Step 3 of 5  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      Procedures Offered                                 │
│                                                                         │
│  Add procedures and their pricing. You can skip this step.             │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  Procedure Name *                   Category *                   │   │
│  │  ┌─────────────────────────┐       ┌─────────────────────────┐  │   │
│  │  │ Botox                   │       │ Injectables        ▼    │  │   │
│  │  └─────────────────────────┘       └─────────────────────────┘  │   │
│  │                                                                  │   │
│  │  Price Range                        Unit                         │   │
│  │  ┌──────────┐ - ┌──────────┐       ┌─────────────────────────┐  │   │
│  │  │ $12      │   │ $15      │       │ /unit              ▼    │  │   │
│  │  └──────────┘   └──────────┘       └─────────────────────────┘  │   │
│  │                                                                  │   │
│  │  Average Price (optional)           Provider(s)                  │   │
│  │  ┌──────────────────┐              ┌─────────────────────────┐  │   │
│  │  │ $13.50           │              │ Dr. Sarah Johnson  ▼    │  │   │
│  │  └──────────────────┘              │ ☑ Maria Garcia, RN      │  │   │
│  │                                    └─────────────────────────┘  │   │
│  │  If not provided, we'll calculate from price range              │   │
│  │                                                         [ ✕ ]   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│                      [ + Add Another Procedure ]                        │
│                                                                         │
│  [ Skip this step ]                                 [ Continue → ]      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Procedure Fields**:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| Procedure Name | Yes | text | e.g., "Botox", "Rhinoplasty" |
| Category | Yes | dropdown | Face, Body, Breast, Butt, Injectables, Skin, Other |
| Price Min | No | number | Minimum price |
| Price Max | No | number | Maximum price |
| Unit | No | dropdown | /unit, /session, /injection, /area, /treatment, (none) |
| Average Price | No | number | Auto-calculated if not provided: (min + max) / 2 |
| Providers | No | multi-select | Select from providers added in Step 2 |

**Category Options**:
- Face
- Body
- Breast
- Butt
- Injectables
- Skin
- Other

**Unit Options**:
- (blank/none)
- /unit
- /session
- /injection
- /area
- /treatment
- /syringe
- /vial
- /procedure
- /package
- /cycle
- /thread
- /graft

---

### Step 4: Review & Submit

**Purpose**: Show summary of all entered data before submission.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                                                    Step 4 of 5  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                      Review Your Submission                             │
│                                                                         │
│  Please review the information below before submitting.                │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ CLINIC INFORMATION                                    [ Edit ]   │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ Name:      Skin Solutions Miami                                  │   │
│  │ Address:   123 Collins Ave, Suite 400                           │   │
│  │            Miami Beach, FL 33139                                │   │
│  │ Category:  Med Spa / Aesthetics                                  │   │
│  │ Website:   https://skinsolutionsmiami.com                       │   │
│  │ Phone:     (305) 555-1234                                       │   │
│  │ Email:     info@skinsolutionsmiami.com                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ PROVIDERS (2)                                         [ Edit ]   │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ • Dr. Sarah Johnson - Plastic Surgery                           │   │
│  │ • Maria Garcia, RN - Aesthetics                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ PROCEDURES (3)                                        [ Edit ]   │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ • Botox (Injectables) - $12-$15/unit                            │   │
│  │   Providers: Dr. Sarah Johnson, Maria Garcia                    │   │
│  │ • Lip Filler (Injectables) - $500-$800/syringe                  │   │
│  │   Providers: Maria Garcia                                       │   │
│  │ • Rhinoplasty (Face) - $8,000-$15,000                           │   │
│  │   Providers: Dr. Sarah Johnson                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ℹ️  Your submission will be reviewed by our team before going   │   │
│  │    live. This typically takes 1-2 business days.                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [ ← Go Back ]                               [ Submit for Review → ]   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Edit Links**: Jump back to specific step with data preserved.

**Submit Action**: `POST /api/clinic-management/submissions` with full payload.

---

### Step 5: Success / Confirmation

**Purpose**: Confirm submission and set expectations.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                           ✅ Submission Received!                       │
│                                                                         │
│              Thank you for listing Skin Solutions Miami                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  What happens next?                                              │   │
│  │                                                                  │   │
│  │  1. Our team will review your submission (1-2 business days)    │   │
│  │  2. We may reach out if we need additional information          │   │
│  │  3. Once approved, your clinic will appear on Glowra            │   │
│  │                                                                  │   │
│  │  Submission ID: #GLW-2024-0042                                   │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│        [ List Another Clinic ]        [ Return to Homepage ]           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**If Duplicate Warning**: Show additional message that we found a potential match and will verify.

---

## API Endpoints Required

The frontend will need these backend endpoints:

### Submission Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/clinic-management/submissions` | POST | Submit complete clinic data |
| `/api/clinic-management/submissions/validate` | POST | Validate data without submitting (optional) |
| `/api/clinics/search` | GET | Search existing clinics (for "add to existing" flow) |
| `/api/clinics/:id` | GET | Get clinic details (when pre-filling from clinic page) |
| `/api/clinic-management/schema` | GET | Get field definitions for form generation (optional) |

### Submission Payload

```json
{
  "submitterKey": "optional-key-for-internal-tracking",
  "flow": "new_clinic" | "add_to_existing",
  "existingClinicId": null | 123,
  
  "clinic": {
    "clinicName": "Skin Solutions Miami",
    "address": "123 Collins Ave, Suite 400",
    "city": "Miami Beach",
    "state": "Florida",
    "zipCode": "33139",
    "category": "Med Spa / Aesthetics",
    "website": "https://skinsolutionsmiami.com",
    "phone": "(305) 555-1234",
    "email": "info@skinsolutionsmiami.com"
  },
  
  "providers": [
    {
      "providerName": "Dr. Sarah Johnson",
      "specialty": "Plastic Surgery"
    },
    {
      "providerName": "Maria Garcia, RN",
      "specialty": "Aesthetics"
    }
  ],
  
  "procedures": [
    {
      "procedureName": "Botox",
      "category": "Injectables",
      "priceMin": 12,
      "priceMax": 15,
      "unit": "/unit",
      "averagePrice": null,
      "providerNames": ["Dr. Sarah Johnson", "Maria Garcia, RN"]
    },
    {
      "procedureName": "Rhinoplasty",
      "category": "Face",
      "priceMin": 8000,
      "priceMax": 15000,
      "unit": null,
      "averagePrice": 11500,
      "providerNames": ["Dr. Sarah Johnson"]
    }
  ]
}
```

### Response

```json
{
  "success": true,
  "submissionId": "GLW-2024-0042",
  "status": "pending_review",
  "message": "Submission received. We'll review it within 1-2 business days.",
  "duplicateWarning": null | {
    "message": "We found a potential match",
    "existingClinic": {
      "id": 15,
      "name": "Skin Solutions",
      "address": "123 Collins Ave"
    }
  }
}
```

---

## State Management

Recommend using React state or a form library (React Hook Form, Formik) to manage wizard state:

```typescript
interface WizardState {
  currentStep: 0 | 1 | 2 | 3 | 4;
  flow: 'new_clinic' | 'add_to_existing';
  submitterKey?: string;  // From URL param, for internal tracking only
  existingClinicId?: number;
  
  clinic: {
    clinicName: string;
    address: string;
    city: string;
    state: string;
    zipCode?: string;
    category: string;
    website?: string;
    phone?: string;
    email?: string;
  };
  
  providers: Array<{
    providerName: string;
    specialty?: string;
  }>;
  
  procedures: Array<{
    procedureName: string;
    category: string;
    priceMin?: number;
    priceMax?: number;
    unit?: string;
    averagePrice?: number;
    providerNames: string[];
  }>;
}
```

**Persistence**: Consider saving wizard state to localStorage so users don't lose progress on refresh.

---

## Validation Rules

### Clinic Fields

| Field | Rule |
|-------|------|
| clinicName | Required, max 255 chars |
| address | Required, max 500 chars |
| city | Required, max 100 chars |
| state | Required, must be valid US state |
| zipCode | Optional, 5 digits |
| category | Required, must be from enum |
| website | Optional, must start with http:// or https:// |
| phone | Optional, format (XXX) XXX-XXXX or XXX-XXX-XXXX |
| email | Optional, valid email format |

### Provider Fields

| Field | Rule |
|-------|------|
| providerName | Required if provider row exists, max 255 chars |
| specialty | Optional, must be from enum |

### Procedure Fields

| Field | Rule |
|-------|------|
| procedureName | Required if procedure row exists, max 255 chars |
| category | Required, must be from enum |
| priceMin | Optional, positive number |
| priceMax | Optional, must be >= priceMin |
| unit | Optional, must be from enum |
| averagePrice | Optional, auto-calculate if not provided |
| providerNames | Optional, array of strings |

---

## Enum Values (Dropdowns)

### US States
All 50 US states + DC (standard dropdown)

### Clinic Categories
- Plastic Surgery
- Med Spa / Aesthetics
- Medical
- Dermatology
- Other

### Provider Specialties
- Plastic Surgery
- Med Spa / Aesthetics
- Medical
- Dermatology
- Other

### Procedure Categories
- Face
- Body
- Breast
- Butt
- Injectables
- Skin
- Other

### Price Units
- (none/blank)
- /unit
- /session
- /injection
- /area
- /treatment
- /syringe
- /vial
- /procedure
- /package
- /cycle
- /thread
- /graft

---

## Design Considerations

### General
- Clean, focused design - minimize distractions
- Progress indicator showing current step
- Ability to go back without losing data
- Mobile responsive
- Clear error states with field-level messages

### Accessibility
- All form inputs properly labeled
- Keyboard navigation works
- Error messages announced to screen readers
- Sufficient color contrast

### Loading States
- Show spinner during API calls
- Disable submit button while loading
- Show skeleton states if loading clinic data

### Error Handling
- Show field-level validation errors inline
- Show toast/alert for API errors
- Allow retry on failure

---

## Mobile Considerations

The wizard should work well on mobile:
- Stack form fields vertically
- Full-width inputs
- Large touch targets for buttons
- Consider collapsible sections on review page
- Bottom-sticky "Continue" button

---

## Analytics Events (Optional)

Consider tracking:
- `list_clinic_started` - User enters wizard
- `list_clinic_step_completed` - User completes a step
- `list_clinic_submitted` - User submits form
- `list_clinic_abandoned` - User leaves without submitting
- `list_clinic_duplicate_shown` - Duplicate warning displayed

---

## Future Enhancements (Out of Scope)

These are not needed for v1 but could be added later:
- Save draft functionality
- Email confirmation after submission
- Status tracking page for submissions
- Photo upload for clinic
- Multiple clinic locations (franchise support)
- Account/login for clinic owners to manage their listings

---

## Questions for Frontend Team

1. Do you want to use a specific form library (React Hook Form, Formik)?
2. Should we implement localStorage persistence for the wizard state?
3. Any specific animation/transition preferences between steps?
4. Do you need a Figma/design file, or is this spec sufficient?

