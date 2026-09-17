const path = require('path');
const fs = require('fs');
const CertificateModel = require('../models/certificate.model');
const CertificatePdfService = require('../services/certificatePdf.service');
const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

// Helper to parse JPEG image dimensions
function getJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length - 8) {
    if (buffer[offset] !== 0xFF) { offset++; continue; }
    const marker = buffer[offset + 1];
    if (
      (marker >= 0xC0 && marker <= 0xC3) ||
      (marker >= 0xC5 && marker <= 0xC7) ||
      (marker >= 0xC9 && marker <= 0xCB) ||
      (marker >= 0xCD && marker <= 0xCF)
    ) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    if (offset + 4 > buffer.length) break;
    const length = buffer.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return null;
}

// ================= CATEGORIES =================
exports.getAllCategories = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { search, status } = req.query;
    const categories = await CertificateModel.getAllCategories(schoolId, { search, status });
    return ApiResponse.success(res, 'Certificate categories retrieved successfully', categories);
  } catch (err) {
    console.error('Error in getAllCategories:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.getCategoryById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const category = await CertificateModel.getCategoryById(id, schoolId);
    if (!category) {
      return ApiResponse.error(res, 'Category not found', null, 404);
    }
    return ApiResponse.success(res, 'Category retrieved successfully', category);
  } catch (err) {
    console.error('Error in getCategoryById:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.createCategory = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const userId = req.user?.id || 1;
    const { category_name, sort_order, status } = req.body;

    const errors = {};

    // Validate category_name
    if (!category_name || typeof category_name !== 'string' || !category_name.trim()) {
      errors.category_name = 'Category name is required.';
    } else if (category_name.trim().length < 2) {
      errors.category_name = 'Category name must be at least 2 characters long.';
    } else if (category_name.trim().length > 100) {
      errors.category_name = 'Category name cannot exceed 100 characters.';
    }

    // Validate sort_order
    let parsedSortOrder = 0;
    if (sort_order !== undefined && sort_order !== null && sort_order !== '') {
      parsedSortOrder = Number(sort_order);
      if (isNaN(parsedSortOrder) || !Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
        errors.sort_order = 'Sort order must be a valid non-negative whole number.';
      }
    }

    // Validate status
    let parsedStatus = 1;
    if (status !== undefined && status !== null && status !== '') {
      parsedStatus = Number(status);
      if (![1, 2].includes(parsedStatus)) {
        errors.status = 'Status must be either 1 (Active) or 2 (Inactive).';
      }
    }

    if (Object.keys(errors).length > 0) {
      return ApiResponse.error(res, 'Validation failed. Please check the fields.', errors, 400);
    }

    // Check for duplicate category name within this school
    const existing = await CertificateModel.getCategoryByName(category_name.trim(), schoolId);
    if (existing) {
      return ApiResponse.error(res, 'A certificate category with this name already exists.', {
        category_name: 'A category with this name already exists in your school.',
      }, 409);
    }

    const insertId = await CertificateModel.createCategory({
      school_id: schoolId,
      category_name: category_name.trim(),
      sort_order: parsedSortOrder,
      status: parsedStatus,
      created_by: userId,
    });

    return ApiResponse.success(res, 'Certificate category created successfully.', { id: insertId }, 201);
  } catch (err) {
    console.error('Error in createCategory:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const userId = req.user?.id || 1;
    const { id } = req.params;
    const { category_name, sort_order, status } = req.body;

    const existingCategory = await CertificateModel.getCategoryById(id, schoolId);
    if (!existingCategory) {
      return ApiResponse.error(res, 'Certificate category not found.', null, 404);
    }

    const errors = {};

    let cleanName = undefined;
    if (category_name !== undefined) {
      if (!category_name || typeof category_name !== 'string' || !category_name.trim()) {
        errors.category_name = 'Category name cannot be empty.';
      } else if (category_name.trim().length < 2) {
        errors.category_name = 'Category name must be at least 2 characters long.';
      } else if (category_name.trim().length > 100) {
        errors.category_name = 'Category name cannot exceed 100 characters.';
      } else {
        cleanName = category_name.trim();
        const duplicate = await CertificateModel.getCategoryByName(cleanName, schoolId, id);
        if (duplicate) {
          errors.category_name = 'A category with this name already exists in your school.';
        }
      }
    }

    let parsedSortOrder = undefined;
    if (sort_order !== undefined && sort_order !== null && sort_order !== '') {
      parsedSortOrder = Number(sort_order);
      if (isNaN(parsedSortOrder) || !Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
        errors.sort_order = 'Sort order must be a valid non-negative whole number.';
      }
    }

    let parsedStatus = undefined;
    if (status !== undefined && status !== null && status !== '') {
      parsedStatus = Number(status);
      if (![1, 2].includes(parsedStatus)) {
        errors.status = 'Status must be either 1 (Active) or 2 (Inactive).';
      }
    }

    if (Object.keys(errors).length > 0) {
      return ApiResponse.error(res, 'Validation failed. Please check the fields.', errors, 400);
    }

    const success = await CertificateModel.updateCategory(id, schoolId, {
      category_name: cleanName,
      sort_order: parsedSortOrder,
      status: parsedStatus,
      modify_by: userId,
    });

    if (!success) {
      return ApiResponse.error(res, 'Category not found or no changes made.', null, 400);
    }

    return ApiResponse.success(res, 'Certificate category updated successfully.');
  } catch (err) {
    console.error('Error in updateCategory:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const success = await CertificateModel.deleteCategory(id, schoolId);
    if (!success) {
      return ApiResponse.error(res, 'Category not found', null, 404);
    }
    return ApiResponse.success(res, 'Certificate category deleted successfully');
  } catch (err) {
    console.error('Error in deleteCategory:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

// ================= TEMPLATES =================
exports.getAllTemplates = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { categoryId, search, status } = req.query;
    const templates = await CertificateModel.getAllTemplates(schoolId, { categoryId, search, status });
    return ApiResponse.success(res, 'Certificate templates retrieved successfully', templates);
  } catch (err) {
    console.error('Error in getAllTemplates:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.getTemplateById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const template = await CertificateModel.getTemplateById(id, schoolId);
    if (!template) {
      return ApiResponse.error(res, 'Template not found', null, 404);
    }
    return ApiResponse.success(res, 'Template retrieved successfully', template);
  } catch (err) {
    console.error('Error in getTemplateById:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const userId = req.user?.id || 1;
    const {
      certificate_category,
      template_name,
      certificate_heading,
      short_description,
      description,
      border,
      certified_by,
      status,
    } = req.body;

    if (!template_name || !template_name.trim()) {
      return ApiResponse.error(res, 'Template name is required', null, 400);
    }
    if (!certificate_category) {
      return ApiResponse.error(res, 'Certificate category is required', null, 400);
    }
    if (!description || !description.trim()) {
      return ApiResponse.error(res, 'Certificate content/description is required', null, 400);
    }

    const insertId = await CertificateModel.createTemplate({
      school_id: schoolId,
      certificate_category: Number(certificate_category),
      template_name: template_name.trim(),
      certificate_heading: certificate_heading ? certificate_heading.trim() : '',
      short_description: short_description || '',
      description: description.trim(),
      border: border !== undefined ? String(border) : '1',
      certified_by: certified_by ? certified_by.trim() : 'Principal',
      status: status !== undefined ? Number(status) : 1,
      created_by: userId,
    });

    return ApiResponse.success(res, 'Certificate template created successfully', { id: insertId }, 201);
  } catch (err) {
    console.error('Error in createTemplate:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const userId = req.user?.id || 1;
    const { id } = req.params;
    const {
      certificate_category,
      template_name,
      certificate_heading,
      short_description,
      description,
      border,
      certified_by,
      status,
    } = req.body;

    const success = await CertificateModel.updateTemplate(id, schoolId, {
      certificate_category: certificate_category !== undefined ? Number(certificate_category) : undefined,
      template_name: template_name ? template_name.trim() : undefined,
      certificate_heading: certificate_heading !== undefined ? certificate_heading.trim() : undefined,
      short_description: short_description !== undefined ? short_description : undefined,
      description: description !== undefined ? description.trim() : undefined,
      border: border !== undefined ? String(border) : undefined,
      certified_by: certified_by !== undefined ? certified_by.trim() : undefined,
      status: status !== undefined ? Number(status) : undefined,
      modify_by: userId,
    });

    if (!success) {
      return ApiResponse.error(res, 'Template not found or not modified', null, 404);
    }

    return ApiResponse.success(res, 'Certificate template updated successfully');
  } catch (err) {
    console.error('Error in updateTemplate:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const success = await CertificateModel.deleteTemplate(id, schoolId);
    if (!success) {
      return ApiResponse.error(res, 'Template not found', null, 404);
    }
    return ApiResponse.success(res, 'Certificate template deleted successfully');
  } catch (err) {
    console.error('Error in deleteTemplate:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

// ================= BORDERS =================
exports.getAllBorders = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { search, status, page, limit } = req.query;
    const borders = await CertificateModel.getAllBorders(schoolId, { search, status, page, limit });
    return ApiResponse.success(res, 'Certificate borders retrieved successfully', borders);
  } catch (err) {
    console.error('Error in getAllBorders:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.getBorderById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const border = await CertificateModel.getBorderById(id, schoolId);
    if (!border) {
      return ApiResponse.error(res, 'Certificate border not found', null, 404);
    }
    return ApiResponse.success(res, 'Certificate border retrieved successfully', border);
  } catch (err) {
    console.error('Error in getBorderById:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.createBorder = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    let imagePath = '';
    const status = req.body.status !== undefined && req.body.status !== null ? Number(req.body.status) : 1;

    if (req.file) {
      // Strict A4 Portrait Dimension Validation on Server
      const buffer = fs.readFileSync(req.file.path);
      const dims = getJpegDimensions(buffer);

      if (!dims || !dims.width || !dims.height) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(res, 'Invalid JPEG image or corrupted header.', null, 400);
      }

      const { width, height } = dims;
      const ratio = width / height;

      // 1. Must be Portrait orientation (Height > Width)
      if (height <= width) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(
          res,
          `Strict A4 Portrait requirement: Image must be in Portrait orientation (Height > Width). Uploaded image is ${width} × ${height} px.`,
          null,
          400
        );
      }

      // 2. Minimum resolution check for clear printing
      if (height < 1000 || width < 700) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(
          res,
          `Image resolution too low (${width} × ${height} px)! Minimum required is 794 × 1123 px (Standard A4 Portrait is 2480 × 3508 px or 1240 × 1754 px).`,
          null,
          400
        );
      }

      // 3. Strict A4 Portrait Aspect Ratio (210/297 ≈ 0.70707)
      if (Math.abs(ratio - (210 / 297)) > 0.05) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(
          res,
          `Dimension mismatch! Image must strictly follow A4 Portrait proportions (Aspect ratio 0.707 : 1, e.g. 2480 × 3508 px, 1240 × 1754 px, or 794 × 1123 px). Uploaded image is ${width} × ${height} px (Ratio: ${ratio.toFixed(2)} : 1).`,
          null,
          400
        );
      }

      const uploadRoot = path.join(__dirname, '../public/upload');
      let folderRel = '';
      if (req.file.destination) {
        folderRel = path.relative(uploadRoot, req.file.destination).replace(/\\/g, '/');
      }
      const cleanFolder = folderRel && folderRel !== '.' ? `${folderRel}/` : 'template/';
      imagePath = `upload/${cleanFolder}${req.file.filename}`;
    } else if (req.body.image) {
      imagePath = req.body.image.trim();
    } else {
      return ApiResponse.error(res, 'Border image file (.jpg/.jpeg) is required.', null, 400);
    }

    const insertId = await CertificateModel.createBorder({
      school_id: schoolId,
      image: imagePath,
      status: status,
    });

    const newBorder = await CertificateModel.getBorderById(insertId, schoolId);

    return ApiResponse.success(res, 'A4 Portrait Certificate border uploaded successfully', newBorder, 201);
  } catch (err) {
    console.error('Error in createBorder:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.updateBorder = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    let imagePath = undefined;
    let status = req.body.status !== undefined && req.body.status !== null ? Number(req.body.status) : undefined;

    if (req.file) {
      // Strict A4 Portrait Dimension Validation on Server
      const buffer = fs.readFileSync(req.file.path);
      const dims = getJpegDimensions(buffer);

      if (!dims || !dims.width || !dims.height) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(res, 'Invalid JPEG image or corrupted header.', null, 400);
      }

      const { width, height } = dims;
      const ratio = width / height;

      if (height <= width) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(
          res,
          `Strict A4 Portrait requirement: Image must be in Portrait orientation (Height > Width). Uploaded image is ${width} × ${height} px.`,
          null,
          400
        );
      }

      if (height < 1000 || width < 700) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(
          res,
          `Image resolution too low (${width} × ${height} px)! Minimum required is 794 × 1123 px (Standard A4 Portrait is 2480 × 3508 px or 1240 × 1754 px).`,
          null,
          400
        );
      }

      if (Math.abs(ratio - (210 / 297)) > 0.05) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return ApiResponse.error(
          res,
          `Dimension mismatch! Image must strictly follow A4 Portrait proportions (Aspect ratio 0.707 : 1, e.g. 2480 × 3508 px, 1240 × 1754 px, or 794 × 1123 px). Uploaded image is ${width} × ${height} px (Ratio: ${ratio.toFixed(2)} : 1).`,
          null,
          400
        );
      }

      const uploadRoot = path.join(__dirname, '../public/upload');
      let folderRel = '';
      if (req.file.destination) {
        folderRel = path.relative(uploadRoot, req.file.destination).replace(/\\/g, '/');
      }
      const cleanFolder = folderRel && folderRel !== '.' ? `${folderRel}/` : 'template/';
      imagePath = `upload/${cleanFolder}${req.file.filename}`;
    } else if (req.body.image) {
      imagePath = req.body.image.trim();
    }

    const success = await CertificateModel.updateBorder(id, schoolId, { image: imagePath, status });
    if (!success) {
      return ApiResponse.error(res, 'Border not found or no changes made', null, 404);
    }

    const updated = await CertificateModel.getBorderById(id, schoolId);
    return ApiResponse.success(res, 'Certificate border updated successfully', updated);
  } catch (err) {
    console.error('Error in updateBorder:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.deleteBorder = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const success = await CertificateModel.deleteBorder(id, schoolId);
    if (!success) {
      return ApiResponse.error(res, 'Border not found', null, 404);
    }
    return ApiResponse.success(res, 'Certificate border deleted successfully');
  } catch (err) {
    console.error('Error in deleteBorder:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

// ================= ISSUED CERTIFICATES (CERTIFICATE CREATE) =================
exports.getAllIssuedCertificates = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { classId, sectionId, academicYear, studentId, categoryId, templateId, search, page, limit } = req.query;

    const list = await CertificateModel.getAllIssuedCertificates(schoolId, {
      classId,
      sectionId,
      academicYear,
      studentId,
      categoryId,
      templateId,
      search,
      page: page ? parseInt(page, 10) : null,
      limit: limit ? parseInt(limit, 10) : null,
    });

    return ApiResponse.success(res, 'Issued certificates retrieved successfully', list);
  } catch (err) {
    console.error('Error in getAllIssuedCertificates:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.getIssuedCertificateById = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const cert = await CertificateModel.getIssuedCertificateById(id, schoolId);
    if (!cert) {
      return ApiResponse.error(res, 'Certificate not found', null, 404);
    }
    return ApiResponse.success(res, 'Certificate retrieved successfully', cert);
  } catch (err) {
    console.error('Error in getIssuedCertificateById:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

// Helper to format date string to DD/MM/YYYY
const formatCertificateDate = (dateVal) => {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Helper to replace template placeholder tags
const replaceCertificatePlaceholders = (templateText, student, extra = {}) => {
  if (!templateText) return '';
  const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim();
  const dob = formatCertificateDate(student.date_of_birth);
  const guardian = student.guardian_name || student.father_name || '';
  const className = student.class_name || extra.className || '';
  const sectionName = student.section_name || extra.sectionName || '';
  const rollNo = student.roll_number || extra.rollNumber || '';
  const admissionNo = student.admission_number || (student.id ? `AD${student.id}` : '');
  const admissionDate = formatCertificateDate(student.admission_date);
  const academicYear = student.academic_year_name || extra.academicYear || '2025-2026';
  const currentDate = formatCertificateDate(extra.date || new Date().toISOString().split('T')[0]);

  // Normalize single line breaks within prose to spaces while preserving intentional paragraph breaks
  let cleanText = templateText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((para) => para.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');

  let result = cleanText
    .replace(/\{\{\s*name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*student_name\s*\}\}/gi, fullName)
    .replace(/\{\{\s*guardian_name\s*\}\}/gi, guardian)
    .replace(/\{\{\s*father_name\s*\}\}/gi, guardian)
    .replace(/\{\{\s*date_of_birth\s*\}\}/gi, dob)
    .replace(/\{\{\s*dob\s*\}\}/gi, dob)
    .replace(/\{\{\s*class\s*\}\}/gi, className)
    .replace(/\{\{\s*class_name\s*\}\}/gi, className)
    .replace(/\{\{\s*section\s*\}\}/gi, sectionName)
    .replace(/\{\{\s*roll_number\s*\}\}/gi, rollNo)
    .replace(/\{\{\s*roll_no\s*\}\}/gi, rollNo)
    .replace(/\{\{\s*admission_number\s*\}\}/gi, admissionNo)
    .replace(/\{\{\s*admission_no\s*\}\}/gi, admissionNo)
    .replace(/\{\{\s*admission_date\s*\}\}/gi, admissionDate)
    .replace(/\{\{\s*academic_year\s*\}\}/gi, academicYear)
    .replace(/\{\{\s*date\s*\}\}/gi, currentDate)
    .replace(/\{\{\s*issue_date\s*\}\}/gi, currentDate);

  // Format any raw ISO or SQL datetime strings like "2010-02-06 00:00:00" or "2026-09-10" to DD/MM/YYYY
  result = result.replace(/(\d{4})-(\d{2})-(\d{2})(?:\s+\d{2}:\d{2}:\d{2})?/g, (match, y, m, d) => `${d}/${m}/${y}`);

  return result;
};

exports.populateTemplate = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { templateId, studentId, date } = req.body;

    if (!templateId || !studentId) {
      return ApiResponse.error(res, 'templateId and studentId are required', null, 400);
    }

    const template = await CertificateModel.getTemplateById(templateId, schoolId);
    if (!template) {
      return ApiResponse.error(res, 'Template not found', null, 404);
    }

    const [studentRows] = await pool.query(
      `SELECT s.*, scl.roll_number, scl.class_id, scl.section_id, scl.academic_year,
              cm.class_name, sec.section_name, ay.academic_year as academic_year_name
       FROM student_master s
       LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
       LEFT JOIN class_master cm ON scl.class_id = cm.id
       LEFT JOIN section_master sec ON scl.section_id = sec.id
       LEFT JOIN academic_year_master ay ON scl.academic_year = ay.id
       WHERE s.id = ? AND s.school_id = ?`,
      [studentId, schoolId]
    );

    const student = studentRows[0] || {};
    const populated = replaceCertificatePlaceholders(template.description, student, { date });

    return ApiResponse.success(res, 'Template populated successfully', {
      template,
      student,
      populatedDescription: populated,
    });
  } catch (err) {
    console.error('Error in populateTemplate:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.createIssuedCertificate = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const userId = req.user?.id || 1;
    const {
      certificate_category_id,
      certificate_template_id,
      student_id,
      certificate_date,
      certificate_description,
      status,
    } = req.body;

    if (!certificate_category_id || !certificate_template_id || !student_id) {
      return ApiResponse.error(
        res,
        'certificate_category_id, certificate_template_id, and student_id are required',
        null,
        400
      );
    }

    // Check if certificate in same category is already issued to this student
    const [existingRows] = await pool.query(
      `SELECT id FROM student_certificate 
       WHERE school_id = ? AND student_id = ? AND certificate_category_id = ? AND status != 4`,
      [schoolId, student_id, certificate_category_id]
    );

    if (existingRows && existingRows.length > 0) {
      return ApiResponse.error(
        res,
        'A certificate for this category has already been issued to the student.',
        null,
        400
      );
    }

    let finalDesc = certificate_description;
    if (!finalDesc || !finalDesc.trim()) {
      // Auto populate from template if description not passed
      const template = await CertificateModel.getTemplateById(certificate_template_id, schoolId);
      const [studentRows] = await pool.query(
        `SELECT s.*, scl.roll_number, scl.class_id, scl.section_id, scl.academic_year,
                cm.class_name, sec.section_name, ay.academic_year as academic_year_name
         FROM student_master s
         LEFT JOIN student_class scl ON s.id = scl.student_id AND scl.status = 1
         LEFT JOIN class_master cm ON scl.class_id = cm.id
         LEFT JOIN section_master sec ON scl.section_id = sec.id
         LEFT JOIN academic_year_master ay ON scl.academic_year = ay.id
         WHERE s.id = ? AND s.school_id = ?`,
        [student_id, schoolId]
      );
      finalDesc = replaceCertificatePlaceholders(template?.description || '', studentRows[0] || {}, {
        date: certificate_date,
      });
    }

    const insertId = await CertificateModel.createIssuedCertificate({
      school_id: schoolId,
      certificate_category_id: Number(certificate_category_id),
      certificate_template_id: Number(certificate_template_id),
      student_id: Number(student_id),
      certificate_date: certificate_date || new Date().toISOString().split('T')[0],
      certificate_description: finalDesc,
      status: status !== undefined ? Number(status) : 1,
      created_by: userId,
    });

    return ApiResponse.success(res, 'Certificate issued successfully', { id: insertId }, 201);
  } catch (err) {
    console.error('Error in createIssuedCertificate:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.deleteIssuedCertificate = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;
    const success = await CertificateModel.deleteIssuedCertificate(id, schoolId);
    if (!success) {
      return ApiResponse.error(res, 'Issued certificate not found', null, 404);
    }
    return ApiResponse.success(res, 'Certificate deleted successfully');
  } catch (err) {
    console.error('Error in deleteIssuedCertificate:', err);
    return ApiResponse.error(res, 'Internal server error', null, 500);
  }
};

exports.downloadIssuedCertificate = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { id } = req.params;

    const cert = await CertificateModel.getIssuedCertificateById(id, schoolId);
    if (!cert) {
      return ApiResponse.error(res, 'Certificate not found', null, 404);
    }

    const allBorders = await CertificateModel.getAllBorders(schoolId);
    const borderMap = {};
    if (Array.isArray(allBorders)) {
      for (const b of allBorders) {
        borderMap[String(b.id)] = b.image;
      }
    }

    const borderImg = borderMap[String(cert.certificate_border_id)] || borderMap[String(cert.border)] || null;
    const certWithBorder = {
      ...cert,
      borderImg,
    };

    // If client specifically asks for JSON data (e.g. for preview modal)
    if (req.query.format === 'json') {
      return ApiResponse.success(res, 'Certificate data retrieved successfully', certWithBorder);
    }

    // Generate PDF Buffer on the backend from HTML/CSS template
    const pdfBuffer = await CertificatePdfService.generateCertificatesPdfBuffer(certWithBorder);

    const studentName = `${cert.first_name || ''}_${cert.last_name || ''}`.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'Student';
    const fileName = `Certificate_${studentName}_${cert.id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('Error in downloadIssuedCertificate:', err);
    return ApiResponse.error(res, 'Failed to generate certificate PDF', null, 500);
  }
};

exports.downloadBulkIssuedCertificates = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.school_id || 1;
    const { ids, categoryId, classId, sectionId } = req.body || {};

    let certList = [];
    if (Array.isArray(ids) && ids.length > 0) {
      const certPromises = ids.map((id) => CertificateModel.getIssuedCertificateById(id, schoolId));
      const results = await Promise.all(certPromises);
      certList = results.filter(Boolean);
    } else {
      const rawList = await CertificateModel.getAllIssuedCertificates(schoolId, {
        categoryId,
        classId,
        sectionId,
      });
      certList = Array.isArray(rawList?.data) ? rawList.data : Array.isArray(rawList) ? rawList : [];
    }

    if (!certList || certList.length === 0) {
      return ApiResponse.error(res, 'No certificates found for export', null, 404);
    }

    // Fetch school information if not already joined
    const [schoolRows] = await pool.query(
      `SELECT school_name, school_code, address as school_address, email as school_email, 
              phone_number as school_phone, school_logo, affiliation_board 
       FROM school_master WHERE id = ?`,
      [schoolId]
    );
    const schoolInfo = schoolRows[0] || {};

    const allBorders = await CertificateModel.getAllBorders(schoolId);
    const borderMap = {};
    if (Array.isArray(allBorders)) {
      for (const b of allBorders) {
        borderMap[String(b.id)] = b.image;
      }
    }

    const certsWithBorders = certList.map((cert) => ({
      ...schoolInfo,
      ...cert,
      borderImg: borderMap[String(cert.certificate_border_id)] || borderMap[String(cert.border)] || null,
    }));

    // If client specifically asks for JSON data
    if (req.query.format === 'json') {
      return ApiResponse.success(res, 'Bulk certificates data retrieved successfully', certsWithBorders);
    }

    // Generate multi-page PDF buffer on the backend
    const pdfBuffer = await CertificatePdfService.generateCertificatesPdfBuffer(certsWithBorders);

    const todayStr = new Date().toISOString().split('T')[0];
    const fileName = `Student_Certificates_${todayStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('Error in downloadBulkIssuedCertificates:', err);
    return ApiResponse.error(res, 'Failed to generate bulk certificate PDF', null, 500);
  }
};

