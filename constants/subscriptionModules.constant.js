/**
 * Dynamic SaaS Subscription Date & Calendar Arithmetic Helpers
 * - Billing Cycles are 100% dynamically loaded from `billing_cycle_master` DB table into an in-memory cache.
 * - ZERO hardcoded cycle constants or static fallbacks in code.
 * - Single Source of Truth: `billing_cycle_master` table (status: 1=Active, 2=Inactive, 4=Soft Deleted).
 * - Multi-branch & Zero ERP Module Locking: all active subscriptions unlock full ERP features;
 *   only max_students, storage quota, and add-ons are enforced.
 */

const _billingCycleCache = new Map();
const _allCycleList = [];
const _activeCycleList = [];

/**
 * Load dynamic billing cycles from `billing_cycle_master` table into in-memory cache.
 * Excludes soft-deleted rows (status = 4).
 */
async function refreshBillingCyclesCache() {
  try {
    const { pool } = require('../config/db.config');
    const [rows] = await pool.query(
      `SELECT id, code, label, short_label, suffix, duration_type, duration_value, rank, status
       FROM billing_cycle_master
       WHERE status != 4
       ORDER BY rank ASC, id ASC`
    );

    if (Array.isArray(rows) && rows.length > 0) {
      _billingCycleCache.clear();
      _allCycleList.length = 0;
      _activeCycleList.length = 0;

      for (const row of rows) {
        const code = String(row.code || '').toLowerCase().trim();
        if (!code) continue;

        const durType = String(row.duration_type || 'months').toLowerCase();
        const durVal = parseInt(row.duration_value, 10) || 1;
        const months = durType === 'months' ? durVal : 0;
        const shortLabel = row.short_label || code;

        let defaultDurationText;
        if (durType === 'days') {
          defaultDurationText = `${durVal} Days`;
        } else if (months === 1) {
          defaultDurationText = '1 Month';
        } else if (months % 12 === 0 && months >= 12) {
          defaultDurationText = months === 12 ? '12 Months' : `${months / 12} Years (${months} Months)`;
        } else {
          defaultDurationText = `${months} Months`;
        }

        const cycleObj = {
          id: row.id,
          code,
          label: row.label || code,
          short_label: shortLabel,
          shortLabel,
          suffix: row.suffix || '',
          duration_type: durType,
          duration_value: durVal,
          months,
          rank: parseInt(row.rank, 10) || 0,
          status: parseInt(row.status, 10), // 1=Active, 2=Inactive, 4=Soft Deleted
          default_duration_text: defaultDurationText,
          durationLabel: (trialDays) => {
            if (durType === 'days') {
              const d = parseInt(trialDays, 10);
              return !isNaN(d) && d > 0 ? `${d} Days` : defaultDurationText;
            }
            return defaultDurationText;
          },
        };

        _billingCycleCache.set(code, cycleObj);
        _allCycleList.push(code);
        if (cycleObj.status === 1) {
          _activeCycleList.push(code);
        }
      }
    }
  } catch (err) {
    // If DB is initializing on cold boot, retry automatically until billing_cycle_master is loaded
    if (_billingCycleCache.size === 0) {
      const retryTimer = setTimeout(() => {
        refreshBillingCyclesCache().catch(() => {});
      }, 2500);
      if (typeof retryTimer.unref === 'function') retryTimer.unref();
    }
  }
}

// Transparent Proxy for BILLING_CYCLES for backwards compatibility
const BILLING_CYCLES = new Proxy({}, {
  get(target, prop) {
    if (typeof prop === 'string') {
      const lower = prop.toLowerCase();
      if (_billingCycleCache.has(lower)) {
        return _billingCycleCache.get(lower);
      }
    }
    return target[prop];
  },
  has(target, prop) {
    if (typeof prop === 'string') {
      return _billingCycleCache.has(prop.toLowerCase());
    }
    return prop in target;
  },
  ownKeys() {
    return Array.from(_billingCycleCache.keys());
  },
  getOwnPropertyDescriptor(target, prop) {
    const val = this.get(target, prop);
    if (val !== undefined) {
      return {
        enumerable: true,
        configurable: true,
        value: val,
      };
    }
    return undefined;
  },
});

/**
 * Dynamic list of all billing cycle codes in DB
 */
const ALL_BILLING_CYCLE_LIST = new Proxy([], {
  get(target, prop) {
    if (prop === 'length') return _allCycleList.length;
    if (prop === Symbol.iterator) return _allCycleList[Symbol.iterator].bind(_allCycleList);
    if (typeof _allCycleList[prop] === 'function') return _allCycleList[prop].bind(_allCycleList);
    return _allCycleList[prop];
  },
});

/**
 * Dynamic list of all paid billing cycle codes in DB (excludes days-based / trial cycles)
 */
const PAID_BILLING_CYCLE_LIST = new Proxy([], {
  get(target, prop) {
    const list = _allCycleList.filter((c) => {
      const meta = _billingCycleCache.get(c);
      return meta && meta.duration_type !== 'days' && c !== 'trial';
    });
    if (prop === 'length') return list.length;
    if (prop === Symbol.iterator) return list[Symbol.iterator].bind(list);
    if (typeof list[prop] === 'function') return list[prop].bind(list);
    return list[prop];
  },
});

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
 * Add a plan's billing cycle duration to a YYYY-MM-DD base date.
 * Fully dynamic: strictly uses duration_type and duration_value from billing_cycle_master.
 */
function addCycleDuration(baseDateStr, billingCycle, freeTrialDays = 0) {
  const meta = getCycleMeta(billingCycle);
  if (!meta) {
    throw new Error(`Billing cycle '${billingCycle}' does not exist in billing_cycle_master.`);
  }
  if (meta.duration_type === 'days' || meta.code === 'trial') {
    const customDays = parseInt(freeTrialDays, 10);
    const days = !isNaN(customDays) && customDays > 0 ? customDays : meta.duration_value;
    return addDaysToDateStr(baseDateStr, days);
  }
  return addMonthsToDateStr(baseDateStr, meta.duration_value);
}

function getCycleMonths(billingCycle) {
  const meta = getCycleMeta(billingCycle);
  if (!meta) {
    throw new Error(`Billing cycle '${billingCycle}' does not exist in billing_cycle_master.`);
  }
  return meta.duration_type === 'months' ? meta.duration_value : 0;
}

function getCycleMeta(billingCycle) {
  if (!billingCycle) return null;
  const cycleKey = String(billingCycle).toLowerCase().trim();
  return _billingCycleCache.get(cycleKey) || null;
}

function getBillingCycleMeta(billingCycle, freeTrialDays = 0) {
  const meta = getCycleMeta(billingCycle);
  if (!meta) {
    return null;
  }
  const durationText =
    typeof meta.durationLabel === 'function'
      ? meta.durationLabel(freeTrialDays)
      : String(meta.default_duration_text || meta.label);
  return {
    id: meta.id || null,
    cycle: meta.code,
    code: meta.code,
    months: meta.duration_type === 'months' ? meta.duration_value : 0,
    duration_type: meta.duration_type,
    duration_value: meta.duration_value,
    rank: meta.rank !== undefined ? meta.rank : 0,
    status: meta.status !== undefined ? meta.status : 1,
    label: meta.label,
    short_label: meta.short_label || meta.shortLabel,
    shortLabel: meta.short_label || meta.shortLabel,
    suffix: meta.suffix || '',
    duration_text: durationText,
    durationText,
  };
}

/**
 * Return list of active billing cycles (status = 1) for dropdowns and APIs
 */
function getActiveBillingCycles(paidOnly = false) {
  const result = [];
  for (const meta of _billingCycleCache.values()) {
    if (meta.status === 1) {
      if (paidOnly && (meta.duration_type === 'days' || meta.code === 'trial')) continue;
      result.push(meta);
    }
  }
  return result;
}

function getAllBillingCycles() {
  return Array.from(_billingCycleCache.values());
}

function normalizeDateStr(val) {
  if (!val) return null;
  return formatDateParts(parseDateParts(val));
}

module.exports = {
  BILLING_CYCLES,
  PAID_BILLING_CYCLE_LIST,
  ALL_BILLING_CYCLE_LIST,
  getTodayIST,
  parseDateParts,
  formatDateParts,
  normalizeDateStr,
  addDaysToDateStr,
  addMonthsToDateStr,
  addCycleDuration,
  getCycleMonths,
  getCycleMeta,
  getBillingCycleMeta,
  getActiveBillingCycles,
  getAllBillingCycles,
  refreshBillingCyclesCache,
};
