const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs').promises;

/**
 * Generate standardized Excel template for clinic imports
 * Creates a workbook with three sheets: Clinics, Providers, Procedures
 */
function generateTemplate() {
  const workbook = XLSX.utils.book_new();

  // Clinic Sheet
  const clinicHeaders = [
    'ClinicName',
    'Address',
    'City',
    'State',
    'Website',
    'Phone',
    'Email',
    'Latitude',
    'Longitude',
    'PlaceID',
    'Category'
  ];

  const clinicSheet = XLSX.utils.aoa_to_sheet([clinicHeaders]);
  
  // Set column widths
  clinicSheet['!cols'] = [
    { wch: 30 }, // ClinicName
    { wch: 40 }, // Address
    { wch: 20 }, // City
    { wch: 10 }, // State
    { wch: 40 }, // Website
    { wch: 20 }, // Phone
    { wch: 30 }, // Email
    { wch: 15 }, // Latitude
    { wch: 15 }, // Longitude
    { wch: 50 }, // PlaceID
    { wch: 20 }  // Category
  ];

  XLSX.utils.book_append_sheet(workbook, clinicSheet, 'Clinics');

  // Providers Sheet
  const providerHeaders = [
    'ClinicName',
    'ProviderName',
    'Specialty'
  ];

  const providerSheet = XLSX.utils.aoa_to_sheet([providerHeaders]);
  
  providerSheet['!cols'] = [
    { wch: 30 }, // ClinicName
    { wch: 30 }, // ProviderName
    { wch: 40 }  // Specialty
  ];

  XLSX.utils.book_append_sheet(workbook, providerSheet, 'Providers');

  // Procedures Sheet
  const procedureHeaders = [
    'ClinicName',
    'ProcedureName',
    'Category',
    'AverageCost',
    'ProviderName'
  ];

  const procedureSheet = XLSX.utils.aoa_to_sheet([procedureHeaders]);
  
  procedureSheet['!cols'] = [
    { wch: 30 }, // ClinicName
    { wch: 40 }, // ProcedureName
    { wch: 20 }, // Category
    { wch: 15 }, // AverageCost
    { wch: 30 }  // ProviderName
  ];

  XLSX.utils.book_append_sheet(workbook, procedureSheet, 'Procedures');

  return workbook;
}

/**
 * Save template to file
 */
async function saveTemplate(outputPath) {
  const workbook = generateTemplate();
  const templatePath = path.resolve(outputPath);
  
  // Ensure directory exists
  const dir = path.dirname(templatePath);
  await fs.mkdir(dir, { recursive: true });
  
  XLSX.writeFile(workbook, templatePath);
  return templatePath;
}

/**
 * Generate template buffer for download
 */
function generateTemplateBuffer() {
  const workbook = generateTemplate();
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  generateTemplate,
  saveTemplate,
  generateTemplateBuffer
};

