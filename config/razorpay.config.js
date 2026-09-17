const Razorpay = require('razorpay');

const keyId = process.env.RAZORPAY_KEY_ID || '';
const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'growvidya_webhook_secret_2026';

let razorpayInstance = null;

try {
  razorpayInstance = new Razorpay({
    key_id: keyId || 'q6JQHhSsV3SIZXWLOA05zsmV',
    key_secret: keySecret || 'q6JQHhSsV3SIZXWLOA05zsmV',
  });
} catch (err) {
  console.warn('[Razorpay] Failed to initialize client:', err.message);
}

module.exports = {
  razorpayInstance,
  keyId,
  keySecret,
  webhookSecret,
};
