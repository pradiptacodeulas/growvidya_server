const { pool } = require('../config/db.config');

class FileStorageLedgerModel {
  static _initialized = false;

  /**
   * Initialize the file_storage_ledger table in MySQL
   */
  static async initTable() {
    if (FileStorageLedgerModel._initialized) return;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`file_storage_ledger\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`school_id\` INT(11) DEFAULT NULL COMMENT 'NULL or 0 for SaaS platform files; school_id for tenant files',
        \`branch_id\` INT(11) DEFAULT NULL COMMENT 'Specific branch_id or NULL/0 for school-wide files',
        \`category\` VARCHAR(64) NOT NULL DEFAULT 'general',
        \`file_path\` VARCHAR(500) NOT NULL COMMENT 'Relative path stored in application tables (upload/...)',
        \`b2_key\` VARCHAR(500) NOT NULL COMMENT 'Object key inside Backblaze B2 bucket',
        \`original_name\` VARCHAR(255) DEFAULT NULL,
        \`mime_type\` VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
        \`size_bytes\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
        \`uploaded_by\` INT(11) DEFAULT NULL,
        \`uploader_role\` VARCHAR(50) DEFAULT NULL,
        \`status\` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=Active, 4=Deleted',
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`deleted_at\` DATETIME DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_file_storage_path\` (\`file_path\`),
        KEY \`idx_ledger_school_branch_status\` (\`school_id\`, \`branch_id\`, \`status\`),
        KEY \`idx_ledger_school_category\` (\`school_id\`, \`category\`, \`status\`),
        KEY \`idx_ledger_b2_key\` (\`b2_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    FileStorageLedgerModel._initialized = true;
  }

  /**
   * Normalize any stored or requested path to canonical "upload/..." format
   */
  static normalizeFilePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '';
    let clean = rawPath.trim().replace(/\\/g, '/');
    try {
      clean = decodeURIComponent(clean);
    } catch (_) {}
    clean = clean.split('?')[0].replace(/^\/+/, '');
    if (clean.startsWith('api/v1/saas-admin/upload/')) {
      clean = clean.replace(/^api\/v1\/saas-admin\//, '');
    } else if (clean.startsWith('api/saas-admin/upload/')) {
      clean = clean.replace(/^api\/saas-admin\//, '');
    } else if (clean.startsWith('saas-admin/upload/')) {
      clean = clean.replace(/^saas-admin\//, '');
    } else if (clean.startsWith('api/v1/upload/')) {
      clean = clean.replace(/^api\/v1\//, '');
    } else if (clean.startsWith('api/upload/')) {
      clean = clean.replace(/^api\//, '');
    } else if (clean.startsWith('vidya_assets/')) {
      clean = clean.replace(/^vidya_assets\//, 'upload/');
    } else if (clean.startsWith('public/upload/')) {
      clean = clean.replace(/^public\//, '');
    }
    if (!clean.startsWith('upload/')) {
      clean = `upload/${clean}`;
    }
    return clean;
  }

  /**
   * Record a newly uploaded Backblaze B2 object in the ledger
   */
  static async recordUpload({
    schoolId = null,
    branchId = null,
    category = 'general',
    filePath,
    b2Key,
    originalName = null,
    mimeType = 'application/octet-stream',
    sizeBytes = 0,
    uploadedBy = null,
    uploaderRole = null,
  }) {
    await FileStorageLedgerModel.initTable();
    const normalizedPath = FileStorageLedgerModel.normalizeFilePath(filePath);
    const parsedSchoolId = schoolId && Number(schoolId) > 0 ? Number(schoolId) : null;
    const parsedBranchId = branchId && Number(branchId) > 0 ? Number(branchId) : null;
    const parsedSize = Math.max(0, Number(sizeBytes) || 0);
    const parsedUploader = uploadedBy && Number(uploadedBy) > 0 ? Number(uploadedBy) : null;

    const [result] = await pool.query(
      `INSERT INTO file_storage_ledger
        (school_id, branch_id, category, file_path, b2_key, original_name, mime_type, size_bytes, uploaded_by, uploader_role, status, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
        school_id = VALUES(school_id),
        branch_id = VALUES(branch_id),
        category = VALUES(category),
        b2_key = VALUES(b2_key),
        original_name = VALUES(original_name),
        mime_type = VALUES(mime_type),
        size_bytes = VALUES(size_bytes),
        uploaded_by = VALUES(uploaded_by),
        uploader_role = VALUES(uploader_role),
        status = 1,
        deleted_at = NULL`,
      [
        parsedSchoolId,
        parsedBranchId,
        String(category || 'general').slice(0, 64),
        normalizedPath,
        String(b2Key).trim(),
        originalName ? String(originalName).slice(0, 255) : null,
        String(mimeType || 'application/octet-stream').slice(0, 120),
        parsedSize,
        parsedUploader,
        uploaderRole ? String(uploaderRole).slice(0, 50) : null,
      ]
    );

    return {
      id: result.insertId,
      school_id: parsedSchoolId,
      branch_id: parsedBranchId,
      category,
      file_path: normalizedPath,
      b2_key: b2Key,
      size_bytes: parsedSize,
    };
  }

  /**
   * Look up an active file record by its relative path
   */
  static async getByFilePath(rawPath) {
    await FileStorageLedgerModel.initTable();
    const normalizedPath = FileStorageLedgerModel.normalizeFilePath(rawPath);
    if (!normalizedPath) return null;

    const [rows] = await pool.query(
      `SELECT * FROM file_storage_ledger WHERE file_path = ? AND status = 1 LIMIT 1`,
      [normalizedPath]
    );
    return rows[0] || null;
  }

  /**
   * Mark a file record as deleted (status = 4) and return its row so B2 can delete the object
   */
  static async markDeletedByPath(rawPath) {
    await FileStorageLedgerModel.initTable();
    const normalizedPath = FileStorageLedgerModel.normalizeFilePath(rawPath);
    if (!normalizedPath) return null;

    const [rows] = await pool.query(
      `SELECT * FROM file_storage_ledger WHERE file_path = ? AND status = 1 LIMIT 1`,
      [normalizedPath]
    );
    const existing = rows[0] || null;

    if (existing) {
      await pool.query(
        `UPDATE file_storage_ledger SET status = 4, deleted_at = NOW() WHERE id = ?`,
        [existing.id]
      );
    }

    return existing;
  }

  /**
   * Format bytes to human-readable string
   */
  static formatBytes(bytes, decimals = 2) {
    const num = Number(bytes);
    if (!num || num <= 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(num) / Math.log(k));
    return `${parseFloat((num / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  /**
   * Format bytes strictly into MB (e.g., "56,319.99 MB" or "0.01 MB")
   */
  static formatMB(bytes) {
    const num = Number(bytes);
    if (!num || num <= 0) return '0.00 MB';
    const mb = num / (1024 * 1024);
    if (mb > 0 && mb < 0.01) {
      return `${mb.toFixed(4)} MB`;
    }
    return `${mb.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;
  }

  /**
   * Human-readable category label
   */
  static getCategoryLabel(category) {
    const map = {
      study_material: 'Study Materials & LMS',
      student_doc: 'Student Documents',
      student_photo: 'Student Photos',
      parent_photo: 'Parent Photos',
      teacher_doc: 'Teacher Documents',
      teacher_photo: 'Teacher Photos',
      staff_doc: 'Staff Documents',
      staff_photo: 'Staff Photos',
      driver_doc: 'Transport & Driver Docs',
      driver_photo: 'Driver & Helper Photos',
      certificate: 'Certificates & ID Cards',
      leave_attachment: 'Leave Attachments',
      fee_receipt: 'Fee & Payment Receipts',
      school_logo: 'School Branding & Logos',
    };
    return map[category] || String(category || 'Other Files').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Calculate exact B2 storage used by a school (and optionally a specific branch)
   */
  static async calculateSchoolStorage(schoolId, branchId = null) {
    await FileStorageLedgerModel.initTable();
    const parsedSchoolId = Number(schoolId);
    if (!parsedSchoolId) {
      return {
        totalBytes: 0,
        totalFormatted: '0 B',
        totalMBFormatted: '0.00 MB',
        branchesUsage: [],
        categoriesBreakdown: [],
      };
    }

    const [branches] = await pool.query(
      `SELECT id, branch_name, branch_code, is_main_branch
       FROM branch_master
       WHERE school_id = ? AND status IN (1, 2)
       ORDER BY is_main_branch DESC, id ASC`,
      [parsedSchoolId]
    );

    const branchBytesMap = {};
    branches.forEach((b) => {
      branchBytesMap[b.id] = {
        branch_id: b.id,
        branch_name: b.branch_name,
        branch_code: b.branch_code,
        is_main_branch: b.is_main_branch,
        bytes: 0,
        materials_count: 0,
        documents_count: 0,
      };
    });

    const mainBranchId = (branches.find((b) => Number(b.is_main_branch) === 1) || branches[0])?.id || null;

    const [ledgerRows] = await pool.query(
      `SELECT branch_id, category, COUNT(*) AS file_count, COALESCE(SUM(size_bytes), 0) AS total_bytes
       FROM file_storage_ledger
       WHERE school_id = ? AND status = 1
       GROUP BY branch_id, category`,
      [parsedSchoolId]
    );

    const documentCategories = new Set([
      'student_doc',
      'teacher_doc',
      'staff_doc',
      'driver_doc',
      'leave_attachment',
      'fee_receipt',
    ]);

    let totalBytes = 0;
    const categoryTotalsMap = {};

    ledgerRows.forEach((row) => {
      const bytes = Number(row.total_bytes || 0);
      const count = Number(row.file_count || 0);
      const cat = String(row.category || 'general');
      totalBytes += bytes;

      const targetBranchId = row.branch_id && branchBytesMap[row.branch_id] ? row.branch_id : mainBranchId;
      if (targetBranchId && branchBytesMap[targetBranchId]) {
        branchBytesMap[targetBranchId].bytes += bytes;
        if (cat === 'study_material') {
          branchBytesMap[targetBranchId].materials_count += count;
        } else if (documentCategories.has(cat)) {
          branchBytesMap[targetBranchId].documents_count += count;
        }
      }

      if (!branchId || Number(targetBranchId) === Number(branchId)) {
        if (!categoryTotalsMap[cat]) {
          categoryTotalsMap[cat] = {
            category: cat,
            label: FileStorageLedgerModel.getCategoryLabel(cat),
            bytes: 0,
            fileCount: 0,
          };
        }
        categoryTotalsMap[cat].bytes += bytes;
        categoryTotalsMap[cat].fileCount += count;
      }
    });

    const categoriesBreakdown = Object.values(categoryTotalsMap)
      .sort((a, b) => b.bytes - a.bytes)
      .map((item) => ({
        ...item,
        mb: Number((item.bytes / (1024 * 1024)).toFixed(4)),
        mbFormatted: FileStorageLedgerModel.formatMB(item.bytes),
        formatted: FileStorageLedgerModel.formatBytes(item.bytes),
      }));

    if (branchId) {
      const bInfo = branchBytesMap[Number(branchId)] || {
        bytes: 0,
        materials_count: 0,
        documents_count: 0,
      };
      return {
        usedBytes: bInfo.bytes,
        usedFormatted: FileStorageLedgerModel.formatBytes(bInfo.bytes),
        usedMBFormatted: FileStorageLedgerModel.formatMB(bInfo.bytes),
        materialsCount: bInfo.materials_count,
        documentsCount: bInfo.documents_count,
        categoriesBreakdown,
      };
    }

    return {
      totalBytes,
      totalFormatted: FileStorageLedgerModel.formatBytes(totalBytes),
      totalMBFormatted: FileStorageLedgerModel.formatMB(totalBytes),
      categoriesBreakdown,
      branchesUsage: Object.values(branchBytesMap).map((b) => ({
        ...b,
        mb: Number((b.bytes / (1024 * 1024)).toFixed(4)),
        mbFormatted: FileStorageLedgerModel.formatMB(b.bytes),
        formatted: FileStorageLedgerModel.formatBytes(b.bytes),
      })),
    };
  }

  /**
   * Get platform-wide and per-school storage analytics for SaaS Admin
   */
  static async getAdminStorageOverview() {
    await FileStorageLedgerModel.initTable();

    const [totalsRows] = await pool.query(`
      SELECT
        COALESCE(SUM(size_bytes), 0) AS total_b2_bytes,
        COUNT(*) AS total_active_files,
        COALESCE(SUM(CASE WHEN school_id IS NOT NULL AND school_id > 0 THEN size_bytes ELSE 0 END), 0) AS schools_bytes,
        COALESCE(SUM(CASE WHEN school_id IS NULL OR school_id = 0 THEN size_bytes ELSE 0 END), 0) AS platform_bytes
      FROM file_storage_ledger
      WHERE status = 1
    `);

    const [categoryRows] = await pool.query(`
      SELECT
        category,
        COUNT(*) AS files_count,
        COALESCE(SUM(size_bytes), 0) AS total_bytes
      FROM file_storage_ledger
      WHERE status = 1
      GROUP BY category
      ORDER BY total_bytes DESC
    `);

    const [schoolRows] = await pool.query(`
      SELECT
        f.school_id,
        sm.school_name,
        sm.school_code,
        COUNT(*) AS files_count,
        COALESCE(SUM(f.size_bytes), 0) AS used_bytes
      FROM file_storage_ledger f
      LEFT JOIN school_master sm ON sm.id = f.school_id
      WHERE f.status = 1 AND f.school_id IS NOT NULL AND f.school_id > 0
      GROUP BY f.school_id, sm.school_name, sm.school_code
      ORDER BY used_bytes DESC
    `);

    const summary = totalsRows[0] || {};
    const totalB2Bytes = Number(summary.total_b2_bytes || 0);
    const schoolsBytes = Number(summary.schools_bytes || 0);
    const platformBytes = Number(summary.platform_bytes || 0);

    return {
      total_b2_bytes: totalB2Bytes,
      total_b2_formatted: FileStorageLedgerModel.formatBytes(totalB2Bytes),
      total_active_files: Number(summary.total_active_files || 0),
      schools_bytes: schoolsBytes,
      schools_formatted: FileStorageLedgerModel.formatBytes(schoolsBytes),
      platform_bytes: platformBytes,
      platform_formatted: FileStorageLedgerModel.formatBytes(platformBytes),
      by_category: categoryRows.map((r) => ({
        category: r.category,
        files_count: Number(r.files_count || 0),
        total_bytes: Number(r.total_bytes || 0),
        formatted: FileStorageLedgerModel.formatBytes(r.total_bytes),
      })),
      by_school: schoolRows.map((s) => ({
        school_id: Number(s.school_id),
        school_name: s.school_name || `School #${s.school_id}`,
        school_code: s.school_code || '',
        files_count: Number(s.files_count || 0),
        used_bytes: Number(s.used_bytes || 0),
        used_formatted: FileStorageLedgerModel.formatBytes(s.used_bytes),
      })),
    };
  }
}

module.exports = FileStorageLedgerModel;
