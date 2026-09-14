const { pool } = require('../config/db.config');

class DashboardModel {
  static async getDashboardStats(schoolId = 1, branchId = null) {
    try {
      // 1. Students Count
      const stuParams = [schoolId];
      let stuSql = `SELECT status, COUNT(*) as count FROM student_master WHERE school_id = ? AND status != 4`;
      if (branchId) {
        stuSql += ` AND branch_id = ?`;
        stuParams.push(Number(branchId));
      }
      stuSql += ` GROUP BY status`;
      const [stuRows] = await pool.query(stuSql, stuParams);

      let activeStudents = 0, inactiveStudents = 0, totalStudents = 0;
      stuRows.forEach((r) => {
        if (r.status === 1) activeStudents += Number(r.count);
        else if (r.status === 2 || r.status === 0) inactiveStudents += Number(r.count);
        totalStudents += Number(r.count);
      });

      // 2. Teachers Count
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
        else if (r.status === 2 || r.status === 0) inactiveTeachers += Number(r.count);
        totalTeachers += Number(r.count);
      });

      // 3. Staff Users Count
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
        else if (r.status === 2 || r.status === 0) inactiveStaff += Number(r.count);
        totalStaff += Number(r.count);
      });

      // 4. Parents Count
      let prnSql = `SELECT status, COUNT(*) as count FROM parent_master WHERE school_id = ? AND status != 4`;
      const prnParams = [schoolId];
      if (branchId) {
        prnSql = `SELECT p.status, COUNT(DISTINCT p.id) as count FROM parent_master p
                  INNER JOIN student_to_parent stp ON (p.id = stp.father_id OR p.id = stp.mother_id OR p.id = stp.guardian_id)
                  INNER JOIN student_master sm ON stp.student_id = sm.id AND sm.branch_id = ?
                  WHERE p.school_id = ? AND p.status != 4 GROUP BY p.status`;
        prnParams.unshift(Number(branchId));
      } else {
        prnSql += ` GROUP BY status`;
      }
      const [prnRows] = await pool.query(prnSql, prnParams);

      let activeParents = 0, inactiveParents = 0, totalParents = 0;
      prnRows.forEach((r) => {
        if (r.status === 1) activeParents += Number(r.count);
        else if (r.status === 2 || r.status === 0) inactiveParents += Number(r.count);
        totalParents += Number(r.count);
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
           COALESCE(tm.first_name, um.first_name, 'Staff') AS first_name,
           COALESCE(tm.last_name, um.last_name, '') AS last_name,
           COALESCE(tm.picture, um.picture, NULL) AS picture,
           COALESCE(tm.gender, um.gender, 1) AS gender,
           IF(l.role = 2, 'Teacher', 'User') AS role_title,
           (SELECT GROUP_CONCAT(DATE_FORMAT(ld.date, '%d %b') SEPARATOR ' - ') FROM leaves_date ld WHERE ld.staff_leave_id = l.id) AS leave_dates
         FROM leaves l
         LEFT JOIN leave_master lm ON l.leave_id = lm.id
         LEFT JOIN teacher_master tm ON l.role = 2 AND l.staff_id = tm.id
         LEFT JOIN user_master um ON l.role != 2 AND l.staff_id = um.id
         WHERE l.school_id = ? AND l.status != 4`;
      if (branchId) {
        leaveSql += ` AND (l.branch_id = ? OR tm.branch_id = ? OR um.branch_id = ?)`;
        leaveParams.push(Number(branchId), Number(branchId), Number(branchId));
      }
      leaveSql += ` ORDER BY l.id DESC LIMIT 10`;
      const [leaveRows] = await pool.query(leaveSql, leaveParams);

      const leaveRequests = (leaveRows || []).map((lr) => ({
        id: lr.id,
        name: `${lr.first_name} ${lr.last_name}`.trim(),
        role: lr.role_title || 'Staff',
        leaveType: lr.leave_name || 'Leave',
        status: lr.status === 1 ? 'Approved' : lr.status === 3 ? 'Rejected' : 'Pending',
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
            picture: latestPay[0].picture,
            gender: latestPay[0].gender,
          }
        : null;

      return {
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
