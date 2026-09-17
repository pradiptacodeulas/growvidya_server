/**
 * Middleware to transparently decode Base64 encoded URL parameters & query strings
 * (e.g. "MQ==" -> 1, "Ng==" -> 6, "MTU=" -> 15) using standard built-in Base64 (equivalent to browser atob).
 */
const decodeParam = (val) => {
  if (val === null || val === undefined || val === '') return val;
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return val;

  const trimmed = val.trim();
  if (!trimmed) return val;

  // Try decoding Base64 (equivalent to atob)
  try {
    const unescaped = decodeURIComponent(trimmed);
    const decoded = Buffer.from(unescaped, 'base64').toString('utf8');
    if (/^\d+$/.test(decoded)) {
      const reEncoded = Buffer.from(decoded, 'utf8').toString('base64');
      if (reEncoded === unescaped || reEncoded.replace(/=+$/, '') === unescaped.replace(/=+$/, '')) {
        return Number(decoded);
      }
    }
  } catch {}

  // Fallback: If it's already a numeric string, convert to number
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  return val;
};

const isIdKey = (key) => {
  if (!key || typeof key !== 'string') return false;
  const lower = key.toLowerCase().trim();
  if (lower === 'id' || lower === '_id' || lower === 'academic_year') return true;
  if (lower.endsWith('_id') || lower.endsWith('_ids') || key.endsWith('Id') || key.endsWith('Ids')) return true;
  return false;
};

const paramsDecoderMiddleware = (req, res, next) => {
  // 1. Decode Query Parameters (e.g. ?exam_id=Ng==&class_id=MQ==&academic_year_id=Mg==)
  if (req.query && typeof req.query === 'object') {
    const newQuery = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (isIdKey(key)) {
        if (Array.isArray(value)) {
          newQuery[key] = value.map((v) => decodeParam(v));
        } else {
          newQuery[key] = decodeParam(value);
        }
      } else {
        newQuery[key] = value;
      }
    }
    Object.defineProperty(req, 'query', {
      value: newQuery,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  // 2. Decode Route Path Parameters (e.g. /:id or /:classId)
  let currentParams = req.params || {};
  Object.defineProperty(req, 'params', {
    get() {
      return new Proxy(currentParams, {
        get(target, prop) {
          const val = target[prop];
          if (typeof prop === 'string' && prop in target) {
            return decodeParam(val);
          }
          return val;
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
      });
    },
    set(newParams) {
      currentParams = newParams || {};
    },
    configurable: true,
    enumerable: true,
  });

  next();
};

module.exports = paramsDecoderMiddleware;
