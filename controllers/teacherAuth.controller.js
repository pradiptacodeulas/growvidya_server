const TeacherModel = require('../models/teacher.model');
const { comparePassword, hashPassword } = require('../utils/password.util');
const { generateToken } = require('../utils/jwt.util');
const config = require('../config/app.config');
const ApiResponse = require('../utils/api.response');
const { pool } = require('../config/db.config');
const PasscodeService = require('../services/passcode.service');

class TeacherAuthController {
  /**
   * Helper to issue session cookie & JWT token for teacher
   */
  static async _issueSession(teacher, res, message = 'Teacher authentication successful.') {
    const tokenPayload = {
      userId: teacher.id,
      teacherId: teacher.id,
      schoolId: teacher.school_id || 1,
      schoolName: teacher.school_name || 'Growvidya School',
      schoolLogo: teacher.school_logo || null,
      email: teacher.email_address,
      teacherCode: teacher.teacher_id,
      firstName: teacher.first_name,
      lastName: teacher.last_name,
      roleName: 'Teacher',
      portalType: 'TeacherPortal',
    };

    const token = generateToken(tokenPayload);

    const cookieOptions = {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: config.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000,
      path: '/',
    };

    res.cookie('growvidya_teacher_session', token, cookieOptions);

    // Strip sensitive password/passcode before returning
    const { password: _, passcode: __, otp: ___, ...safeTeacher } = teacher;

    return ApiResponse.success(res, message, {
      authType: 'hybrid (session + token)',
      token,
      teacher: {
        id: safeTeacher.id,
        teacherId: safeTeacher.teacher_id,
        firstName: safeTeacher.first_name,
        lastName: safeTeacher.last_name,
        name: `${safeTeacher.first_name || ''} ${safeTeacher.last_name || ''}`.trim(),
        email: safeTeacher.email_address,
        phone: safeTeacher.primary_contact_number,
        gender: safeTeacher.gender,
        picture: safeTeacher.picture,
        schoolId: safeTeacher.school_id,
        schoolName: safeTeacher.school_name || 'Growvidya School',
        schoolLogo: safeTeacher.school_logo || null,
        className: safeTeacher.class_name || null,
        sectionName: safeTeacher.section_name || null,
        subjectName: safeTeacher.subject_name || null,
        qualification: safeTeacher.qualification,
        workExperience: safeTeacher.work_experience,
        address: safeTeacher.address1,
        roleName: 'Teacher',
        portalType: 'TeacherPortal',
      },
    });
  }

  /**
   * Teacher Login Controller (Password-based fallback)
   */
  static async login(req, res, next) {
    try {
      const emailOrIdentifier = req.body.email || req.body.identifier || req.body.teacher_id || req.body.phone || req.body.login;
      const { password } = req.body;

      if (!emailOrIdentifier || !password) {
        return ApiResponse.error(res, 'Teacher ID / Email and password are required.', null, 400);
      }

      const teacher = await TeacherModel.findByLoginIdentifier(emailOrIdentifier);

      if (!teacher || teacher.status === 4 || teacher.status === 0) {
        return ApiResponse.error(res, 'Invalid credentials. Teacher account not found or inactive.', null, 401);
      }

      // Verify password against teacher.password (MD5/bcrypt/plain) or teacher.passcode (bcrypt)
      let isPasswordValid = false;
      if (teacher.password) {
        isPasswordValid = await comparePassword(password, teacher.password);
      }
      if (!isPasswordValid && teacher.passcode) {
        isPasswordValid = await comparePassword(password, teacher.passcode);
      }

      if (!isPasswordValid) {
        return ApiResponse.error(res, 'Invalid credentials. Incorrect password.', null, 401);
      }

      return await TeacherAuthController._issueSession(teacher, res, 'Teacher authentication successful.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request 6-digit Passcode for Teacher Login
   */
  static async requestPasscode(req, res, next) {
    try {
      const emailOrIdentifier = req.body.email || req.body.identifier || req.body.teacher_id || req.body.phone || req.body.login;

      if (!emailOrIdentifier || !String(emailOrIdentifier).trim()) {
        return ApiResponse.error(res, 'Teacher ID, Email address or Phone number is required.', null, 400);
      }

      const teacher = await TeacherModel.findByLoginIdentifier(emailOrIdentifier);

      if (!teacher || teacher.status === 4 || teacher.status === 0) {
        return ApiResponse.error(res, 'Teacher account not found with this identifier or is inactive.', null, 404);
      }

      const passcode = PasscodeService.generatePasscode();
      await PasscodeService.storePasscode('teacher_master', teacher.id, passcode, 10);

      const isTest = PasscodeService.isTestMode();
      const maskedIdentifier = PasscodeService.maskIdentifier(teacher.email_address || teacher.primary_contact_number || emailOrIdentifier);

      return ApiResponse.success(res, 'A 6-digit passcode has been generated.', {
        identifier: String(emailOrIdentifier).trim(),
        maskedIdentifier,
        testMode: isTest,
        testPasscode: isTest ? passcode : undefined,
        expiresInMinutes: 10,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify 6-digit Passcode for Teacher Login
   */
  static async verifyPasscode(req, res, next) {
    try {
      const emailOrIdentifier = req.body.email || req.body.identifier || req.body.teacher_id || req.body.phone || req.body.login;
      const passcode = req.body.passcode || req.body.otp || req.body.code;

      if (!emailOrIdentifier || !String(emailOrIdentifier).trim()) {
        return ApiResponse.error(res, 'Teacher ID, Email address or Phone number is required.', null, 400);
      }
      if (!passcode || !String(passcode).trim()) {
        return ApiResponse.error(res, '6-digit passcode is required.', null, 400);
      }

      const teacher = await TeacherModel.findByLoginIdentifier(emailOrIdentifier);

      if (!teacher || teacher.status === 4 || teacher.status === 0) {
        return ApiResponse.error(res, 'Teacher account not found or is inactive.', null, 401);
      }

      const verifyResult = await PasscodeService.verifyPasscode('teacher_master', teacher.id, passcode);

      if (!verifyResult.valid) {
        return ApiResponse.error(res, verifyResult.message, null, 401);
      }

      return await TeacherAuthController._issueSession(teacher, res, 'Teacher authenticated successfully via passcode.');
    } catch (error) {
      next(error);
    }
  }

  static _formatTeacherResponse(safeTeacher) {
    const addresses = [
      {
        id: String(safeTeacher.address_info?.id || 1),
        school_id: String(safeTeacher.school_id || ''),
        teacher_id: String(safeTeacher.id || ''),
        address1: safeTeacher.address1 || '',
        address2: safeTeacher.address2 || '',
        country: safeTeacher.country || '',
        country_name: safeTeacher.country_name || '',
        state: safeTeacher.state || '',
        state_name: safeTeacher.state_name || '',
        city: safeTeacher.city || '',
        city_name: safeTeacher.city_name || '',
        postal_code: safeTeacher.postal_code || '',
        address_type: 1,
        same_permanent: safeTeacher.address_info?.same_permanent !== undefined ? safeTeacher.address_info.same_permanent : 1,
        status: 1,
      }
    ];

    const presentAddressParts = [safeTeacher.address1, safeTeacher.city_name, safeTeacher.state_name, safeTeacher.country_name].filter(Boolean);
    const presentAddressStr = presentAddressParts.length > 0 ? presentAddressParts.join(', ') : 'N/A';

    return {
      id: safeTeacher.id,
      teacherId: safeTeacher.teacher_id,
      teacher_id: safeTeacher.teacher_id,
      firstName: safeTeacher.first_name,
      first_name: safeTeacher.first_name,
      lastName: safeTeacher.last_name,
      last_name: safeTeacher.last_name,
      name: `${safeTeacher.first_name || ''} ${safeTeacher.last_name || ''}`.trim(),
      email: safeTeacher.email_address,
      email_address: safeTeacher.email_address,
      phone: safeTeacher.primary_contact_number,
      primary_contact_number: safeTeacher.primary_contact_number,
      gender: safeTeacher.gender,
      gender_name: safeTeacher.gender === 2 || String(safeTeacher.gender) === '2' ? 'Female' : (safeTeacher.gender === 3 || String(safeTeacher.gender) === '3' ? 'Other' : 'Male'),
      picture: safeTeacher.picture,
      schoolId: safeTeacher.school_id,
      school_id: safeTeacher.school_id,
      schoolName: safeTeacher.school_name || 'Growvidya School',
      school_name: safeTeacher.school_name || 'Growvidya School',
      schoolLogo: safeTeacher.school_logo || null,
      className: safeTeacher.class_name || null,
      class_name: safeTeacher.class_name || null,
      sectionName: safeTeacher.section_name || null,
      section_name: safeTeacher.section_name || null,
      subjectName: safeTeacher.subject_name || null,
      subject_name: safeTeacher.subject_name || null,
      classAssignments: safeTeacher.class_assignments || [],
      qualification: safeTeacher.qualification,
      workExperience: safeTeacher.work_experience,
      work_experience: safeTeacher.work_experience,
      dateOfBirth: safeTeacher.date_of_birth,
      date_of_birth: safeTeacher.date_of_birth,
      dob: safeTeacher.date_of_birth,
      dateOfJoining: safeTeacher.date_of_joining,
      date_of_joining: safeTeacher.date_of_joining,
      joining_date: safeTeacher.date_of_joining,
      bloodGroup: safeTeacher.blood_group,
      blood_group: safeTeacher.blood_group,
      bloodGroupName: safeTeacher.blood_group_name || safeTeacher.blood_group || '',
      blood_group_name: safeTeacher.blood_group_name || safeTeacher.blood_group || '',
      maritalStatus: safeTeacher.marital_status,
      marital_status: safeTeacher.marital_status,
      maritalStatusName: safeTeacher.marital_status_name || safeTeacher.marital_status || '',
      marital_status_name: safeTeacher.marital_status_name || safeTeacher.marital_status || '',
      address1: safeTeacher.address1,
      address2: safeTeacher.address2,
      address: addresses,
      present_address: presentAddressStr,
      permanent_address: presentAddressStr,
      country: safeTeacher.country,
      countryName: safeTeacher.country_name,
      country_name: safeTeacher.country_name,
      state: safeTeacher.state,
      stateName: safeTeacher.state_name,
      state_name: safeTeacher.state_name,
      city: safeTeacher.city,
      cityName: safeTeacher.city_name,
      city_name: safeTeacher.city_name,
      postalCode: safeTeacher.postal_code,
      postal_code: safeTeacher.postal_code,
      status: safeTeacher.status !== undefined ? safeTeacher.status : 1,
      roleName: 'Teacher',
      role_name: 'Teacher',
      portalType: 'TeacherPortal',
    };
  }

  /**
   * Get Current Teacher Profile
   */
  static async getProfile(req, res, next) {
    try {
      if (req.user.portalType && req.user.portalType !== 'TeacherPortal') {
        return ApiResponse.error(res, 'Access denied. Not a teacher session.', null, 401);
      }
      if (req.user.roleName !== 'Teacher' && !req.user.teacherId) {
        return ApiResponse.error(res, 'Access denied. Not a teacher session.', null, 401);
      }

      const teacherId = req.user.teacherId || req.user.userId;
      const teacher = await TeacherModel.findAuthProfileById(teacherId);

      if (!teacher) {
        return ApiResponse.error(res, 'Teacher profile not found.', null, 404);
      }

      const { password: _, passcode: __, otp: ___, ...safeTeacher } = teacher;

      return ApiResponse.success(res, 'Teacher profile retrieved successfully.', {
        teacher: TeacherAuthController._formatTeacherResponse(safeTeacher),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update Current Teacher Profile
   */
  static async updateProfile(req, res, next) {
    try {
      const teacherId = req.user.teacherId || req.user.userId;
      const schoolId = req.user?.schoolId;

      const first_name = req.body.first_name !== undefined ? req.body.first_name : req.body.firstName;
      const last_name = req.body.last_name !== undefined ? req.body.last_name : req.body.lastName;
      const primary_contact_number = req.body.primary_contact_number !== undefined ? req.body.primary_contact_number : (req.body.phone !== undefined ? req.body.phone : req.body.mobile);
      const email_address = req.body.email_address !== undefined ? req.body.email_address : req.body.email;
      const gender = req.body.gender;
      const date_of_birth = req.body.date_of_birth !== undefined ? req.body.date_of_birth : (req.body.dateOfBirth !== undefined ? req.body.dateOfBirth : req.body.dob);
      const blood_group = req.body.blood_group !== undefined ? req.body.blood_group : req.body.bloodGroup;
      const marital_status = req.body.marital_status !== undefined ? req.body.marital_status : req.body.maritalStatus;
      const qualification = req.body.qualification;
      const work_experience = req.body.work_experience !== undefined ? req.body.work_experience : req.body.workExperience;
      const address1 = req.body.address1 !== undefined ? req.body.address1 : (req.body.current_address_1 !== undefined ? req.body.current_address_1 : req.body.address);
      const address2 = req.body.address2 !== undefined ? req.body.address2 : req.body.current_address_2;
      const country = req.body.country !== undefined ? req.body.country : req.body.current_country;
      const state = req.body.state !== undefined ? req.body.state : req.body.current_state;
      const city = req.body.city !== undefined ? req.body.city : req.body.current_city;
      const postal_code = req.body.postal_code !== undefined ? req.body.postal_code : (req.body.current_postal_code !== undefined ? req.body.current_postal_code : req.body.postalCode);
      const picture = req.body.picture;
      const current_password = req.body.current_password;
      const new_password = req.body.new_password;

      const existingTeacher = await TeacherModel.findAuthProfileById(teacherId);
      if (!existingTeacher) {
        return ApiResponse.error(res, 'Teacher profile not found.', null, 404);
      }

      const updates = [];
      const params = [];

      if (first_name !== undefined) {
        updates.push('first_name = ?');
        params.push(first_name ? String(first_name).trim() : null);
      }
      if (last_name !== undefined) {
        updates.push('last_name = ?');
        params.push(last_name ? String(last_name).trim() : null);
      }
      if (primary_contact_number !== undefined) {
        updates.push('primary_contact_number = ?');
        params.push(primary_contact_number ? String(primary_contact_number).trim() : null);
      }
      if (email_address !== undefined) {
        updates.push('email_address = ?');
        params.push(email_address ? String(email_address).trim() : null);
      }
      if (gender !== undefined) {
        let normalizedGender = null;
        if (gender !== null && String(gender).trim() !== '') {
          const genStr = String(gender).toLowerCase();
          if (gender === 2 || gender === '2' || genStr.includes('fem')) {
            normalizedGender = 2;
          } else if (gender === 3 || gender === '3' || genStr.includes('oth')) {
            normalizedGender = 3;
          } else {
            normalizedGender = 1;
          }
        }
        updates.push('gender = ?');
        params.push(normalizedGender);
      }
      if (date_of_birth !== undefined) {
        let cleanDob = null;
        if (date_of_birth && String(date_of_birth).trim() !== '' && String(date_of_birth).trim() !== 'N/A') {
          const strDob = String(date_of_birth).trim().split(' ')[0].split('T')[0];
          if (/^\d{4}-\d{2}-\d{2}$/.test(strDob)) {
            cleanDob = `${strDob} 00:00:00`;
          } else {
            const parsed = new Date(date_of_birth);
            if (!isNaN(parsed.getTime())) {
              cleanDob = `${parsed.toISOString().slice(0, 10)} 00:00:00`;
            }
          }
        }
        updates.push('date_of_birth = ?');
        params.push(cleanDob);
      }
      if (blood_group !== undefined) {
        let normalizedBloodGroup = null;
        if (blood_group !== null && String(blood_group).trim() !== '' && String(blood_group).trim() !== 'N/A') {
          const bgStr = String(blood_group).trim();
          if (/^\d+$/.test(bgStr)) {
            normalizedBloodGroup = parseInt(bgStr, 10);
          } else {
            const [bgRows] = await pool.query(
              'SELECT id FROM blood_group_master WHERE blood_group = ? OR blood_group LIKE ? LIMIT 1',
              [bgStr, `%${bgStr}%`]
            );
            if (bgRows && bgRows.length > 0) {
              normalizedBloodGroup = bgRows[0].id;
            }
          }
        }
        updates.push('blood_group = ?');
        params.push(normalizedBloodGroup);
      }
      if (marital_status !== undefined) {
        let normalizedMarital = null;
        if (marital_status !== null && String(marital_status).trim() !== '' && String(marital_status).trim() !== 'N/A') {
          const marStr = String(marital_status).trim();
          if (/^\d+$/.test(marStr)) {
            normalizedMarital = parseInt(marStr, 10);
          } else {
            const [marRows] = await pool.query(
              'SELECT id FROM marital_master WHERE marital_status = ? OR marital_status LIKE ? LIMIT 1',
              [marStr, `%${marStr}%`]
            );
            if (marRows && marRows.length > 0) {
              normalizedMarital = marRows[0].id;
            } else {
              const lower = marStr.toLowerCase();
              if (lower.includes('single')) normalizedMarital = 1;
              else if (lower.includes('married')) normalizedMarital = 2;
              else if (lower.includes('divorced')) normalizedMarital = 3;
              else if (lower.includes('widow')) normalizedMarital = 4;
              else if (lower.includes('separat')) normalizedMarital = 5;
            }
          }
        }
        updates.push('marital_status = ?');
        params.push(normalizedMarital);
      }
      if (qualification !== undefined) {
        updates.push('qualification = ?');
        params.push(qualification ? String(qualification).trim() : null);
      }
      if (work_experience !== undefined) {
        updates.push('work_experience = ?');
        params.push(work_experience ? String(work_experience).trim() : null);
      }
      if (address1 !== undefined) {
        updates.push('address1 = ?');
        params.push(address1 ? String(address1).trim() : null);
      }
      if (address2 !== undefined) {
        updates.push('address2 = ?');
        params.push(address2 ? String(address2).trim() : null);
      }

      // Helper to resolve location ID
      const resolveLocationId = async (table, idCol, nameCol, value) => {
        if (value === undefined || value === null || value === '' || value === 'N/A') return null;
        const strVal = String(value).trim();
        if (/^\d+$/.test(strVal)) {
          const num = parseInt(strVal, 10);
          return num > 0 ? num : null;
        }
        try {
          const [rows] = await pool.query(
            `SELECT ${idCol} AS loc_id FROM ${table} WHERE ${nameCol} = ? OR ${nameCol} LIKE ? LIMIT 1`,
            [strVal, `%${strVal}%`]
          );
          if (rows && rows.length > 0) {
            return rows[0].loc_id;
          }
        } catch (err) {
          console.error(`Error resolving location for ${table}:`, err.message);
        }
        return null;
      };

      let cleanCountry = null;
      if (country !== undefined) {
        cleanCountry = await resolveLocationId('countries', 'id', 'name', country);
        updates.push('country = ?');
        params.push(cleanCountry);
      }
      let cleanState = null;
      if (state !== undefined) {
        cleanState = await resolveLocationId('states', 'id_state', 'state', state);
        updates.push('state = ?');
        params.push(cleanState);
      }
      let cleanCity = null;
      if (city !== undefined) {
        cleanCity = await resolveLocationId('cities', 'id', 'name', city);
        updates.push('city = ?');
        params.push(cleanCity);
      }

      let cleanPostalMaster = null;
      let cleanPostalAddress = null;
      if (postal_code !== undefined && postal_code !== null) {
        const pStr = String(postal_code).trim();
        if (pStr && pStr !== 'N/A' && pStr !== 'null') {
          cleanPostalMaster = pStr;
          const digits = pStr.replace(/\D/g, '');
          if (digits) {
            const num = parseInt(digits.slice(0, 9), 10);
            if (!isNaN(num) && num > 0) {
              cleanPostalAddress = num;
            }
          }
        }
      }

      if (postal_code !== undefined) {
        updates.push('postal_code = ?');
        params.push(cleanPostalMaster);
      }
      if (picture !== undefined) {
        updates.push('picture = ?');
        params.push(picture || null);
      }

      // Handle Password Change if requested
      if (new_password) {
        if (!current_password) {
          return ApiResponse.error(res, 'Current password is required to set a new password.', null, 400);
        }
        let isMatch = await comparePassword(current_password, existingTeacher.password);
        if (!isMatch && existingTeacher.passcode) {
          isMatch = await comparePassword(current_password, existingTeacher.passcode);
        }
        if (!isMatch) {
          return ApiResponse.error(res, 'Current password is incorrect.', null, 400);
        }
        const hashedPassword = await hashPassword(new_password);
        updates.push('password = ?');
        params.push(hashedPassword);
        updates.push('passcode = ?');
        params.push(hashedPassword);
      }

      if (updates.length > 0) {
        params.push(teacherId);
        await pool.query(`UPDATE teacher_master SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      // Sync teacher_address table
      if (
        country !== undefined ||
        state !== undefined ||
        city !== undefined ||
        postal_code !== undefined ||
        address1 !== undefined ||
        address2 !== undefined
      ) {
        try {
          const [addrRows] = await pool.query(
            'SELECT id FROM teacher_address WHERE teacher_id = ? AND address_type = 1 LIMIT 1',
            [teacherId]
          );

          const addrCountry = cleanCountry !== null ? cleanCountry : (existingTeacher.country || null);
          const addrState = cleanState !== null ? cleanState : (existingTeacher.state || null);
          const addrCity = cleanCity !== null ? cleanCity : (existingTeacher.city || null);
          const addrPostal = cleanPostalAddress !== null ? cleanPostalAddress : (existingTeacher.postal_code && !isNaN(parseInt(existingTeacher.postal_code, 10)) ? parseInt(existingTeacher.postal_code, 10) : null);
          const addr1 = address1 !== undefined ? (address1 ? String(address1).trim() : '') : (existingTeacher.address1 || '');
          const addr2 = address2 !== undefined ? (address2 ? String(address2).trim() : '') : (existingTeacher.address2 || '');
          const samePermanent = req.body.same_permanent !== undefined ? (Number(req.body.same_permanent) === 0 ? 0 : 1) : 1;

          if (addrRows && addrRows.length > 0) {
            const addrUpdates = [];
            const addrParams = [];
            if (address1 !== undefined) {
              addrUpdates.push('address1 = ?');
              addrParams.push(addr1);
            }
            if (address2 !== undefined) {
              addrUpdates.push('address2 = ?');
              addrParams.push(addr2);
            }
            if (country !== undefined) {
              addrUpdates.push('country = ?');
              addrParams.push(addrCountry);
            }
            if (state !== undefined) {
              addrUpdates.push('state = ?');
              addrParams.push(addrState);
            }
            if (city !== undefined) {
              addrUpdates.push('city = ?');
              addrParams.push(addrCity);
            }
            if (postal_code !== undefined) {
              addrUpdates.push('postal_code = ?');
              addrParams.push(addrPostal);
            }
            if (req.body.same_permanent !== undefined) {
              addrUpdates.push('same_permanent = ?');
              addrParams.push(samePermanent);
            }

            if (addrUpdates.length > 0) {
              addrParams.push(teacherId);
              await pool.query(
                `UPDATE teacher_address SET ${addrUpdates.join(', ')} WHERE teacher_id = ? AND address_type = 1`,
                addrParams
              );
            }
          } else {
            await pool.query(
              `INSERT INTO teacher_address 
               (school_id, teacher_id, address1, address2, country, state, city, postal_code, same_permanent, address_type, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
              [
                schoolId || existingTeacher.school_id,
                teacherId,
                addr1,
                addr2,
                addrCountry,
                addrState,
                addrCity,
                addrPostal,
                samePermanent,
              ]
            );
          }
        } catch (addrErr) {
          console.error('Error updating teacher_address:', addrErr.message);
        }
      }

      // Fetch refreshed teacher profile
      const updatedTeacher = await TeacherModel.findAuthProfileById(teacherId);
      const { password: _, passcode: __, otp: ___, ...safeTeacher } = updatedTeacher;

      return ApiResponse.success(res, 'Teacher profile updated successfully.', {
        teacher: TeacherAuthController._formatTeacherResponse(safeTeacher),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Teacher Logout Controller
   */
  static async logout(req, res) {
    try {
      const cookieName = config.cookie?.name || 'growvidya_session';
      const cookieOptions = {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        path: '/',
      };

      res.clearCookie('growvidya_teacher_session', cookieOptions);

      return ApiResponse.success(res, 'Teacher logged out successfully. Session cleared.');
    } catch (error) {
      return ApiResponse.error(res, 'Failed to logout cleanly.', error.message, 500);
    }
  }
}

module.exports = TeacherAuthController;
