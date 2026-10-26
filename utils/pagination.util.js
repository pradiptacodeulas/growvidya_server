/**
 * Shared pagination helpers for list endpoints.
 *
 * Contract (used by Super Admin catalog list endpoints):
 *   Request query : ?page=1&limit=10
 *   Response data : { <listKey>: [...], pagination: {...}, counts: {...} }
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Parse and clamp `page` / `limit` from a request query object.
 * Invalid or missing values fall back to defaults; limit is capped at MAX_LIMIT.
 */
function parsePagination(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (!Number.isInteger(page) || page < 1) page = DEFAULT_PAGE;
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Build the standard pagination metadata object.
 */
function buildPagination(total, page, limit) {
  const safeTotal = Number(total) || 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / limit));
  return {
    total: safeTotal,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  buildPagination,
};
