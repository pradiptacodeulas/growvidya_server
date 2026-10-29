const Razorpay = require('razorpay');
const RazorpayCredentialModel = require('../models/razorpayCredential.model');

/**
 * Dynamically retrieves active Razorpay credentials from the database
 * and initializes the Razorpay SDK client at runtime.
 * Changes in Settings take effect immediately without restarting the server.
 */
async function getRazorpayConfig() {
  const credentials = await RazorpayCredentialModel.getActiveCredentials();

  if (!credentials || !credentials.keyId || !credentials.keySecret) {
    return null;
  }

  const razorpayInstance = new Razorpay({
    key_id: credentials.keyId,
    key_secret: credentials.keySecret,
  });

  return {
    razorpayInstance,
    keyId: credentials.keyId,
    keySecret: credentials.keySecret,
    webhookSecret: credentials.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || null,
  };
}

module.exports = {
  getRazorpayConfig,
};
