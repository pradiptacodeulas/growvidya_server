const { pool } = require('../config/db.config');

// In-memory cache for main branch ID by schoolId to avoid redundant DB queries
const mainBranchCache = new Map();

/**
 * Universal Data-Scope Helper for Multi-Branch Isolation
 */
class DataScope {
  /**
   * Resolves the authoritative data scope from an Express request
   * @param {Object} req - Express request
   * @returns {Object} { schoolId, branchId, isSuperAdmin, registrationType, scope, userAssignedBranch, resolveBranchForCreate, applyBranchFilter }
   */
  static getDataScope(req) {
    const schoolId = req.user?.schoolId || req.user?.school_id ? Number(req.user?.schoolId || req.user?.school_id) : null;
    if (!schoolId) {
      const err = new Error('School context required. Please log in again.');
      err.statusCode = 401;
      throw err;
    }

    const adminType = Number(req.user?.adminType ?? req.user?.admin_type);
    const isSuperAdmin = Boolean(req.user?.isSuperAdmin) || adminType === 1;

    const registrationType = req.user?.registrationType || req.user?.registration_type || 'single';
    const userAssignedBranch = Number(req.user?.branchId ?? req.user?.branch_id) || null;

    let branchId = null;

    if (isSuperAdmin) {
      // Single-branch schools operate as a unified single campus; only apply explicit branch filter when registrationType === 'multiple'
      if (String(registrationType).toLowerCase() === 'multiple') {
        const queryBranch = req.query?.branch_id !== undefined ? req.query.branch_id : req.query?.branchId;
        const bodyBranch = req.body?.branch_id !== undefined ? req.body.branch_id : req.body?.branchId;
        const headerBranch = req.headers?.['x-branch-id'] || req.headers?.['x-branch'];
        const middlewareBranch = req.branchId;

        const raw = queryBranch !== undefined && queryBranch !== null && queryBranch !== ''
          ? queryBranch
          : bodyBranch !== undefined && bodyBranch !== null && bodyBranch !== ''
          ? bodyBranch
          : headerBranch !== undefined && headerBranch !== null && headerBranch !== ''
          ? headerBranch
          : middlewareBranch;

        if (raw !== undefined && raw !== null && raw !== '' && raw !== 'all' && raw !== '0' && raw !== 0) {
          branchId = Number(raw) || null;
        } else {
          branchId = null; // Consolidated
        }
      } else {
        branchId = null;
      }
    } else {
      // Non-SuperAdmin (Branch Admin, Teacher, Student, Parent, Staff) is STRICTLY pinned to assigned branch
      branchId = userAssignedBranch;
    }

    const scope = branchId ? (isSuperAdmin ? 'SELECTED_BRANCH' : 'BRANCH') : 'ALL_BRANCHES';

    return {
      schoolId,
      branchId,
      isSuperAdmin,
      registrationType,
      userAssignedBranch,
      scope,
      hasBranch: Boolean(branchId),

      /**
       * Resolve the branch_id to use when CREATING or INSERTING a branch-level record.
       * Branch-level records must always have a valid branch_id.
       */
      async resolveBranchForCreate(explicitBranchId = null) {
        if (!isSuperAdmin && userAssignedBranch) {
          return userAssignedBranch;
        }

        const candidate = explicitBranchId || branchId;
        if (candidate && candidate !== 'all' && candidate !== '0' && candidate !== 0) {
          const num = Number(candidate);
          // Verify candidate belongs to this school
          try {
            const [bRows] = await pool.query(
              'SELECT id FROM branch_master WHERE id = ? AND school_id = ? AND status != 4 LIMIT 1',
              [num, schoolId]
            );
            if (bRows && bRows.length > 0) return num;
          } catch (e) {}
        }

        // Fallback to School's main branch
        return await DataScope.getMainBranchId(schoolId);
      },

      /**
       * Generates a SQL WHERE fragment and parameters for branch filtering
       * @param {string} colName - column name (e.g. 'branch_id' or 'c.branch_id')
       * @param {boolean} allowLegacyNull - whether to include (col = ? OR col IS NULL)
       */
      applyBranchFilter(colName = 'branch_id', allowLegacyNull = true) {
        if (!branchId) {
          return { sql: '', params: [] };
        }
        if (allowLegacyNull) {
          return {
            sql: ` AND (${colName} = ? OR ${colName} IS NULL)`,
            params: [branchId],
          };
        }
        return {
          sql: ` AND ${colName} = ?`,
          params: [branchId],
        };
      },
    };
  }

  /**
   * Retrieves the main branch ID for a school (active or inactive only; excludes soft-deleted status = 4)
   * @param {number} schoolId
   * @returns {Promise<number|null>}
   */
  static async getMainBranchId(schoolId) {
    const parsedSchoolId = Number(schoolId);
    if (!parsedSchoolId) return null;
    if (mainBranchCache.has(parsedSchoolId)) {
      return mainBranchCache.get(parsedSchoolId);
    }
    try {
      const [rows] = await pool.query(
        'SELECT id FROM branch_master WHERE school_id = ? AND status IN (1, 2) ORDER BY is_main_branch DESC, id ASC LIMIT 1',
        [parsedSchoolId]
      );
      if (rows && rows.length > 0) {
        const id = rows[0].id;
        mainBranchCache.set(parsedSchoolId, id);
        return id;
      }
    } catch (e) {
      console.error('[DataScope.getMainBranchId] Error:', e.message);
    }
    return null;
  }

  /**
   * Invalidates the cached main branch ID for a school
   * @param {number} schoolId
   */
  static invalidateMainBranchCache(schoolId = null) {
    if (schoolId) {
      mainBranchCache.delete(Number(schoolId));
    } else {
      mainBranchCache.clear();
    }
  }

  /**
   * Checks whether a record with the same unique field value already exists in this school & branch.
   */
  static async checkDuplicate({
    table,
    schoolId,
    branchId = null,
    field,
    value,
    excludeId = null,
    extraConditions = [],
    allowLegacyNull = true,
  }) {
    if (!value || !String(value).trim()) return false;
    const cleanVal = String(value).trim();

    let sql = `SELECT id FROM \`${table}\` WHERE school_id = ? AND LOWER(TRIM(\`${field}\`)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
    const params = [schoolId, cleanVal];

    if (branchId) {
      if (allowLegacyNull) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      } else {
        sql += ` AND branch_id = ?`;
      }
      params.push(Number(branchId));
    }

    if (excludeId) {
      sql += ` AND id != ?`;
      params.push(excludeId);
    }

    for (const cond of extraConditions) {
      sql += ` AND ${cond.sql}`;
      params.push(...cond.params);
    }

    sql += ` LIMIT 1`;
    const [rows] = await pool.query(sql, params);
    return rows.length > 0;
  }
}

module.exports = DataScope;
