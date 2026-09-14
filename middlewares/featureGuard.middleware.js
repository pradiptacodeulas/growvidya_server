const SubscriptionModel = require('../models/subscription.model');
const ApiResponse = require('../utils/api.response');

/**
 * Feature Guard Middleware
 * Restricts access to specific modules (e.g., transport, hostel, payroll)
 * based on the school's active subscription tier (features_json).
 *
 * @param {string} featureKey - Key in features_json (e.g. 'transport', 'hostel', 'payroll')
 * @param {string} [featureLabel] - Human readable label for the module
 */
function featureGuard(featureKey, featureLabel) {
  return async (req, res, next) => {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id || req.subscription?.school_id;
      if (!schoolId) {
        return next();
      }

      let sub = req.subscription;
      if (!sub) {
        sub = await SubscriptionModel.getSchoolSubscription(schoolId);
        if (sub) {
          req.subscription = sub;
        }
      }

      // If no subscription record or features map, allow pass-through
      if (!sub || !sub.features) {
        return next();
      }

      // If the feature is explicitly disabled (false) in the current plan's features_json
      if (sub.features[featureKey] === false) {
        const label = featureLabel || featureKey.charAt(0).toUpperCase() + featureKey.slice(1);
        const planName = sub.plan_name || 'Current Plan';

        return ApiResponse.error(
          res,
          `The ${label} module is not included in your ${planName}. Please upgrade your subscription plan to unlock this feature.`,
          {
            code: 'FEATURE_NOT_IN_PLAN',
            feature: featureKey,
            plan_name: planName,
            upgrade_required: true,
          },
          403
        );
      }

      next();
    } catch (error) {
      console.error(`[Feature Guard Error - ${featureKey}]:`, error.message);
      next();
    }
  };
}

module.exports = featureGuard;
