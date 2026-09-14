const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATES_DIR = path.join(__dirname, '../templates/idcards');

/**
 * Loads the appropriate template HTML from disk
 */
const getTemplateHtml = (type) => {
  const fileName = `${type.toLowerCase()}-idcard.html`;
  const filePath = path.join(TEMPLATES_DIR, fileName);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  // Fallback to student template
  return fs.readFileSync(path.join(TEMPLATES_DIR, 'student-idcard.html'), 'utf8');
};

/**
 * Converts a local file path to base64 Data URI for fast and reliable Puppeteer rendering
 */
const toBase64DataUri = (imgUrlOrPath) => {
  if (!imgUrlOrPath) return '';
  if (typeof imgUrlOrPath !== 'string') return '';
  if (imgUrlOrPath.startsWith('data:')) return imgUrlOrPath;

  try {
    let cleanPath = imgUrlOrPath.replace(/^https?:\/\/[^\/]+/i, '');
    if (cleanPath.startsWith('/')) cleanPath = cleanPath.substring(1);

    const fullPath = path.isAbsolute(imgUrlOrPath)
      ? imgUrlOrPath
      : path.join(__dirname, '../public', cleanPath);

    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase().replace('.', '') || 'jpeg';
      const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
      const data = fs.readFileSync(fullPath).toString('base64');
      return `data:${mime};base64,${data}`;
    }
  } catch (err) {
    console.warn('[idCardPdf.service] Failed to convert image to base64:', err.message);
  }

  return imgUrlOrPath;
};

/**
 * Formats academic session as range
 */
const formatAcademicSession = (rawSession) => {
  if (!rawSession) {
    const curYear = new Date().getFullYear();
    return `${curYear}-${curYear + 1}`;
  }
  const str = String(rawSession).trim();
  const match = str.match(/^(\d{4})$/);
  if (match) {
    const y = parseInt(match[1], 10);
    return `${y}-${y + 1}`;
  }
  return str;
};

/**
 * Computes standard validity date (e.g. 31 March of next year)
 */
const getValidityString = (academicYearStr) => {
  if (academicYearStr) {
    const match = String(academicYearStr).match(/(\d{4})/g);
    if (match && match.length >= 2) {
      return `31 Mar ${match[1]}`;
    }
  }
  const nextYear = new Date().getFullYear() + 1;
  return `31 Mar ${nextYear}`;
};

/**
 * Blood group ID fallback dictionary
 */
const BLOOD_GROUP_MAP = {
  '1': 'A+',
  '2': 'A-',
  '3': 'B+',
  '4': 'B-',
  '5': 'AB+',
  '6': 'AB-',
  '7': 'AB-',
  '8': 'O+',
  '9': 'O-',
};

const formatBloodGroup = (bg) => {
  if (!bg) return '—';
  const str = String(bg).trim();
  if (BLOOD_GROUP_MAP[str]) return BLOOD_GROUP_MAP[str];
  if (/^\d+$/.test(str)) return '—';
  return str;
};

/**
 * Formats dates into DD/MM/YYYY
 */
const formatDisplayDate = (rawDate) => {
  if (!rawDate) return '—';
  try {
    const str = String(rawDate).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const d = new Date(rawDate);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch (e) {}
  return '—';
};

/**
 * Builds HTML for an individual card item according to its type
 */
const buildSingleCardBodyHtml = (type, item, template) => {
  const school = item.school || {};
  const schoolTitle = school.school_title || school.school_name || 'Growvidya Academy';
  const schoolSubtitle = [school.city, school.state].filter(Boolean).join(', ') || (school.school_code ? `Code: ${school.school_code}` : 'Official Campus');

  const rawSchoolLogo = toBase64DataUri(school.school_logo);
  const schoolLogoHtml = rawSchoolLogo
    ? `<img src="${rawSchoolLogo}" alt="Logo" class="school-logo" onerror="this.style.display='none'" />`
    : `<div class="no-logo-badge">LOGO</div>`;

  if (type === 'student') {
    const student = item.candidate || item.student || {};
    const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Student';
    const rollNo = student.roll_number || student.roll_no || '—';
    const admissionNo = student.admission_number || student.admission_no || (student.id ? `AD${student.id}` : '—');
    const className = student.class_name || 'Class';
    const sectionName = student.section_name || 'A';
    const fatherName = student.father_name || '—';
    const bloodGroup = formatBloodGroup(student.blood_group);
    const contactNo = student.primary_contact_number || student.emergency_contact || student.phone || '—';
    const academicYear = formatAcademicSession(item.academic_year || student.academic_year);
    const validUntil = getValidityString(academicYear);

    const rawPhoto = toBase64DataUri(student.picture);
    const photoHtml = rawPhoto
      ? `<img src="${rawPhoto}" alt="Photo" class="photo-img" onerror="this.style.display='none'" />`
      : `<div class="photo-placeholder">STUDENT PHOTO</div>`;

    return template
      .replace(/\{\{school_title\}\}/g, schoolTitle)
      .replace(/\{\{school_subtitle\}\}/g, schoolSubtitle)
      .replace(/\{\{school_logo_html\}\}/g, schoolLogoHtml)
      .replace(/\{\{student_name\}\}/g, studentName)
      .replace(/\{\{class_name\}\}/g, className)
      .replace(/\{\{section_name\}\}/g, sectionName)
      .replace(/\{\{roll_no\}\}/g, rollNo)
      .replace(/\{\{admission_no\}\}/g, admissionNo)
      .replace(/\{\{father_name\}\}/g, fatherName)
      .replace(/\{\{blood_group\}\}/g, bloodGroup)
      .replace(/\{\{contact_no\}\}/g, contactNo)
      .replace(/\{\{academic_year\}\}/g, academicYear)
      .replace(/\{\{valid_until\}\}/g, validUntil)
      .replace(/\{\{photo_html\}\}/g, photoHtml);
  }

  if (type === 'teacher') {
    const teacher = item.candidate || item.teacher || {};
    const teacherName = `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim() || 'Faculty Member';
    const teacherId = teacher.teacher_id || `TCH-${teacher.id || '1001'}`;
    const designation = teacher.designation || (teacher.subject ? `${teacher.subject} Faculty` : 'Senior Teacher');
    const qualification = teacher.qualification || 'Post Graduate';
    const rawJoining = teacher.date_of_joining || teacher.joining_date || teacher.doj || teacher.dateOfJoining || teacher.created_on;
    const joiningDate = formatDisplayDate(rawJoining);
    const bloodGroup = formatBloodGroup(teacher.blood_group);
    const contactNo = teacher.primary_contact_number || teacher.phone || '—';
    const validUntil = getValidityString(null);

    const rawPhoto = toBase64DataUri(teacher.picture);
    const photoHtml = rawPhoto
      ? `<img src="${rawPhoto}" alt="Photo" class="photo-img" onerror="this.style.display='none'" />`
      : `<div class="photo-placeholder">FACULTY PHOTO</div>`;

    return template
      .replace(/\{\{school_title\}\}/g, schoolTitle)
      .replace(/\{\{school_subtitle\}\}/g, schoolSubtitle)
      .replace(/\{\{school_logo_html\}\}/g, schoolLogoHtml)
      .replace(/\{\{teacher_name\}\}/g, teacherName)
      .replace(/\{\{teacher_id\}\}/g, teacherId)
      .replace(/\{\{designation\}\}/g, designation)
      .replace(/\{\{qualification\}\}/g, qualification)
      .replace(/\{\{joining_date\}\}/g, joiningDate)
      .replace(/\{\{blood_group\}\}/g, bloodGroup)
      .replace(/\{\{contact_no\}\}/g, contactNo)
      .replace(/\{\{valid_until\}\}/g, validUntil)
      .replace(/\{\{photo_html\}\}/g, photoHtml);
  }

  // Staff
  const staff = item.candidate || item.staff || {};
  const staffName = `${staff.first_name || ''} ${staff.last_name || ''}`.trim() || 'Staff Member';
  const employeeId = staff.employee_id || `STF-${staff.id || '1001'}`;
  const roleName = staff.role_name || staff.role || 'Administrative Staff';
  const department = staff.department || roleName;
  const bloodGroup = formatBloodGroup(staff.blood_group);
  const contactNo = staff.phone || staff.primary_contact_number || '—';
  const email = staff.email || '—';
  const validUntil = getValidityString(null);

  const rawPhoto = toBase64DataUri(staff.picture);
  const photoHtml = rawPhoto
    ? `<img src="${rawPhoto}" alt="Photo" class="photo-img" onerror="this.style.display='none'" />`
    : `<div class="photo-placeholder">STAFF PHOTO</div>`;

  return template
    .replace(/\{\{school_title\}\}/g, schoolTitle)
    .replace(/\{\{school_subtitle\}\}/g, schoolSubtitle)
    .replace(/\{\{school_logo_html\}\}/g, schoolLogoHtml)
    .replace(/\{\{staff_name\}\}/g, staffName)
    .replace(/\{\{employee_id\}\}/g, employeeId)
    .replace(/\{\{role_name\}\}/g, roleName)
    .replace(/\{\{department\}\}/g, department)
    .replace(/\{\{blood_group\}\}/g, bloodGroup)
    .replace(/\{\{contact_no\}\}/g, contactNo)
    .replace(/\{\{email\}\}/g, email)
    .replace(/\{\{valid_until\}\}/g, validUntil)
    .replace(/\{\{photo_html\}\}/g, photoHtml);
};

class IdCardPdfService {
  /**
   * Generates a CR80 standard (54mm x 86mm) high-res vector PDF buffer
   * @param {string} type - 'student' | 'teacher' | 'staff'
   * @param {Array<Object>} itemsList - array of card data items
   * @returns {Promise<Buffer>}
   */
  static async generateIdCardPdfBuffer(type, itemsList = []) {
    const rawTemplate = getTemplateHtml(type);

    // Extract HTML body content template
    // We replace the outer body with multiple idcard-wrapper blocks for multi-page batch rendering
    const cardsHtml = itemsList.map((item) => {
      return buildSingleCardBodyHtml(type, item, rawTemplate);
    });

    // Extract head styles from template
    const headMatch = rawTemplate.match(/<head>([\s\S]*?)<\/head>/i);
    const headContent = headMatch ? headMatch[1] : '';

    // Combine into a multi-page document where each card wrapper has page-break-after: always
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        ${headContent}
      </head>
      <body>
        ${cardsHtml.map((c) => {
          // Extract the <div class="idcard-wrapper">...</div>
          const m = c.match(/<div class="idcard-wrapper">([\s\S]*?)<\/div>\s*<\/body>/i);
          return m ? `<div class="idcard-wrapper">${m[1]}</div>` : c;
        }).join('\n')}
      </body>
      </html>
    `;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(fullHtml, {
        waitUntil: ['domcontentloaded'],
        timeout: 10000,
      });

      const pdfBuffer = await page.pdf({
        width: '54mm',
        height: '86mm',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}

module.exports = IdCardPdfService;
