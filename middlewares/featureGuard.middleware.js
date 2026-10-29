/**
 * Pass-through Feature Middleware
 * Per platform policy, no ERP modules/functionality are locked by subscription tier.
 * Subscription enforcement applies strictly to active subscription validity, student quota,
 * cloud storage quota, hardware add-on orders, and SMS/Push notification wallet credits.
 */
function featureGuard() {
  return (_req, _res, next) => next();
}

module.exports = featureGuard;
