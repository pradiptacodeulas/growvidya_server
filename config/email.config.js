const EmailCredentialModel = require('../models/emailCredential.model');
const EmailService = require('../services/email.service');

/**
 * Dynamically retrieves active default email provider credentials (Mailjet or SMTP)
 * from the database at runtime.
 * Changes in Super Admin Settings take effect immediately without restarting the server.
 */
async function getEmailConfig() {
  const credentials = await EmailCredentialModel.getActiveCredentials();
  if (!credentials) {
    return null;
  }

  return {
    ...credentials,
    sendEmail: (options) => EmailService.sendEmail({ ...options, credentialId: credentials.id }),
  };
}

module.exports = {
  getEmailConfig,
};
