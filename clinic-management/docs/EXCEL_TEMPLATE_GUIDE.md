# Excel Template Guide

## Overview

The Clinic Management API uses a standardized Excel template for bulk imports. This guide explains how to use the template correctly.

## Downloading the Template

Download the template via API:

```bash
curl -H "X-API-Key: your-key" \
  http://localhost:3001/api/clinic-management/bulk-import/template \
  -o clinic-import-template.xlsx
```

Or use the GET endpoint in your application.

## Template Structure

The template contains three sheets:

1. **Clinics** - Main clinic information
2. **Providers** - Provider/doctor information
3. **Procedures** - Procedure/service information

## Clinics Sheet

### Required Fields (for submission)
- `ClinicName` - Name of the clinic
- `Address` - Full street address
- `City` - City name
- `State` - State abbreviation (e.g., "NY", "CA")

### Required Fields (for approval)
These can be filled later, but are required before approval:
- `Website` - Clinic website URL (must start with http:// or https://)
- `Phone` - Phone number
- `Email` - Email address
- `PlaceID` - Google Places ID
- `Category` - Clinic category (e.g., "Medical Spa", "Plastic Surgery")

### Optional Fields
- `Latitude` - Geographic latitude (decimal, -90 to 90)
- `Longitude` - Geographic longitude (decimal, -180 to 180)

### Example Row

| ClinicName | Address | City | State | Website | Phone | Email | Latitude | Longitude | PlaceID | Category |
|------------|---------|------|-------|---------|-------|-------|----------|-----------|---------|----------|
| Example Clinic | 123 Main St | New York | NY | https://example.com | 555-1234 | info@example.com | 40.7128 | -74.0060 | ChIJ... | Medical Spa |

## Providers Sheet

### Required Fields
- `ClinicName` - Must match a clinic name from the Clinics sheet
- `ProviderName` - Name of the provider/doctor

### Optional Fields
- `Specialty` - Provider specialty (e.g., "Plastic Surgery", "Dermatology")

### Example Row

| ClinicName | ProviderName | Specialty |
|------------|--------------|------------|
| Example Clinic | Dr. John Smith | Plastic Surgery |
| Example Clinic | Dr. Jane Doe | Dermatology |

**Note:** Multiple providers can be listed for the same clinic.

## Procedures Sheet

### Required Fields
- `ClinicName` - Must match a clinic name from the Clinics sheet
- `ProcedureName` - Name of the procedure/service
- `Category` - Procedure category (must match Categories table values)

### Optional Fields
- `AverageCost` - Average cost in USD (numeric, no currency symbol)
- `ProviderName` - Link procedure to specific provider (must match Providers sheet)

### Example Row

| ClinicName | ProcedureName | Category | AverageCost | ProviderName |
|------------|---------------|----------|-------------|--------------|
| Example Clinic | Breast Augmentation | Breast | 5000 | Dr. John Smith |
| Example Clinic | Botox Injection | Injectibles | 300 | Dr. Jane Doe |

## Common Procedure Categories

Use these exact category names:
- `Breast`
- `Face`
- `Body`
- `Injectibles`
- `Skin`
- `Other`

## Best Practices

### 1. Clinic Name Consistency
- Use the exact same clinic name across all sheets
- Case-sensitive matching (though the system normalizes)
- Avoid extra spaces or special characters

### 2. Provider Linking
- If linking procedures to providers, ensure provider name matches exactly
- Provider names are case-sensitive

### 3. Data Validation
- Validate your file before uploading using `/bulk-import/validate`
- Fix all errors before attempting import
- Warnings don't block import but should be reviewed

### 4. Required Fields
- Fill in all required fields before approval
- You can upload with partial data and complete later via API

### 5. PlaceID Format
- Google Places IDs start with "ChIJ"
- Get PlaceID from Google Places API or Google Maps
- Required for approval

## Validation Rules

### Clinic Validation
- ClinicName, Address, City, State are required
- Email must be valid format
- Website should start with http:// or https://
- Latitude must be between -90 and 90
- Longitude must be between -180 and 180
- Phone format is validated (should have at least 10 digits)

### Provider Validation
- ProviderName is required
- ClinicName must exist in Clinics sheet

### Procedure Validation
- ProcedureName and Category are required
- ClinicName must exist in Clinics sheet
- ProviderName (if provided) must exist in Providers sheet
- AverageCost must be a positive number

## Common Errors

### "ClinicName not found in Clinics sheet"
- Ensure exact spelling match
- Check for extra spaces
- Verify clinic exists in Clinics sheet

### "Invalid email format"
- Use format: `user@domain.com`
- No spaces allowed

### "Invalid latitude/longitude"
- Use decimal format (e.g., 40.7128, not 40°42'46")
- Latitude: -90 to 90
- Longitude: -180 to 180

### "Missing required field"
- Check that all required columns have values
- Empty cells count as missing

## Example Complete Template

### Clinics Sheet
```
ClinicName          | Address        | City      | State | Website              | Phone     | Email            | PlaceID      | Category
Example Medical Spa | 123 Main St   | New York  | NY    | https://example.com  | 555-1234  | info@example.com | ChIJ12345678 | Medical Spa
```

### Providers Sheet
```
ClinicName          | ProviderName   | Specialty
Example Medical Spa | Dr. John Smith | Plastic Surgery
Example Medical Spa | Dr. Jane Doe   | Dermatology
```

### Procedures Sheet
```
ClinicName          | ProcedureName        | Category    | AverageCost | ProviderName
Example Medical Spa | Breast Augmentation  | Breast      | 5000        | Dr. John Smith
Example Medical Spa | Botox Injection      | Injectibles | 300         | Dr. Jane Doe
Example Medical Spa | Facelift             | Face        | 8000        | Dr. John Smith
```

## Tips

1. **Start Small**: Test with 1-2 clinics first
2. **Validate First**: Always validate before importing
3. **Check Duplicates**: Review duplicate detection results carefully
4. **Complete Later**: You can upload partial data and complete via API
5. **Save Template**: Keep a copy of the template for future use

## Support

For issues or questions:
1. Check validation errors first
2. Review this guide
3. Check API documentation for endpoint details
4. Contact your system administrator

