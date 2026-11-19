const { pool } = require('../config/db.config');

class DashboardModel {
  static async getDashboardStats(schoolId, branchId = null) {
    if (!schoolId) {
      throw new Error('schoolId is required for DashboardModel.getDashboardStats');
    }
    try {
      // 1. Students Count (1 = Active, 2 = Inactive, 4 = Soft Delete; deduplicated across promoted sessions)
      const stuParams = [schoolId];
      let stuSql = `
        SELECT 
          COUNT(DISTINCT COALESCE(NULLIF(LOWER(TRIM(admission_number)), ''), CAST(id AS CHAR))) AS total_students,
          COUNT(DISTINCT CASE WHEN status = 1 THEN COALESCE(NULLIF(LOWER(TRIM(admission_number)), ''), CAST(id AS CHAR)) END) AS active_students
        FROM student_master
        WHERE school_id = ? AND status IN (1, 2)
      `;
      if (branchId) {
        stuSql += ` AND branch_id = ?`;
        stuParams.push(Number(branchId));
      }
      const [stuRows] = await pool.query(stuSql, stuParams);

      const totalStudents = Number(stuRows?.[0]?.total_students || 0);
      const activeStudents = Number(stuRows?.[0]?.active_students || 0);
      const inactiveStudents = Math.max(0, totalStudents - activeStudents);

      // 2. Teachers Count (1 = Active, 2 = Inactive, 4 = Soft Delete)
      const tchParams = [schoolId];
      let tchSql = `SELECT status, COUNT(*) as count FROM teacher_master WHERE school_id = ? AND status != 4`;
      if (branchId) {
        tchSql += ` AND branch_id = ?`;
        tchParams.push(Number(branchId));
      }
      tchSql += ` GROUP BY status`;
      const [tchRows] = await pool.query(tchSql, tchParams);

      let activeTeachers = 0, inactiveTeachers = 0, totalTeachers = 0;
      tchRows.forEach((r) => {
        if (r.status === 1) activeTeachers += Number(r.count);
        else if (r.status === 2) inactiveTeachers += Number(r.count);
        if (r.status === 1 || r.status === 2) totalTeachers += Number(r.count);
      });

      // 3. Staff Users Count (1 = Active, 2 = Inactive, 4 = Soft Delete)
      const usrParams = [schoolId];
      let usrSql = `SELECT status, COUNT(*) as count FROM user_master WHERE school_id = ? AND status != 4`;
      if (branchId) {
        usrSql += ` AND branch_id = ?`;
        usrParams.push(Number(branchId));
      }
      usrSql += ` GROUP BY status`;
      const [usrRows] = await pool.query(usrSql, usrParams);

      let activeStaff = 0, inactiveStaff = 0, totalStaff = 0;
      usrRows.forEach((r) => {
        if (r.status === 1) activeStaff += Number(r.count);
        else if (r.status === 2) inactiveStaff += Number(r.count);
        if (r.status === 1 || r.status === 2) totalStaff += Number(r.count);
      });

      // 4. Parents Count (1 = Active, 2 = Inactive, 4 = Soft Delete)
      let prnSql = `SELECT status, COUNT(*) as count FROM parent_master WHERE school_id = ? AND status != 4`;
      const prnParams = [schoolId];
      if (branchId) {
        prnSql = `SELECT p.status, COUNT(DISTINCT p.id) as count FROM parent_master p
                  INNER JOIN student_to_parent stp ON (p.id = stp.father_id OR p.id = stp.mother_id OR p.id = stp.guardian_id)
                  INNER JOIN student_master sm ON stp.student_id = sm.id AND sm.branch_id = ? AND sm.status != 4
                  WHERE p.school_id = ? AND p.status != 4 GROUP BY p.status`;
        prnParams.unshift(Number(branchId));
      } else {
        prnSql += ` GROUP BY status`;
      }
      const [prnRows] = await pool.query(prnSql, prnParams);

      let activeParents = 0, inactiveParents = 0, totalParents = 0;
      prnRows.forEach((r) => {
        if (r.status === 1) activeParents += Number(r.count);
        else if (r.status === 2) inactiveParents += Number(r.count);
        if (r.status === 1 || r.status === 2) totalParents += Number(r.count);
      });

      // 5. Attendance Summaries (Today's Attendance)
      // Student Attendance
      const stuAttParams = [schoolId];
      let stuAttSql = `SELECT attendance, COUNT(*) as count FROM student_attendance WHERE school_id = ? AND date = CURDATE() AND status != 4`;
      if (branchId) {
        stuAttSql += ` AND branch_id = ?`;
        stuAttParams.push(Number(branchId));
      }
      stuAttSql += ` GROUP BY attendance`;
      const [stuAtt] = await pool.query(stuAttSql, stuAttParams);

      let stuPresent = 0, stuAbsent = 0, stuLate = 0, stuHalfday = 0;
      stuAtt.forEach((r) => {
        if (r.attendance === 1) stuPresent += Number(r.count);
        else if (r.attendance === 0) stuAbsent += Number(r.count);
        else if (r.attendance === 2) stuLate += Number(r.count);
        else if (r.attendance === 3) stuHalfday += Number(r.count);
      });

      // Teacher Attendance
      const tchAttParams = [schoolId];
      let tchAttSql = `SELECT attendance, COUNT(*) as count FROM teacher_attendance WHERE school_id = ? AND date = CURDATE() AND status != 4`;
      if (branchId) {
        tchAttSql += ` AND branch_id = ?`;
        tchAttParams.push(Number(branchId));
      }
      tchAttSql += ` GROUP BY attendance`;
      const [tchAtt] = await pool.query(tchAttSql, tchAttParams);

      let tchPresent = 0, tchAbsent = 0, tchLate = 0, tchHalfday = 0;
      tchAtt.forEach((r) => {
        if (r.attendance === 1) tchPresent += Number(r.count);
        else if (r.attendance === 0) tchAbsent += Number(r.count);
        else if (r.attendance === 2) tchLate += Number(r.count);
        else if (r.attendance === 3) tchHalfday += Number(r.count);
      });

      // Staff Attendance
      const staffAttParams = [schoolId];
      let staffAttSql = `SELECT attendance, COUNT(*) as count FROM user_master_attendance WHERE school_id = ? AND date = CURDATE() AND status != 4`;
      if (branchId) {
        staffAttSql += ` AND branch_id = ?`;
        staffAttParams.push(Number(branchId));
      }
      staffAttSql += ` GROUP BY attendance`;
      const [staffAtt] = await pool.query(staffAttSql, staffAttParams);

      let staffPresent = 0, staffAbsent = 0, staffLate = 0, staffHalfday = 0;
      staffAtt.forEach((r) => {
        if (r.attendance === 1) staffPresent += Number(r.count);
        else if (r.attendance === 0) staffAbsent += Number(r.count);
        else if (r.attendance === 2) staffLate += Number(r.count);
        else if (r.attendance === 3) staffHalfday += Number(r.count);
      });

      // 6. Leave Requests (Real data)
      const leaveParams = [schoolId];
      let leaveSql = `SELECT l.*, lm.leave_name,
           COALESCE(um.first_name, tm.first_name, op.first_name, 'Staff') AS first_name,
           COALESCE(um.last_name, tm.last_name, op.last_name, '') AS last_name,
           COALESCE(um.picture, tm.picture, op.picture, NULL) AS picture,
           COALESCE(um.gender, tm.gender, 1) AS gender,
           CASE WHEN l.role = 2 THEN 'Teacher' WHEN l.role = 3 THEN 'Driver' ELSE 'Staff' END AS role_title,
           (SELECT 
              IF(MIN(ld.date) = MAX(ld.date), 
                 DATE_FORMAT(MIN(ld.date), '%d %b'), 
                 CONCAT(DATE_FORMAT(MIN(ld.date), '%d %b'), ' - ', DATE_FORMAT(MAX(ld.date), '%d %b'))
              ) 
            FROM leaves_date ld 
            WHERE ld.staff_leave_id = l.id) AS leave_dates
         FROM leaves l
         LEFT JOIN leave_master lm ON (l.leave_id = lm.id AND (lm.school_id = l.school_id OR lm.school_id IS NULL))
         LEFT JOIN user_master um ON (l.role = 1 AND l.staff_id = um.id AND um.school_id = l.school_id)
         LEFT JOIN teacher_master tm ON (l.role = 2 AND l.staff_id = tm.id AND tm.school_id = l.school_id)
         LEFT JOIN operator_master op ON (l.role = 3 AND l.staff_id = op.id AND op.school_id = l.school_id)
         WHERE l.school_id = ? AND l.status != 4 AND l.status != 0`;
      if (branchId) {
        leaveSql += ` AND (l.branch_id = ? OR um.branch_id = ? OR tm.branch_id = ? OR op.branch_id = ?)`;
        leaveParams.push(Number(branchId), Number(branchId), Number(branchId), Number(branchId));
      }
      leaveSql += ` ORDER BY l.id DESC LIMIT 10`;
      const [leaveRows] = await pool.query(leaveSql, leaveParams);

      const leaveRequests = (leaveRows || []).map((lr) => ({
        id: lr.id,
        name: `${lr.first_name || ''} ${lr.last_name || ''}`.trim() || 'Staff',
        role: lr.role_title || 'Staff',
        leaveType: lr.leave_name || 'Leave',
        status: lr.status === 2 ? 'Approved' : lr.status === 3 ? 'Rejected' : 'Pending',
        dates: lr.leave_dates || (lr.created_at ? new Date(lr.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'N/A'),
        appliedOn: lr.created_at ? new Date(lr.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : 'N/A',
        picture: lr.picture,
        gender: lr.gender,
      }));

      // 7. Notice Board (Real data)
      const noticeParams = [schoolId];
      let noticeSql = `SELECT id, title, message, notice_date, publish_on, created_at,
           DATEDIFF(publish_on, CURDATE()) AS days_diff
         FROM notice
         WHERE school_id = ? AND status != 4`;
      if (branchId) {
        noticeSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        noticeParams.push(Number(branchId));
      }
      noticeSql += ` ORDER BY id DESC LIMIT 6`;
      const [noticeRows] = await pool.query(noticeSql, noticeParams);

      const notices = (noticeRows || []).map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        noticeDate: n.notice_date ? new Date(n.notice_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        publishOn: n.publish_on ? new Date(n.publish_on).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        daysDiff: Math.abs(n.days_diff !== null && n.days_diff !== undefined ? n.days_diff : 0),
        isFuture: (n.days_diff || 0) >= 0,
      }));

      // 8. Student Activities (Real data)
      const actParams = [schoolId];
      let actSql = `SELECT sa.*, sm.first_name, sm.last_name, sm.picture, sm.gender
         FROM student_activity sa
         LEFT JOIN student_master sm ON sa.student_id = sm.id
         WHERE sa.school_id = ? AND sa.status != 4`;
      if (branchId) {
        actSql += ` AND (sa.branch_id = ? OR sm.branch_id = ?)`;
        actParams.push(Number(branchId), Number(branchId));
      }
      actSql += ` ORDER BY sa.id DESC LIMIT 20`;
      const [activityRows] = await pool.query(actSql, actParams);

      const studentActivities = (activityRows || []).map((act) => ({
        id: act.id,
        studentId: act.student_id,
        name: `${act.first_name || ''} ${act.last_name || ''}`.trim() || 'Student',
        picture: act.picture,
        gender: act.gender,
        description: act.activity_description || '',
        date: act.date ? new Date(act.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
      }));

      // 9. Fees Collection Summary & Breakdown
      const feeClassParams = [schoolId];
      let feeClassSql = `SELECT cm.class_name, 
           SUM(fi.total_amount) AS total, 
           SUM(fi.paid_amount) AS paid, 
           SUM(fi.due_amount) AS due
         FROM fee_invoices fi
         LEFT JOIN class_master cm ON fi.class_id = cm.id
         WHERE fi.school_id = ? AND fi.status != 4`;
      if (branchId) {
        feeClassSql += ` AND fi.branch_id = ?`;
        feeClassParams.push(Number(branchId));
      }
      feeClassSql += ` GROUP BY fi.class_id, cm.class_name ORDER BY cm.class_name ASC`;
      const [invoicesByClass] = await pool.query(feeClassSql, feeClassParams);

      const feeTotalParams = [schoolId];
      let feeTotalSql = `SELECT 
           COALESCE(SUM(total_amount), 0) AS total_invoiced,
           COALESCE(SUM(paid_amount), 0) AS total_paid,
           COALESCE(SUM(due_amount), 0) AS total_due
         FROM fee_invoices
         WHERE school_id = ? AND status != 4`;
      if (branchId) {
        feeTotalSql += ` AND branch_id = ?`;
        feeTotalParams.push(Number(branchId));
      }
      const [totalInvoices] = await pool.query(feeTotalSql, feeTotalParams);

      // 10. Recent Fee Alert Banner
      const recentPayParams = [schoolId];
      let recentPaySql = `SELECT fp.*, sm.first_name, sm.last_name, sm.picture, sm.gender, cm.class_name, sec.section_name, fi.title AS invoice_title
         FROM fee_payments fp
         JOIN student_master sm ON fp.student_id = sm.id
         LEFT JOIN class_master cm ON sm.class = cm.id
         LEFT JOIN section_master sec ON sm.section = sec.id
         LEFT JOIN fee_invoices fi ON fp.invoice_id = fi.id
         WHERE fp.school_id = ?`;
      if (branchId) {
        recentPaySql += ` AND (fp.branch_id = ? OR sm.branch_id = ?)`;
        recentPayParams.push(Number(branchId), Number(branchId));
      }
      recentPaySql += ` ORDER BY fp.id DESC LIMIT 1`;
      const [latestPay] = await pool.query(recentPaySql, recentPayParams);

      const recentAlert = latestPay[0]
        ? {
            studentName: `${latestPay[0].first_name} ${latestPay[0].last_name}`.trim(),
            className: latestPay[0].class_name || '',
            sectionName: latestPay[0].section_name || '',
            invoiceTitle: latestPay[0].invoice_title || 'Term Fees',
            amountPaid: latestPay[0].amount_paid,
            receiptNo: latestPay[0].receipt_no || latestPay[0].txn_no || '',
            paymentDate: latestPay[0].payment_date
              ? new Date(latestPay[0].payment_date).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : '',
            picture: latestPay[0].picture,
            gender: latestPay[0].gender,
          }
        : null;

      // 11. Active Branch Info (if branch-filtered)
      let branchInfo = null;
      if (branchId) {
        const [bRows] = await pool.query(
          `SELECT id, branch_name, branch_code, is_main_branch FROM branch_master WHERE id = ? AND school_id = ? LIMIT 1`,
          [Number(branchId), schoolId]
        );
        if (bRows[0]) {
          branchInfo = {
            id: bRows[0].id,
            branchName: bRows[0].branch_name,
            branchCode: bRows[0].branch_code,
            isMainBranch: Boolean(bRows[0].is_main_branch),
          };
        }
      }

      return {
        branchInfo,
        students: { total: totalStudents, active: activeStudents, inactive: inactiveStudents },
        teachers: { total: totalTeachers, active: activeTeachers, inactive: inactiveTeachers },
        staff: { total: totalStaff, active: activeStaff, inactive: inactiveStaff },
        parents: { total: totalParents, active: activeParents, inactive: inactiveParents },
        attendanceSummary: {
          students: { present: stuPresent, absent: stuAbsent, late: stuLate, halfday: stuHalfday },
          teachers: { present: tchPresent, absent: tchAbsent, late: tchLate, halfday: tchHalfday },
          staff: { present: staffPresent, absent: staffAbsent, late: staffLate, halfday: staffHalfday },
        },
        leaveRequests,
        notices,
        studentActivities,
        feesSummary: {
          totalInvoiced: Number(totalInvoices[0]?.total_invoiced || 0),
          totalPaid: Number(totalInvoices[0]?.total_paid || 0),
          totalDue: Number(totalInvoices[0]?.total_due || 0),
          byClass: invoicesByClass || [],
        },
        recentAlert,
      };
    } catch (err) {
      console.error('Error in getDashboardStats:', err);
      throw err;
    }
  }
}

module.exports = DashboardModel;
