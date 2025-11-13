const draftService = require('./draftService');

/**
 * Form integration service
 * Handles integration with existing ClinicListingRequests
 */
class FormIntegrationService {
  /**
   * Create draft from form submission
   * @param {Object} formData - Form submission data
   * @returns {Promise<Object>} Created draft
   */
  async createDraftFromForm(formData) {
    const draftData = {
      clinicName: formData.clinicName,
      address: formData.address,
      city: formData.city,
      state: formData.state,
      website: formData.website || null,
      phone: formData.phone || null,
      email: formData.email || null,
      category: formData.clinicCategory || formData.category || null,
      status: 'draft', // Form submissions start as drafts
      source: formData.requestType === 'adjustment' ? 'form_adjustment' : 'form',
      submittedBy: formData.email || 'public_form',
      requestID: formData.requestId || formData.requestID || null,
      duplicateClinicID: formData.existingClinicId || formData.existingClinicID || null,
      notes: formData.message || formData.additionalDetails || null
    };

    // If this is an adjustment request, link to existing clinic
    if (formData.requestType === 'adjustment' && formData.existingClinicId) {
      draftData.duplicateClinicID = formData.existingClinicId;
    }

    return await draftService.createDraft(draftData);
  }

  /**
   * Link form request to draft
   */
  async linkRequestToDraft(requestId, draftId) {
    return await draftService.updateDraft(draftId, {
      requestID: requestId
    });
  }
}

module.exports = new FormIntegrationService();

