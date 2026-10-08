const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db.config');
const SubscriptionModel = require('./subscription.model');

class SuperAdminModel {
  /**
   * Format bytes to human readable format (e.g. 14.6 KB, 1.2 GB)
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
   * Real file size checker on disk
   */
  static getFileSizeOnDisk(relativePath) {
    if (!relativePath || typeof relativePath !== 'string') return 0;
    try {
      const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
      const baseDir = path.resolve(__dirname, '..', 'public');
      const fullPath = path.join(baseDir, cleanPath);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        return stat.isFile() ? stat.size : 0;
      }
    } catch (e) {
      // Ignore missing files or permission errors
    }
    return 0;
  }

  /**
   * Calculate real storage used by school and branches
   */
  static async calculateRealStorage(schoolId, branchId = null) {
    const parsedSchoolId = Number(schoolId);
    let totalBytes = 0;
    const branchBytesMap = {};

    // Initialize branchBytesMap for active branches
    const [branches] = await pool.query(
      `SELECT id, branch_name, branch_code, is_main_branch FROM branch_master WHERE school_id = ? AND status IN (1, 2)`,
      [parsedSchoolId]
    );
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

    // 1. Study Materials (has attachment_size & attachment)
    const [materials] = await pool.query(
      `SELECT id, branch_id, attachment, attachment_size FROM study_materials WHERE school_id = ? AND status != 4`,
      [parsedSchoolId]
    );
    materials.forEach((m) => {
      let size = Number(m.attachment_size) || 0;
      if (size <= 0 && m.attachment) {
        size = SuperAdminModel.getFileSizeOnDisk(m.attachment);
      }
      totalBytes += size;
      const bId = m.branch_id || (branches[0] ? branches[0].id : null);
      if (bId && branchBytesMap[bId]) {
        branchBytesMap[bId].bytes += size;
        branchBytesMap[bId].materials_count += 1;
      }
    });

    // 2. Student Documents
    const [studentDocs] = await pool.query(
      `SELECT sd.id, sd.attachments, sm.branch_id 
       FROM student_document sd 
       JOIN student_master sm ON sd.student_id = sm.id 
       WHERE sd.school_id = ? AND sd.status != 4`,
      [parsedSchoolId]
    );
    studentDocs.forEach((sd) => {
      const size = SuperAdminModel.getFileSizeOnDisk(sd.attachments);
      totalBytes += size;
      const bId = sd.branch_id || (branches[0] ? branches[0].id : null);
      if (bId && branchBytesMap[bId]) {
        branchBytesMap[bId].bytes += size;
        branchBytesMap[bId].documents_count += 1;
      }
    });

    // 3. Teacher Documents
    const [teacherDocs] = await pool.query(
      `SELECT td.id, td.attachments, tm.branch_id 
       FROM teacher_document td 
       JOIN teacher_master tm ON td.teacher_id = tm.id 
       WHERE td.school_id = ? AND td.status != 4`,
      [parsedSchoolId]
    );
    teacherDocs.forEach((td) => {
      const size = SuperAdminModel.getFileSizeOnDisk(td.attachments);
      totalBytes += size;
      const bId = td.branch_id || (branches[0] ? branches[0].id : null);
      if (bId && branchBytesMap[bId]) {
        branchBytesMap[bId].bytes += size;
        branchBytesMap[bId].documents_count += 1;
      }
    });

    // 4. Staff / User Documents
    const [userDocs] = await pool.query(
      `SELECT ud.id, ud.attachments, um.branch_id 
       FROM user_document ud 
       JOIN user_master um ON ud.user_id = um.id 
       WHERE ud.school_id = ? AND ud.status != 4`,
      [parsedSchoolId]
    );
    userDocs.forEach((ud) => {
      const size = SuperAdminModel.getFileSizeOnDisk(ud.attachments);
      totalBytes += size;
      const bId = ud.branch_id || (branches[0] ? branches[0].id : null);
      if (bId && branchBytesMap[bId]) {
        branchBytesMap[bId].bytes += size;
        branchBytesMap[bId].documents_count += 1;
      }
    });

    // 5. School Logo & Branding
    const [sch] = await pool.query(`SELECT school_logo FROM school_master WHERE id = ?`, [parsedSchoolId]);
    if (sch[0]?.school_logo) {
      const logoSize = SuperAdminModel.getFileSizeOnDisk(sch[0].school_logo);
      totalBytes += logoSize;
      const mainB = branches.find((b) => b.is_main_branch === 1) || branches[0];
      if (mainB && branchBytesMap[mainB.id]) {
        branchBytesMap[mainB.id].bytes += logoSize;
      }
    }

    // 6. User and Student Profile Pictures
    const [pics] = await pool.query(
      `SELECT picture, branch_id FROM student_master WHERE school_id = ? AND picture IS NOT NULL AND status != 4`,
      [parsedSchoolId]
    );
    pics.forEach((p) => {
      const size = SuperAdminModel.getFileSizeOnDisk(p.picture);
      totalBytes += size;
      if (p.branch_id && branchBytesMap[p.branch_id]) {
        branchBytesMap[p.branch_id].bytes += size;
      }
    });

    // If specific branch requested, return branch's storage
    if (branchId) {
      const bInfo = branchBytesMap[Number(branchId)] || { bytes: 0, materials_count: 0, documents_count: 0 };
      return {
        usedBytes: bInfo.bytes,
        usedFormatted: SuperAdminModel.formatBytes(bInfo.bytes),
        materialsCount: bInfo.materials_count,
        documentsCount: bInfo.documents_count,
      };
    }

    return {
      totalBytes,
      totalFormatted: SuperAdminModel.formatBytes(totalBytes),
      branchesUsage: Object.values(branchBytesMap).map((b) => ({
        ...b,
        formatted: SuperAdminModel.formatBytes(b.bytes),
      })),
    };
  }

  /**
   * Get Storage Allocation for the school from subscription / storage_master
   */
  static async getStorageAllocation(schoolId) {
    const parsedSchoolId = Number(schoolId);
    const [subRows] = await pool.query(
      `SELECT s.id, s.storage_plan_id, sm.storage_capacity, sm.capacity_unit_id, cu.unit_name 
       FROM school_subscriptions s
       LEFT JOIN storage_master sm ON s.storage_plan_id = sm.id
       LEFT JOIN capacity_unit_master cu ON sm.capacity_unit_id = cu.id
       WHERE s.school_id = ? AND s.status IN ('active', 'trial')
       ORDER BY s.id DESC LIMIT 1`,
      [parsedSchoolId]
    );

    let allocatedBytes = 5 * 1024 * 1024 * 1024; // Default 5 GB base SaaS allocation
    let planName = '5 GB Included Storage';

    if (subRows.length > 0 && subRows[0].storage_capacity) {
      const cap = Number(subRows[0].storage_capacity);
      const unit = subRows[0].capacity_unit_id; // 1: MB, 2: GB, 3: TB
      if (unit === 3) {
        allocatedBytes = cap * 1024 * 1024 * 1024 * 1024;
        planName = `${cap} TB Storage Plan`;
      } else if (unit === 1) {
        allocatedBytes = cap * 1024 * 1024;
        planName = `${cap} MB Storage Plan`;
      } else {
        allocatedBytes = cap * 1024 * 1024 * 1024;
        planName = `${cap} GB Storage Plan`;
      }
    }

    return {
      allocatedBytes,
      allocatedFormatted: SuperAdminModel.formatBytes(allocatedBytes),
      planName,
    };
  }

  /**
   * Get Consolidated Organization Stats & KPI cards
   */
  static async getOrganizationStats(schoolId, branchId = null) {
    const parsedSchoolId = Number(schoolId);
    const parsedBranchId = branchId ? Number(branchId) : null;

    if (!parsedSchoolId) {
      throw new Error('Valid schoolId is required.');
    }

    // 1. School Information
    const [schoolRows] = await pool.query(
      `SELECT id, school_name, school_code, school_logo, registration_type, email, phone_number, website, address 
       FROM school_master WHERE id = ? LIMIT 1`,
      [parsedSchoolId]
    );
    const school = schoolRows[0] || {};

    // 2. Branch Counts
    const [branchStats] = await pool.query(
      `SELECT 
         COUNT(*) as total_branches,
         SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_branches,
         SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as inactive_branches
       FROM branch_master 
       WHERE school_id = ? AND status IN (1, 2)`,
      [parsedSchoolId]
    );
    const totalBranches = Number(branchStats[0]?.total_branches || 0);
    const activeBranches = Number(branchStats[0]?.active_branches || 0);
    const inactiveBranches = Number(branchStats[0]?.inactive_branches || 0);

    // 3. Students Count
    let stuSql = `SELECT status, COUNT(*) as count FROM student_master WHERE school_id = ? AND status != 4`;
    const stuParams = [parsedSchoolId];
    if (parsedBranchId) {
      stuSql += ` AND branch_id = ?`;
      stuParams.push(parsedBranchId);
    }
    stuSql += ` GROUP BY status`;
    const [stuRows] = await pool.query(stuSql, stuParams);

    let activeStudents = 0, inactiveStudents = 0, totalStudents = 0;
    stuRows.forEach((r) => {
      const c = Number(r.count);
      if (r.status === 1) activeStudents += c;
      else inactiveStudents += c;
      totalStudents += c;
    });

    // 4. Teachers Count
    let tchSql = `SELECT status, COUNT(*) as count FROM teacher_master WHERE school_id = ? AND status != 4`;
    const tchParams = [parsedSchoolId];
    if (parsedBranchId) {
      tchSql += ` AND branch_id = ?`;
      tchParams.push(parsedBranchId);
    }
    tchSql += ` GROUP BY status`;
    const [tchRows] = await pool.query(tchSql, tchParams);

    let activeTeachers = 0, inactiveTeachers = 0, totalTeachers = 0;
    tchRows.forEach((r) => {
      const c = Number(r.count);
      if (r.status === 1) activeTeachers += c;
      else inactiveTeachers += c;
      totalTeachers += c;
    });

    // 5. Staff Users Count
    let usrSql = `SELECT status, COUNT(*) as count FROM user_master WHERE school_id = ? AND status != 4`;
    const usrParams = [parsedSchoolId];
    if (parsedBranchId) {
      usrSql += ` AND branch_id = ?`;
      usrParams.push(parsedBranchId);
    }
    usrSql += ` GROUP BY status`;
    const [usrRows] = await pool.query(usrSql, usrParams);

    let activeStaff = 0, inactiveStaff = 0, totalStaff = 0;
    usrRows.forEach((r) => {
      const c = Number(r.count);
      if (r.status === 1) activeStaff += c;
      else inactiveStaff += c;
      totalStaff += c;
    });

    // 6. Total Classes Count
    let clsSql = `SELECT COUNT(*) as count FROM class_master WHERE school_id = ? AND status = 1`;
    const clsParams = [parsedSchoolId];
    if (parsedBranchId) {
      clsSql += ` AND branch_id = ?`;
      clsParams.push(parsedBranchId);
    }
    const [clsRows] = await pool.query(clsSql, clsParams);
    const totalClasses = Number(clsRows[0]?.count || 0);

    // 7. Fees Summary (from fee_invoices)
    let feeSql = `SELECT 
       COALESCE(SUM(total_amount), 0) AS total_invoiced,
       COALESCE(SUM(paid_amount), 0) AS total_paid,
       COALESCE(SUM(due_amount), 0) AS total_due
     FROM fee_invoices 
     WHERE school_id = ? AND status != 4`;
    const feeParams = [parsedSchoolId];
    if (parsedBranchId) {
      feeSql += ` AND branch_id = ?`;
      feeParams.push(parsedBranchId);
    }
    const [feeRows] = await pool.query(feeSql, feeParams);
    const totalFeesInvoiced = Number(feeRows[0]?.total_invoiced || 0);
    const totalFeesCollected = Number(feeRows[0]?.total_paid || 0);
    const totalOutstandingFees = Number(feeRows[0]?.total_due || 0);

    // 8. Salary & Payroll Summary (from employee_salary)
    let salSql = `SELECT 
       COALESCE(SUM(basic_salary), 0) AS total_basic,
       COALESCE(SUM(total_deductions), 0) AS total_deductions,
       COALESCE(SUM(net_salary), 0) AS total_net
     FROM employee_salary 
     WHERE school_id = ?`;
    const salParams = [parsedSchoolId];
    if (parsedBranchId) {
      salSql += ` AND branch_id = ?`;
      salParams.push(parsedBranchId);
    }
    const [salRows] = await pool.query(salSql, salParams);
    const totalBasicSalary = Number(salRows[0]?.total_basic || 0);
    const totalDeductions = Number(salRows[0]?.total_deductions || 0);
    const totalSalaryPayout = Number(salRows[0]?.total_net || 0);

    // 9. Real Storage Metrics
    const storageData = await SuperAdminModel.calculateRealStorage(parsedSchoolId, parsedBranchId);
    const allocationData = await SuperAdminModel.getStorageAllocation(parsedSchoolId);

    const usedBytes = parsedBranchId ? storageData.usedBytes : storageData.totalBytes;
    const allocatedBytes = allocationData.allocatedBytes;
    const availableBytes = Math.max(0, allocatedBytes - usedBytes);
    const storagePercentage = allocatedBytes > 0 ? parseFloat(((usedBytes / allocatedBytes) * 100).toFixed(2)) : 0;

    let warningLevel = 'normal';
    if (storagePercentage >= 100) {
      warningLevel = 'limit_reached';
    } else if (storagePercentage >= 90) {
      warningLevel = 'critical';
    } else if (storagePercentage >= 75) {
      warningLevel = 'warning';
    }

    // 10. Subscription Plan & Limit Enforcement
    const subscription = await SubscriptionModel.getSchoolSubscription(parsedSchoolId);
    const allowedStudents = subscription?.max_students ? Number(subscription.max_students) : 0;
    const allowedBranches = 10; // Default max branches or as per tier

    return {
      school: {
        id: school.id,
        name: school.school_name,
        code: school.school_code,
        logo: school.school_logo,
        registrationType: school.registration_type || 'single',
        email: school.email,
        phone: school.phone_number,
        address: school.address,
      },
      branches: {
        total: totalBranches,
        active: activeBranches,
        inactive: inactiveBranches,
      },
      students: {
        active: activeStudents,
        inactive: inactiveStudents,
        total: totalStudents,
        allowed: allowedStudents,
      },
      teachers: {
        active: activeTeachers,
        inactive: inactiveTeachers,
        total: totalTeachers,
      },
      staff: {
        active: activeStaff,
        inactive: inactiveStaff,
        total: totalStaff,
      },
      classes: {
        total: totalClasses,
      },
      fees: {
        totalInvoiced: totalFeesInvoiced,
        collected: totalFeesCollected,
        outstanding: totalOutstandingFees,
      },
      salary: {
        basic: totalBasicSalary,
        deductions: totalDeductions,
        payout: totalSalaryPayout,
        netSalary: totalSalaryPayout,
      },
      storage: {
        usedBytes,
        usedFormatted: SuperAdminModel.formatBytes(usedBytes),
        allocatedBytes,
        allocatedFormatted: allocationData.allocatedFormatted,
        availableBytes,
        availableFormatted: SuperAdminModel.formatBytes(availableBytes),
        percentage: storagePercentage,
        warningLevel,
        planName: allocationData.planName,
        branchesBreakdown: parsedBranchId ? [] : storageData.branchesUsage || [],
      },
      subscription: {
        planName: subscription?.plan_name || 'No Active Plan',
        planCode: subscription?.plan_code || 'N/A',
        billingCycle: subscription?.billing_cycle || 'N/A',
        startDate: subscription?.start_date || null,
        endDate: subscription?.end_date || null,
        daysLeft: subscription?.days_left !== undefined ? subscription.days_left : 0,
        status: subscription?.liveStatus || subscription?.status || 'inactive',
        isTrial: Boolean(subscription?.isTrial),
        isExpired: Boolean(subscription?.isExpired),
        allowedStudents,
        usedStudents: totalStudents,
        allowedBranches,
        usedBranches: activeBranches,
      },
      filter: {
        isFiltered: Boolean(parsedBranchId),
        branchId: parsedBranchId,
      },
    };
  }

  /**
   * Get Branch Performance Overview Table Data
   */
  static async getBranchesPerformance(schoolId) {
    const parsedSchoolId = Number(schoolId);
    if (!parsedSchoolId) {
      throw new Error('Valid schoolId is required.');
    }

    // 1. Fetch branches with head user info
    const [branches] = await pool.query(
      `SELECT 
        b.id,
        b.branch_name,
        b.branch_code,
        b.head_user_id,
        b.address,
        b.phone,
        b.email,
        b.principal_name,
        b.is_main_branch,
        b.status,
        b.created_at,
        u.first_name AS head_first_name,
        u.last_name AS head_last_name,
        u.email AS head_email,
        u.phone AS head_phone,
        u.picture AS head_picture,
        r.role_name AS head_role
      FROM branch_master b
      LEFT JOIN user_master u ON b.head_user_id = u.id
      LEFT JOIN role_master r ON u.role = r.id
      WHERE b.school_id = ? AND b.status IN (1, 2)
      ORDER BY b.is_main_branch DESC, b.branch_name ASC`,
      [parsedSchoolId]
    );

    // 2. Fetch real student counts per branch
    const [studentsByBranch] = await pool.query(
      `SELECT branch_id, COUNT(*) as count 
       FROM student_master 
       WHERE school_id = ? AND status = 1 
       GROUP BY branch_id`,
      [parsedSchoolId]
    );
    const stuCountMap = {};
    studentsByBranch.forEach((s) => {
      stuCountMap[s.branch_id] = Number(s.count);
    });

    // 3. Fetch real teacher counts per branch
    const [teachersByBranch] = await pool.query(
      `SELECT branch_id, COUNT(*) as count 
       FROM teacher_master 
       WHERE school_id = ? AND status = 1 
       GROUP BY branch_id`,
      [parsedSchoolId]
    );
    const tchCountMap = {};
    teachersByBranch.forEach((t) => {
      tchCountMap[t.branch_id] = Number(t.count);
    });

    // 4. Fetch real staff counts per branch
    const [staffByBranch] = await pool.query(
      `SELECT branch_id, COUNT(*) as count 
       FROM user_master 
       WHERE school_id = ? AND status = 1 
       GROUP BY branch_id`,
      [parsedSchoolId]
    );
    const staffCountMap = {};
    staffByBranch.forEach((st) => {
      staffCountMap[st.branch_id] = Number(st.count);
    });

    // 5. Fetch real class counts per branch
    const [classesByBranch] = await pool.query(
      `SELECT branch_id, COUNT(*) as count 
       FROM class_master 
       WHERE school_id = ? AND status = 1 
       GROUP BY branch_id`,
      [parsedSchoolId]
    );
    const classCountMap = {};
    classesByBranch.forEach((c) => {
      classCountMap[c.branch_id] = Number(c.count);
    });

    // 6. Fetch real fees collected and outstanding per branch
    const [feesByBranch] = await pool.query(
      `SELECT 
         branch_id, 
         COALESCE(SUM(paid_amount), 0) as collected,
         COALESCE(SUM(due_amount), 0) as outstanding
       FROM fee_invoices 
       WHERE school_id = ? AND status != 4 
       GROUP BY branch_id`,
      [parsedSchoolId]
    );
    const feesMap = {};
    feesByBranch.forEach((f) => {
      feesMap[f.branch_id] = {
        collected: Number(f.collected),
        outstanding: Number(f.outstanding),
      };
    });

    // 7. Fetch real salary payout per branch
    const [salaryByBranch] = await pool.query(
      `SELECT 
         branch_id, 
         COALESCE(SUM(net_salary), 0) as net_salary 
       FROM employee_salary 
       WHERE school_id = ? 
       GROUP BY branch_id`,
      [parsedSchoolId]
    );
    const salaryMap = {};
    salaryByBranch.forEach((s) => {
      salaryMap[s.branch_id] = Number(s.net_salary);
    });

    // 8. Fetch real storage used per branch
    const storageSummary = await SuperAdminModel.calculateRealStorage(parsedSchoolId);
    const branchStorageMap = {};
    (storageSummary.branchesUsage || []).forEach((b) => {
      branchStorageMap[b.branch_id] = b;
    });

    // 9. Compose comprehensive branch metrics
    return branches.map((b) => {
      const bId = b.id;
      const headName = b.head_first_name
        ? `${b.head_first_name} ${b.head_last_name || ''}`.trim()
        : b.principal_name || 'Not Assigned';
      const bStorage = branchStorageMap[bId] || { bytes: 0, formatted: '0 B' };

      return {
        id: b.id,
        branchName: b.branch_name,
        branchCode: b.branch_code,
        isMainBranch: Boolean(b.is_main_branch),
        principalName: headName,
        headEmail: b.head_email || b.email || null,
        headPhone: b.head_phone || b.phone || null,
        headPicture: b.head_picture || null,
        headRole: b.head_role || (headName !== 'Not Assigned' ? 'Branch Head' : 'Not Assigned'),
        address: b.address || '',
        phone: b.phone || '',
        email: b.email || '',
        status: b.status === 1 ? 'Active' : 'Inactive',
        statusCode: b.status,
        studentsCount: stuCountMap[bId] || 0,
        teachersCount: tchCountMap[bId] || 0,
        staffCount: staffCountMap[bId] || 0,
        classesCount: classCountMap[bId] || 0,
        feesCollected: feesMap[bId]?.collected || 0,
        feesOutstanding: feesMap[bId]?.outstanding || 0,
        salaryPayout: salaryMap[bId] || 0,
        storageBytes: bStorage.bytes,
        storageFormatted: bStorage.formatted,
        createdAt: b.created_at,
      };
    });
  }

  /**
   * Get Single Branch Drill-Down Details
   */
  static async getBranchDetails(schoolId, branchId) {
    const parsedSchoolId = Number(schoolId);
    const parsedBranchId = Number(branchId);

    if (!parsedSchoolId || !parsedBranchId) {
      throw new Error('Valid schoolId and branchId are required.');
    }

    // 1. Fetch branch basic info with location lookup
    const [branches] = await pool.query(
      `SELECT 
        b.*,
        co.name AS country_name,
        s.state AS state_name,
        ct.name AS city_name,
        u.first_name AS head_first_name,
        u.last_name AS head_last_name,
        u.email AS head_email,
        u.phone AS head_phone,
        u.picture AS head_picture,
        r.role_name AS head_role
      FROM branch_master b
      LEFT JOIN countries co ON b.country_id = co.id
      LEFT JOIN states s ON b.state_id = s.id_state
      LEFT JOIN cities ct ON b.city_id = ct.id
      LEFT JOIN user_master u ON b.head_user_id = u.id
      LEFT JOIN role_master r ON u.role = r.id
      WHERE b.id = ? AND b.school_id = ? AND b.status IN (1, 2)
      LIMIT 1`,
      [parsedBranchId, parsedSchoolId]
    );

    if (branches.length === 0) {
      return null;
    }

    const b = branches[0];
    const headFullName = b.head_first_name
      ? `${b.head_first_name} ${b.head_last_name || ''}`.trim()
      : b.principal_name || 'Not Assigned';

    // 2. Academic Stats
    const [stuStats] = await pool.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END) as inactive
       FROM student_master 
       WHERE school_id = ? AND branch_id = ? AND status != 4`,
      [parsedSchoolId, parsedBranchId]
    );

    const [tchStats] = await pool.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END) as inactive
       FROM teacher_master 
       WHERE school_id = ? AND branch_id = ? AND status != 4`,
      [parsedSchoolId, parsedBranchId]
    );

    const [clsStats] = await pool.query(
      `SELECT COUNT(*) as count FROM class_master WHERE school_id = ? AND branch_id = ? AND status = 1`,
      [parsedSchoolId, parsedBranchId]
    );

    const [secStats] = await pool.query(
      `SELECT COUNT(*) as count FROM section_master WHERE school_id = ? AND branch_id = ? AND status = 1`,
      [parsedSchoolId, parsedBranchId]
    );

    // Today's attendance
    const [stuAtt] = await pool.query(
      `SELECT attendance, COUNT(*) as count 
       FROM student_attendance 
       WHERE school_id = ? AND branch_id = ? AND date = CURDATE() AND status != 4
       GROUP BY attendance`,
      [parsedSchoolId, parsedBranchId]
    );
    let stuPresent = 0, stuAbsent = 0, stuLate = 0;
    stuAtt.forEach((r) => {
      if (r.attendance === 1) stuPresent += Number(r.count);
      else if (r.attendance === 0) stuAbsent += Number(r.count);
      else if (r.attendance === 2) stuLate += Number(r.count);
    });

    // 3. Financial Stats
    const [feeStats] = await pool.query(
      `SELECT 
         COALESCE(SUM(total_amount), 0) AS total_invoiced,
         COALESCE(SUM(paid_amount), 0) AS total_paid,
         COALESCE(SUM(due_amount), 0) AS total_due
       FROM fee_invoices 
       WHERE school_id = ? AND branch_id = ? AND status != 4`,
      [parsedSchoolId, parsedBranchId]
    );

    const [salStats] = await pool.query(
      `SELECT 
         COALESCE(SUM(basic_salary), 0) AS total_basic,
         COALESCE(SUM(total_deductions), 0) AS total_deductions,
         COALESCE(SUM(net_salary), 0) AS total_net
       FROM employee_salary 
       WHERE school_id = ? AND branch_id = ?`,
      [parsedSchoolId, parsedBranchId]
    );

    // Recent payments for this branch
    const [recentPayments] = await pool.query(
      `SELECT fp.id, fp.txn_no, fp.receipt_no, fp.amount_paid, fp.payment_date, fp.payment_method,
              sm.first_name, sm.last_name, cm.class_name
       FROM fee_payments fp
       JOIN student_master sm ON fp.student_id = sm.id
       LEFT JOIN class_master cm ON sm.class = cm.id
       WHERE fp.school_id = ? AND (fp.branch_id = ? OR sm.branch_id = ?)
       ORDER BY fp.id DESC LIMIT 5`,
      [parsedSchoolId, parsedBranchId, parsedBranchId]
    );

    // 4. Storage for this branch
    const storageInfo = await SuperAdminModel.calculateRealStorage(parsedSchoolId, parsedBranchId);

    // 5. Staff Roster (Teachers and Staff users)
    const [staffUsers] = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.picture, u.status, r.role_name
       FROM user_master u
       LEFT JOIN role_master r ON u.role = r.id
       WHERE u.school_id = ? AND u.branch_id = ? AND u.status != 4
       ORDER BY u.id ASC LIMIT 10`,
      [parsedSchoolId, parsedBranchId]
    );

    const [teachers] = await pool.query(
      `SELECT id, first_name, last_name, email_address AS email, primary_contact_number AS phone, picture, status, qualification 
       FROM teacher_master 
       WHERE school_id = ? AND branch_id = ? AND status != 4 
       ORDER BY id ASC LIMIT 10`,
      [parsedSchoolId, parsedBranchId]
    );

    return {
      overview: {
        id: b.id,
        branchName: b.branch_name,
        branchCode: b.branch_code,
        isMainBranch: Boolean(b.is_main_branch),
        principalName: headFullName,
        headEmail: b.head_email || b.email,
        headPhone: b.head_phone || b.phone,
        headRole: b.head_role || (headFullName !== 'Not Assigned' ? 'Branch Head' : 'Not Assigned'),
        headPicture: b.head_picture,
        address: b.address || '',
        city: b.city_name || '',
        state: b.state_name || '',
        country: b.country_name || '',
        pincode: b.pincode || '',
        phone: b.phone || '',
        email: b.email || '',
        status: b.status === 1 ? 'Active' : 'Inactive',
        statusCode: b.status,
        createdAt: b.created_at,
      },
      academic: {
        students: {
          total: Number(stuStats[0]?.total || 0),
          active: Number(stuStats[0]?.active || 0),
          inactive: Number(stuStats[0]?.inactive || 0),
        },
        teachers: {
          total: Number(tchStats[0]?.total || 0),
          active: Number(tchStats[0]?.active || 0),
          inactive: Number(tchStats[0]?.inactive || 0),
        },
        classesCount: Number(clsStats[0]?.count || 0),
        sectionsCount: Number(secStats[0]?.count || 0),
        attendanceToday: {
          present: stuPresent,
          absent: stuAbsent,
          late: stuLate,
        },
      },
      finance: {
        feesInvoiced: Number(feeStats[0]?.total_invoiced || 0),
        feesCollected: Number(feeStats[0]?.total_paid || 0),
        feesOutstanding: Number(feeStats[0]?.total_due || 0),
        salaryBasic: Number(salStats[0]?.total_basic || 0),
        salaryDeductions: Number(salStats[0]?.total_deductions || 0),
        salaryPayout: Number(salStats[0]?.total_net || 0),
        recentPayments: (recentPayments || []).map((p) => ({
          id: p.id,
          txnNo: p.txn_no,
          receiptNo: p.receipt_no,
          amountPaid: Number(p.amount_paid),
          paymentDate: p.payment_date,
          paymentMethod: p.payment_method,
          studentName: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          className: p.class_name || 'N/A',
        })),
      },
      storage: {
        usedBytes: storageInfo.usedBytes,
        usedFormatted: storageInfo.usedFormatted,
        materialsCount: storageInfo.materialsCount,
        documentsCount: storageInfo.documentsCount,
      },
      staff: {
        teachers: teachers.map((t) => ({
          id: t.id,
          name: `${t.first_name} ${t.last_name || ''}`.trim(),
          email: t.email,
          phone: t.phone,
          qualification: t.qualification,
          status: t.status === 1 ? 'Active' : 'Inactive',
        })),
        users: staffUsers.map((u) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name || ''}`.trim(),
          email: u.email,
          phone: u.phone,
          role: u.role_name || 'Staff',
          status: u.status === 1 ? 'Active' : 'Inactive',
        })),
      },
    };
  }

  /**
   * Get Storage Breakdown across all branches
   */
  static async getStorageBreakdown(schoolId) {
    const parsedSchoolId = Number(schoolId);
    const storageData = await SuperAdminModel.calculateRealStorage(parsedSchoolId);
    const allocationData = await SuperAdminModel.getStorageAllocation(parsedSchoolId);

    const totalUsed = storageData.totalBytes;
    const totalAllocated = allocationData.allocatedBytes;
    const remaining = Math.max(0, totalAllocated - totalUsed);
    const percentage = totalAllocated > 0 ? parseFloat(((totalUsed / totalAllocated) * 100).toFixed(2)) : 0;

    let warningLevel = 'normal';
    if (percentage >= 100) {
      warningLevel = 'limit_reached';
    } else if (percentage >= 90) {
      warningLevel = 'critical';
    } else if (percentage >= 75) {
      warningLevel = 'warning';
    }

    const branchesWithPercentages = (storageData.branchesUsage || []).map((b) => {
      const bPct = totalUsed > 0 ? parseFloat(((b.bytes / totalUsed) * 100).toFixed(2)) : 0;
      return {
        ...b,
        percentageOfTotalUsed: bPct,
      };
    });

    return {
      totalAllocationBytes: totalAllocated,
      totalAllocationFormatted: allocationData.allocatedFormatted,
      totalUsedBytes: totalUsed,
      totalUsedFormatted: storageData.totalFormatted,
      remainingBytes: remaining,
      remainingFormatted: SuperAdminModel.formatBytes(remaining),
      usagePercentage: percentage,
      warningLevel,
      planName: allocationData.planName,
      branches: branchesWithPercentages,
    };
  }

  /**
   * Get Subscription Usage Limits vs Consumed
   */
  static async getSubscriptionUsage(schoolId) {
    const parsedSchoolId = Number(schoolId);
    const subscription = await SubscriptionModel.getSchoolSubscription(parsedSchoolId);
    const [stuCount] = await pool.query(
      `SELECT COUNT(*) as count FROM student_master WHERE school_id = ? AND status = 1`,
      [parsedSchoolId]
    );
    const [branchCount] = await pool.query(
      `SELECT COUNT(*) as count FROM branch_master WHERE school_id = ? AND status = 1`,
      [parsedSchoolId]
    );
    const [teacherCount] = await pool.query(
      `SELECT COUNT(*) as count FROM teacher_master WHERE school_id = ? AND status = 1`,
      [parsedSchoolId]
    );
    const [staffCount] = await pool.query(
      `SELECT COUNT(*) as count FROM user_master WHERE school_id = ? AND status = 1`,
      [parsedSchoolId]
    );

    const storageBreakdown = await SuperAdminModel.getStorageBreakdown(parsedSchoolId);

    const allowedStudents = subscription?.max_students ? Number(subscription.max_students) : 0;
    const usedStudents = Number(stuCount[0]?.count || 0);

    const allowedBranches = 10;
    const usedBranches = Number(branchCount[0]?.count || 0);

    return {
      currentPlan: subscription?.plan_name || 'No Active Plan',
      planCode: subscription?.plan_code || 'N/A',
      billingCycle: subscription?.billing_cycle || 'N/A',
      startDate: subscription?.start_date || null,
      endDate: subscription?.end_date || null,
      daysLeft: subscription?.days_left !== undefined ? subscription.days_left : 0,
      status: subscription?.liveStatus || subscription?.status || 'inactive',
      isTrial: Boolean(subscription?.isTrial),
      isExpired: Boolean(subscription?.isExpired),
      limits: {
        branches: {
          used: usedBranches,
          allowed: allowedBranches,
          percentage: allowedBranches > 0 ? parseFloat(((usedBranches / allowedBranches) * 100).toFixed(1)) : 0,
        },
        students: {
          used: usedStudents,
          allowed: allowedStudents,
          percentage: allowedStudents > 0 ? parseFloat(((usedStudents / allowedStudents) * 100).toFixed(1)) : 0,
        },
        storage: {
          usedBytes: storageBreakdown.totalUsedBytes,
          usedFormatted: storageBreakdown.totalUsedFormatted,
          allowedBytes: storageBreakdown.totalAllocationBytes,
          allowedFormatted: storageBreakdown.totalAllocationFormatted,
          percentage: storageBreakdown.usagePercentage,
          warningLevel: storageBreakdown.warningLevel,
        },
        teachers: {
          used: Number(teacherCount[0]?.count || 0),
        },
        staff: {
          used: Number(staffCount[0]?.count || 0),
        },
      },
    };
  }
}

module.exports = SuperAdminModel;
