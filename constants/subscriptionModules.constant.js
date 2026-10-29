/**
 * Canonical SaaS Subscription Constants
 * - Dynamic Billing Cycles & Calendar Date Arithmetic (IST-safe, zero UTC drift)
 * - Zero ERP module locking: all ERP features are unlocked on every active subscription;
 *   only max_students, cloud storage quota, and add-ons (hardware / notification credits) are enforced.
 */

const BILLING_CYCLES = Object.freeze({
  trial: {
    code: 'trial',
    months: 0,
    rank: 0,
    label: 'Free Trial',
    shortLabel: 'trial',
    suffix: '',
    default_duration_text: 'Free Trial',
    durationLabel: (trialDays) => {
      const d = parseInt(trialDays, 10) || 0;
      return d > 0 ? `${d} Days` : 'Free Trial';
    },
  },
  monthly: {
    code: 'monthly',
    months: 1,
    rank: 1,
    label: 'Monthly',
    shortLabel: 'month',
    suffix: '/ month',
    default_duration_text: '1 Month',
    durationLabel: () => '1 Month',
  },
  quarterly: {
    code: 'quarterly',
    months: 3,
    rank: 3,
    label: 'Quarterly',
    shortLabel: 'quarter',
    suffix: '/ quarter',
    default_duration_text: '3 Months',
    durationLabel: () => '3 Months',
  },
  half_yearly: {
    code: 'half_yearly',
    months: 6,
    rank: 6,
    label: 'Half-Yearly',
    shortLabel: '6 months',
    suffix: '/ 6 months',
    default_duration_text: '6 Months',
    durationLabel: () => '6 Months',
  },
  annual: {
    code: 'annual',
    months: 12,
    rank: 12,
    label: 'Annual',
    shortLabel: 'year',
    suffix: '/ year',
    default_duration_text: '12 Months',
    durationLabel: () => '12 Months',
  },
});

const PAID_BILLING_CYCLE_LIST = Object.freeze(['monthly', 'quarterly', 'half_yearly', 'annual']);
const ALL_BILLING_CYCLE_LIST = Object.freeze(['trial', ...PAID_BILLING_CYCLE_LIST]);

/**
 * Return current YYYY-MM-DD date string in Asia/Kolkata (IST)
 */
function getTodayIST() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Parse a Date or YYYY-MM-DD string into { year, month (1-12), day } without timezone shift
 */
function parseDateParts(dateInput) {
  if (!dateInput) {
    return parseDateParts(getTodayIST());
  }
  if (typeof dateInput === 'string') {
    const clean = dateInput.trim().slice(0, 10);
    const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
      };
    }
  }
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return parseDateParts(formatter.format(d));
}

function formatDateParts({ year, month, day }) {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToDateStr(dateStr, days) {
  const { year, month, day } = parseDateParts(dateStr);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + (parseInt(days, 10) || 0));
  return utc.toISOString().slice(0, 10);
}

function addMonthsToDateStr(dateStr, monthsToAdd) {
  const { year, month, day } = parseDateParts(dateStr);
  const totalMonths = (year * 12) + (month - 1) + (parseInt(monthsToAdd, 10) || 0);
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12; // 0-11
  const maxDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, maxDayInTargetMonth);
  return formatDateParts({
    year: targetYear,
    month: targetMonthIndex + 1,
    day: targetDay,
  });
}

/**
 * Add a plan's billing cycle duration to a YYYY-MM-DD base date
 */
function addCycleDuration(baseDateStr, billingCycle, freeTrialDays = 0) {
  const cycleKey = String(billingCycle || 'annual').toLowerCase();
  if (cycleKey === 'trial') {
    const days = Math.max(0, parseInt(freeTrialDays, 10) || 0);
    return addDaysToDateStr(baseDateStr, days);
  }
  const meta = BILLING_CYCLES[cycleKey] || BILLING_CYCLES.annual;
  return addMonthsToDateStr(baseDateStr, meta.months);
}

function getCycleMonths(billingCycle) {
  const cycleKey = String(billingCycle || 'annual').toLowerCase();
  return BILLING_CYCLES[cycleKey] ? BILLING_CYCLES[cycleKey].months : 12;
}

function getCycleMeta(billingCycle) {
  const cycleKey = String(billingCycle || 'annual').toLowerCase();
  return BILLING_CYCLES[cycleKey] || BILLING_CYCLES.annual;
}

function getBillingCycleMeta(billingCycle, freeTrialDays = 0) {
  const base = getCycleMeta(billingCycle);
  const durationText =
    typeof base.durationLabel === 'function'
      ? base.durationLabel(freeTrialDays)
      : String(base.default_duration_text || base.label);
  return {
    cycle: base.code,
    code: base.code,
    months: base.months,
    rank: base.rank,
    label: base.label,
    short_label: base.shortLabel,
    shortLabel: base.shortLabel,
    suffix: base.suffix,
    duration_text: durationText,
    durationText,
  };
}

module.exports = {
  BILLING_CYCLES,
  PAID_BILLING_CYCLE_LIST,
  ALL_BILLING_CYCLE_LIST,
  getTodayIST,
  parseDateParts,
  formatDateParts,
  addDaysToDateStr,
  addMonthsToDateStr,
  addCycleDuration,
  getCycleMonths,
  getCycleMeta,
  getBillingCycleMeta,
};
