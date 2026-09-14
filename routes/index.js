const express = require('express');
const router = express.Router();
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');
const subscriptionGuard = require('../middlewares/subscriptionGuard.middleware');
const featureGuard = require('../middlewares/featureGuard.middleware');

// Route Modules
const adminAuthRoutes = require('./adminAuth.routes');
const adminSubscriptionRoutes = require('./adminSubscription.routes');
const adminAcademicRoutes = require('./adminAcademic.routes');
const adminTeacherRoutes = require('./adminTeacher.routes');
const adminStudentRoutes = require('./adminStudent.routes');
const adminParentRoutes = require('./adminParent.routes');
const adminStaffRoutes = require('./adminStaff.routes');
const adminAttendanceRoutes = require('./adminAttendance.routes');
const adminLeaveRoutes = require('./adminLeave.routes');
const adminTransportRoutes = require('./adminTransport.routes');
const adminPermissionRoutes = require('./adminPermission.routes');
const adminExaminationRoutes = require('./adminExamination.routes');
const adminFeesRoutes = require('./adminFees.routes');
const adminPayrollRoutes = require('./adminPayroll.routes');
const adminHostelRoutes = require('./adminHostel.routes');
const adminAnnouncementRoutes = require('./adminAnnouncement.routes');
const adminCertificateRoutes = require('./adminCertificate.routes');
const adminReportRoutes = require('./adminReport.routes');
const adminMiscSettingRoutes = require('./adminMiscSetting.routes');
const adminIdCardRoutes = require('./adminIdCard.routes');
const adminDashboardRoutes = require('./adminDashboard.routes');

const teacherAuthRoutes = require('./teacherAuth.routes');
const teacherDashboardRoutes = require('./teacherDashboard.routes');
const teacherAcademicRoutes = require('./teacherAcademic.routes');
const teacherAttendanceRoutes = require('./teacherAttendance.routes');
const teacherAnnouncementRoutes = require('./teacherAnnouncement.routes');
const teacherHostelRoutes = require('./teacherHostel.routes');
const teacherTransportRoutes = require('./teacherTransport.routes');
const teacherLeaveRoutes = require('./teacherLeave.routes');
const teacherPayrollRoutes = require('./teacherPayroll.routes');

const parentAuthRoutes = require('./parentAuth.routes');
const parentDashboardRoutes = require('./parentDashboard.routes');
const parentChildRoutes = require('./parentChild.routes');

const studentAuthRoutes = require('./studentAuth.routes');
const studentPortalRoutes = require('./studentPortal.routes');

const uploadRoutes = require('./upload.routes');
const commonOptionsRoutes = require('./commonOptions.routes');
const saasRoutes = require('./saas.routes');
const webhookRoutes = require('./webhook.routes');
const messageRoutes = require('./message.routes');
const schoolRoutes = require('./school.routes');
const branchRoutes = require('./branch.routes');

// ==========================================
// 1. Unprotected / System Routes
// ==========================================

// Health Check
router.get('/health', (req, res) => {
  return ApiResponse.success(res, 'Growvidya REST API Server is online and healthy.', {
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// School Public Config
router.use('/v1/school', schoolRoutes);

// Webhooks
router.use('/v1/webhooks', webhookRoutes);
router.use('/webhooks', webhookRoutes);

// SaaS Pricing & Registration Onboarding
router.use('/v1/saas', saasRoutes);
router.use('/saas', saasRoutes);

// ==========================================
// 2. Subscription & Trial Guard
// ==========================================
router.use(subscriptionGuard);

// ==========================================
// 3. Admin Portal Routes
// ==========================================
router.use('/v1/admin/auth', adminAuthRoutes);
router.use('/v1/admin/subscription', adminSubscriptionRoutes);
router.use('/v1/admin/academics', adminAcademicRoutes);
router.use('/v1/admin/teachers', adminTeacherRoutes);
router.use('/v1/admin/students', adminStudentRoutes);
router.use('/v1/admin/parents', adminParentRoutes);
router.use('/v1/admin/staff', adminStaffRoutes);
router.use('/v1/admin/attendance', adminAttendanceRoutes);
router.use('/v1/admin/leaves', adminLeaveRoutes);
router.use('/v1/admin/transport', featureGuard('transport', 'Transport Management'), adminTransportRoutes);
router.use('/v1/admin/permissions', adminPermissionRoutes);
router.use('/v1/admin/examinations', adminExaminationRoutes);
router.use('/v1/admin/fees', adminFeesRoutes);
router.use('/v1/admin/payroll', featureGuard('payroll', 'Staff Payroll'), adminPayrollRoutes);
router.use('/v1/admin/hostel', featureGuard('hostel', 'Hostel Management'), adminHostelRoutes);
router.use('/v1/admin/announcement', adminAnnouncementRoutes);
router.use('/v1/admin/certificates', adminCertificateRoutes);
router.use('/v1/admin/reports', adminReportRoutes);
router.use('/v1/admin/settings', adminMiscSettingRoutes);
router.use('/v1/admin/idcards', adminIdCardRoutes);
router.use('/v1/admin/records/idcards', adminIdCardRoutes);
router.use('/v1/admin/branches', branchRoutes);
router.use('/v1/branches', branchRoutes);
router.use('/v1/admin/dashboard', adminDashboardRoutes);

// ==========================================
// 4. Teacher Portal Routes
// ==========================================
router.use('/v1/teacher/auth', teacherAuthRoutes);
router.use('/v1/teacher/dashboard', teacherDashboardRoutes);
router.use('/v1/teacher/academics', teacherAcademicRoutes);
router.use('/v1/teacher/attendance', teacherAttendanceRoutes);
router.use('/v1/teacher/announcements', teacherAnnouncementRoutes);
router.use('/v1/teacher/hostel', featureGuard('hostel', 'Hostel Management'), teacherHostelRoutes);
router.use('/v1/teacher/transport', featureGuard('transport', 'Transport Management'), teacherTransportRoutes);
router.use('/v1/teacher/leaves', teacherLeaveRoutes);
router.use('/v1/teacher/payroll', featureGuard('payroll', 'Staff Payroll'), teacherPayrollRoutes);

// ==========================================
// 5. Parent Portal Routes
// ==========================================
router.use('/v1/parent/auth', parentAuthRoutes);
router.use('/v1/parent/dashboard', parentDashboardRoutes);
router.use('/v1/parent/child', parentChildRoutes);

// ==========================================
// 6. Student Portal Routes
// ==========================================
router.use('/v1/student/auth', studentAuthRoutes);
router.use('/v1/student/portal', studentPortalRoutes);
router.use('/v1/student', studentPortalRoutes);

// ==========================================
// 7. Common & Shared Routes
// ==========================================
router.use('/v1/upload', uploadRoutes);
router.use('/v1/common/options', commonOptionsRoutes);
router.use('/v1/messages', messageRoutes);
router.use('/messages', messageRoutes);

module.exports = router;
