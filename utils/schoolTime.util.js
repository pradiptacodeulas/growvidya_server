/**
 * Timezone-safe "now" helpers for attendance.
 * The server clock may run in UTC, so "today" and cut-off times must be computed
 * in the school's timezone (default Asia/Kolkata) instead of the machine's local time.
 */

const DEFAULT_TZ = process.env.SCHOOL_TIMEZONE || 'Asia/Kolkata';

/**
 * Returns the current date/time parts in the given IANA timezone.
 * @returns {{ dateStr: string, timeStr: string, isoDay: number, dateTimeStr: string, iso: string, tz: string }}
 *  - dateStr:     'YYYY-MM-DD'
 *  - timeStr:     'HH:mm:ss' (24h)
 *  - isoDay:      1 (Mon) .. 7 (Sun)
 *  - dateTimeStr: 'YYYY-MM-DD HH:mm:ss' (for DATETIME columns, already in school tz)
 *  - iso:         ISO-8601 string with offset, e.g. '2026-10-27T08:42:10+05:30'
 */
function nowInTz(tz = DEFAULT_TZ, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const timeStr = `${parts.hour}:${parts.minute}:${parts.second}`;
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  // Offset of tz vs UTC in minutes
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

  return {
    dateStr,
    timeStr,
    isoDay: dayMap[parts.weekday] || 0,
    dateTimeStr: `${dateStr} ${timeStr}`,
    iso: `${dateStr}T${timeStr}${offset}`,
    offset,
    tz,
  };
}

/**
 * Convert a naive 'YYYY-MM-DD HH:mm:ss' (or Date from mysql2) stored in school tz to ISO with offset.
 */
function toSchoolIso(value, tz = DEFAULT_TZ) {
  if (!value) return null;
  let str;
  if (value instanceof Date) {
    // mysql2 parses DATETIME as local machine time; re-format the wall clock as stored
    const pad = (n) => String(n).padStart(2, '0');
    str = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(
      value.getMinutes()
    )}:${pad(value.getSeconds())}`;
  } else {
    str = String(value).replace('T', ' ').slice(0, 19);
  }
  return `${str.replace(' ', 'T')}${nowInTz(tz).offset}`;
}

/**
 * Normalize 'H:mm', 'HH:mm' or 'HH:mm:ss' to 'HH:mm:ss'. Returns null if invalid.
 */
function normalizeTime(value) {
  if (value === null || value === undefined) return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3] || 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

module.exports = { nowInTz, toSchoolIso, normalizeTime, DEFAULT_TZ };
