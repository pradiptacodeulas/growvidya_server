const StudentModel = require('../models/student.model');
const { comparePassword, hashPassword } = require('../utils/password.util');
const { generateToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');
const PasscodeService = require('../services/passcode.service');

class StudentAuthController {
  /**
   * Helper to issue session cookie & JWT token for student
   */
  static async _issueSession(student, res, message = 'Student login successful.') {
    const tokenPayload = {
      userId: student.id,
      studentId: student.id,
      schoolId: student.school_id || 1,
      schoolName: student.school_name || 'Growvidya School',
      schoolLogo: student.school_logo || null,
      email: student.email_address,
      admissionNumber: student.admission_number,
      classId: student.class,
      sectionId: student.section,
      className: student.class_name,
      sectionName: student.section_name,
      firstName: student.first_name,
      lastName: student.last_name,
      fullName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
      roleName: 'Student',
      portalType: 'StudentPortal',
    };

    const token = generateToken(tokenPayload);

    const cookieOptions = {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: config.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000,
      path: '/',
    };

    res.cookie('growvidya_student_session', token, cookieOptions);

    const { password: _, passcode: __, otp: ___, ...safeStudent } = student;
    safeStudent.full_name = safeStudent.full_name || `${safeStudent.first_name || ''} ${safeStudent.last_name || ''}`.trim() || safeStudent.name || 'Student';
    safeStudent.fullName = safeStudent.full_name;
    safeStudent.admissionNumber = safeStudent.admission_number || safeStudent.roll_number || 'N/A';

    return ApiResponse.success(res, message, {
      student: safeStudent,
      token,
      school: {
        id: student.school_id,
        name: student.school_name,
        logo: student.school_logo,
      },
    });
  }

  /**
   * Student Login (Password-based fallback)
   */
  static async login(req, res, next) {
    try {
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.phone || req.body.identifier || req.body.login;
      const { password } = req.body;

      if (!emailOrAdmNo || !password) {
        return ApiResponse.error(res, 'Admission number, email, or phone and password are required.', null, 400);
      }

      // Find student by admission number, email, or phone
      const cleanIdent = String(emailOrAdmNo).trim();
      const [students] = await pool.query(
        `SELECT 
          s.*,
          cm.class_name,
          sec.section_name,
          sch.school_name,
          sch.school_logo
         FROM student_master s
         LEFT JOIN class_master cm ON s.class = cm.id
         LEFT JOIN section_master sec ON s.section = sec.id
         LEFT JOIN school_master sch ON s.school_id = sch.id
         WHERE (
           s.admission_number = ? OR 
           s.email_address = ? OR 
           s.primary_contact_number = ? OR 
           CAST(s.id AS CHAR) = ?
         ) AND s.status != 4 AND s.status != 0
         LIMIT 1`,
        [cleanIdent, cleanIdent, cleanIdent, cleanIdent]
      );

      const student = students[0];
      if (!student) {
        return ApiResponse.error(res, 'Student account not found or inactive.', null, 401);
      }

      // Verify password
      let isPasswordValid = false;
      if (student.password) {
        isPasswordValid = await comparePassword(password, student.password);

        // If not matched directly and student has date_of_birth, test DOB variations against stored hash
        if (!isPasswordValid && student.date_of_birth) {
          const dob = new Date(student.date_of_birth);
          if (!isNaN(dob.getTime())) {
            const yyyy = dob.getFullYear();
            const mm = String(dob.getMonth() + 1).padStart(2, '0');
            const dd = String(dob.getDate()).padStart(2, '0');
            const variations = [
              `${yyyy}-${mm}-${dd}`,
              `${dd}-${mm}-${yyyy}`,
              `${dd}/${mm}/${yyyy}`,
              `${yyyy}/${mm}/${dd}`,
              `${dd}${mm}${yyyy}`,
              `${yyyy}${mm}${dd}`,
              `${Number(dd)}-${Number(mm)}-${yyyy}`,
              `${Number(dd)}/${Number(mm)}/${yyyy}`,
            ];
            for (const v of variations) {
              if (password === v || (await comparePassword(v, student.password))) {
                isPasswordValid = true;
                break;
              }
            }
          }
        }
      }

      if (!isPasswordValid && student.passcode) {
        isPasswordValid = await comparePassword(password, student.passcode);
      }

      // Fallback: Check if password matches admission number, contact number, or default if password not set
      if (!isPasswordValid && (!student.password || student.password === '')) {
        if (password === student.admission_number || password === student.primary_contact_number || password === '123456') {
          isPasswordValid = true;
        }
      }

      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Invalid credentials. Please check your password or Date of Birth.', null, 401);
      }

      return await StudentAuthController._issueSession(student, res, 'Student login successful.');
    } catch (error) {
      console.error('Error in StudentAuthController.login:', error);
      next(error);
    }
  }

  /**
   * Request 6-digit Passcode for Student Login
   */
  static async requestPasscode(req, res, next) {
    try {
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.phone || req.body.identifier || req.body.login;

      if (!emailOrAdmNo || !String(emailOrAdmNo).trim()) {
        return ApiResponse.error(res, 'Admission number, email or phone number is required.', null, 400);
      }

      const cleanIdent = String(emailOrAdmNo).trim();
      const [students] = await pool.query(
        `SELECT 
          s.*,
          cm.class_name,
          sec.section_name,
          sch.school_name,
          sch.school_logo
         FROM student_master s
         LEFT JOIN class_master cm ON s.class = cm.id
         LEFT JOIN section_master sec ON s.section = sec.id
         LEFT JOIN school_master sch ON s.school_id = sch.id
         WHERE (
           s.admission_number = ? OR 
           s.email_address = ? OR 
           s.primary_contact_number = ? OR 
           CAST(s.id AS CHAR) = ?
         ) AND s.status != 4 AND s.status != 0
         LIMIT 1`,
        [cleanIdent, cleanIdent, cleanIdent, cleanIdent]
      );

      const student = students && students.length > 0 ? students[0] : null;
      if (!student) {
        return ApiResponse.error(res, 'Student account not found with this identifier or is inactive.', null, 404);
      }

      const passcode = PasscodeService.generatePasscode();
      await PasscodeService.storePasscode('student_master', student.id, passcode, 10);

      const isTest = PasscodeService.isTestMode();
      const maskedIdentifier = PasscodeService.maskIdentifier(student.primary_contact_number || student.email_address || student.admission_number || cleanIdent);

      return ApiResponse.success(res, 'A 6-digit passcode has been generated.', {
        identifier: cleanIdent,
        maskedIdentifier,
        testMode: isTest,
        testPasscode: isTest ? passcode : undefined,
        expiresInMinutes: 10,
      });
    } catch (error) {
      console.error('Error in StudentAuthController.requestPasscode:', error);
      next(error);
    }
  }

  /**
   * Verify 6-digit Passcode for Student Login
   */
  static async verifyPasscode(req, res, next) {
    try {
      const emailOrAdmNo = req.body.email || req.body.admission_number || req.body.phone || req.body.identifier || req.body.login;
      const passcode = req.body.passcode || req.body.otp || req.body.code;

      if (!emailOrAdmNo || !String(emailOrAdmNo).trim()) {
        return ApiResponse.error(res, 'Admission number, email or phone number is required.', null, 400);
      }
      if (!passcode || !String(passcode).trim()) {
        return ApiResponse.error(res, '6-digit passcode is required.', null, 400);
      }

      const cleanIdent = String(emailOrAdmNo).trim();
      const [students] = await pool.query(
        `SELECT 
          s.*,
          cm.class_name,
          sec.section_name,
          sch.school_name,
          sch.school_logo
         FROM student_master s
         LEFT JOIN class_master cm ON s.class = cm.id
         LEFT JOIN section_master sec ON s.section = sec.id
         LEFT JOIN school_master sch ON s.school_id = sch.id
         WHERE (
           s.admission_number = ? OR 
           s.email_address = ? OR 
           s.primary_contact_number = ? OR 
           CAST(s.id AS CHAR) = ?
         ) AND s.status != 4 AND s.status != 0
         LIMIT 1`,
        [cleanIdent, cleanIdent, cleanIdent, cleanIdent]
      );

      const student = students && students.length > 0 ? students[0] : null;
      if (!student) {
        return ApiResponse.error(res, 'Student account not found or is inactive.', null, 401);
      }

      const verifyResult = await PasscodeService.verifyPasscode('student_master', student.id, passcode);

      if (!verifyResult.valid) {
        return ApiResponse.error(res, verifyResult.message, null, 401);
      }

      return await StudentAuthController._issueSession(student, res, 'Student login successful via passcode.');
    } catch (error) {
      console.error('Error in StudentAuthController.verifyPasscode:', error);
      next(error);
    }
  }

  /**
   * Get Current Authenticated Student
   */
  static async getMe(req, res, next) {
    try {
      const studentId = req.user?.studentId || req.user?.userId || req.user?.id;
      const schoolId = req.user?.schoolId || 1;

      if (!studentId) {
        return ApiResponse.error(res, 'Not authenticated as a student.', null, 401);
      }

      const StudentModel = require('../models/student.model');
      const student = await StudentModel.getById(studentId, schoolId);

      if (!student) {
        return ApiResponse.error(res, 'Student profile not found.', null, 404);
      }

      const { password: _, passcode: __, otp: ___, ...safeStudent } = student;
      safeStudent.full_name = safeStudent.full_name || `${safeStudent.first_name || ''} ${safeStudent.last_name || ''}`.trim() || safeStudent.name || 'Student';
      safeStudent.fullName = safeStudent.full_name;
      safeStudent.admissionNumber = safeStudent.admission_number || safeStudent.roll_number || 'N/A';

      return ApiResponse.success(res, 'Student session verified.', {
        student: safeStudent,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Student Logout
   */
  static async logout(req, res, next) {
    try {
      const cookieOptions = {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        path: '/',
      };
      res.clearCookie('growvidya_student_session', cookieOptions);
      return ApiResponse.success(res, 'Student logged out successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Change Student Password
   */
  static async changePassword(req, res, next) {
    try {
      const studentId = req.user?.studentId || req.user?.userId || req.user?.id;
      const schoolId = req.user?.schoolId || 1;
      const { oldPassword, newPassword } = req.body;

      if (!newPassword || newPassword.length < 4) {
        return ApiResponse.error(res, 'New password must be at least 4 characters.', null, 400);
      }

      const [rows] = await pool.query(
        `SELECT id, password FROM student_master WHERE id = ? AND (school_id = ? OR ? IS NULL) LIMIT 1`,
        [studentId, schoolId, schoolId]
      );

      if (!rows[0]) {
        return ApiResponse.error(res, 'Student not found.', null, 404);
      }

      if (rows[0].password) {
        if (!oldPassword) {
          return ApiResponse.error(res, 'Current password is required to set a new password.', null, 400);
        }
        const isValid = await comparePassword(oldPassword, rows[0].password);
        if (!isValid) {
          return ApiResponse.error(res, 'Current password does not match.', null, 400);
        }
      }

      const hashed = await hashPassword(newPassword);
      await pool.query(
        `UPDATE student_master SET password = ? WHERE id = ? AND (school_id = ? OR ? IS NULL)`,
        [hashed, studentId, schoolId, schoolId]
      );

      return ApiResponse.success(res, 'Password changed successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = StudentAuthController;
