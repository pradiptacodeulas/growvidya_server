const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

let cachedTemplate = null;
const TEMPLATE_PATH = path.join(__dirname, '../templates/admitcards/default-admitcard.html');

/**
 * Loads the HTML template from disk
 */
const getTemplateHtml = () => {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
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
    console.warn('[admitCardPdf.service] Failed to convert image to base64:', err.message);
  }

  return imgUrlOrPath;
};

/**
 * Ensures the academic session is formatted as a full year range (e.g. 2025-2026) rather than a single year
 */
const formatAcademicSessionRange = (rawSession) => {
  if (!rawSession) {
    const now = new Date();
    const curYear = now.getFullYear();
    return now.getMonth() < 3 ? `${curYear - 1}-${curYear}` : `${curYear}-${curYear + 1}`;
  }

  const str = String(rawSession).trim();

  // If already a range like 2025-2026, 2025 - 2026, 2025/2026, 2025-26
  const rangeMatch = str.match(/^(\d{4})\s*[-/]\s*(\d{2,4})$/);
  if (rangeMatch) {
    const start = rangeMatch[1];
    let end = rangeMatch[2];
    if (end.length === 2) {
      end = start.slice(0, 2) + end;
    }
    return `${start}-${end}`;
  }

  // If a 4-digit single year like 2025 or 2026
  const singleYearMatch = str.match(/^(\d{4})$/);
  if (singleYearMatch) {
    const y = parseInt(singleYearMatch[1], 10);
    return `${y}-${y + 1}`;
  }

  return str;
};

/**
 * Formats time string e.g. "09:30:00" or "09:30" to "09:30 AM"
 */
const formatTimeString = (tStr) => {
  if (!tStr) return '';
  if (/\b(AM|PM)\b/i.test(tStr)) return tStr;
  const parts = tStr.split(':');
  if (parts.length >= 2) {
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  }
  return tStr;
};

/**
 * Generates the HTML table for examination schedules
 */
const buildSchedulesTableHtml = (schedules = []) => {
  if (!schedules || schedules.length === 0) {
    return '<div style="text-align:center; padding: 18px; color: #64748b; font-size: 8pt; border: 1px dashed #cbd5e1; border-radius: 4px; background: #f8fafc;">No subject exam schedules configured for this exam.</div>';
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const rowsHtml = schedules.map((sch, idx) => {
    let formattedDate = '-';
    let dayName = '-';

    if (sch.date) {
      try {
        const d = new Date(sch.date);
        if (!isNaN(d.getTime())) {
          formattedDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          dayName = dayNames[d.getDay()] || '-';
        } else {
          formattedDate = sch.date;
        }
      } catch (e) {
        formattedDate = sch.date;
      }
    }

    const sTime = formatTimeString(sch.start_time);
    const eTime = formatTimeString(sch.end_time);
    const timing = sTime && eTime ? `${sTime} - ${eTime}` : (sTime || eTime || 'Morning Shift');

    return `
      <tr style="height: 10.5mm;">
        <td style="width: 28px; font-weight: 600; color: #64748b; height: 10.5mm;">${idx + 1}</td>
        <td class="subject-name" style="height: 10.5mm;">${sch.subject_name || sch.subject || 'Subject'}</td>
        <td style="width: 80px; font-weight: 600; height: 10.5mm;">${formattedDate}</td>
        <td style="width: 75px; color: #475569; height: 10.5mm;">${dayName}</td>
        <td style="width: 120px; font-weight: 600; color: #0c2340; height: 10.5mm;">${timing}</td>
        <td class="invigilator-col" style="width: 180px; min-width: 180px; height: 10.5mm;">
          <div style="border-bottom: 1px dotted #94a3b8; height: 6mm; width: 92%; margin: 0 auto;"></div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table class="schedule-table">
      <thead>
        <tr style="height: 9mm;">
          <th style="width: 28px;">#</th>
          <th>Subject Name</th>
          <th style="width: 80px;">Exam Date</th>
          <th style="width: 75px;">Day</th>
          <th style="width: 120px;">Timing / Shift</th>
          <th style="width: 180px;">Invigilator Sign</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
};

/**
 * Builds the complete HTML for a single student admit card
 */
const buildSingleAdmitCardHtml = (item, baseTemplate) => {
  const student = item.student || {};
  const school = item.school || {};
  const exam = item.exam || {};
  const schedules = item.schedules || [];

  const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'Student';
  const admissionNo = student.admission_no || (student.id ? `AD${student.id}` : '—');
  const rollNo = student.roll_no || '—';
  const className = student.class_name || '—';
  const sectionName = student.section_name || '—';
  const fatherName = student.father_name || '—';
  const dob = student.dob ? new Date(student.dob).toLocaleDateString('en-GB') : '—';
  const gender = student.gender === 2 || student.gender === '2' || student.gender === 'Female' ? 'Female' : 'Male';
  const sessionLabel = formatAcademicSessionRange(exam.academic_year);
  const examName = exam.exam_name || exam.exam || 'Annual Examination';

  const schoolTitle = school.school_title || school.school_name || 'Growvidya Academy';
  const affiliation = school.affiliation_board ? `Affiliated to ${school.affiliation_board}` : '';
  const schoolAddress = [school.address, school.city, school.state, school.postal_code].filter(Boolean).join(', ');
  const schoolCode = school.school_code ? `Code: ${school.school_code}` : '';

  const rawSchoolLogo = toBase64DataUri(school.school_logo);
  const hasLogo = Boolean(rawSchoolLogo && rawSchoolLogo.trim());

  // Show uploaded logo if present; otherwise show 'No Logo' text badge instead of taking from static file
  const headerLogoHtml = hasLogo
    ? `<img src="${rawSchoolLogo}" alt="Logo" class="school-logo" onerror="this.style.display='none'" />`
    : `<div class="no-logo-badge">No Logo</div>`;

  const hologramLogoHtml = hasLogo
    ? `<img src="${rawSchoolLogo}" alt="Watermark Crest" class="hologram-logo-img" onerror="this.style.display='none'" />`
    : `<div class="hologram-no-logo-badge">NO LOGO</div>`;

  // Student Photo resolution
  const rawStudentPhoto = toBase64DataUri(student.picture);
  const studentPhotoHtml = rawStudentPhoto && rawStudentPhoto.trim()
    ? `<img src="${rawStudentPhoto}" alt="Candidate Photo" class="student-photo-img" onerror="this.style.display='none'" />`
    : `<div class="photo-placeholder">PASTE PASSPORT PHOTO HERE</div>`;

  // Format Board Name for the diagonal repeating security watermark
  const rawBoard = (school.affiliation_board || '').trim();
  let boardWatermark = rawBoard;
  if (!boardWatermark) {
    boardWatermark = 'CENTRAL BOARD OF SECONDARY EDUCATION';
  } else if (/^cbse$/i.test(boardWatermark) || /^cbsc$/i.test(boardWatermark)) {
    boardWatermark = 'CENTRAL BOARD OF SECONDARY EDUCATION • CBSE';
  } else if (/^icse$/i.test(boardWatermark)) {
    boardWatermark = 'COUNCIL FOR THE INDIAN SCHOOL CERTIFICATE EXAMINATIONS • ICSE';
  } else {
    boardWatermark = `${boardWatermark.toUpperCase()} BOARD`;
  }

  const schedulesTableHtml = buildSchedulesTableHtml(schedules);
  const issueDate = item.issueDate
    ? new Date(item.issueDate).toLocaleDateString('en-GB')
    : new Date().toLocaleDateString('en-GB');

  let html = baseTemplate
    .replace(/\{\{student_name\}\}/g, studentName)
    .replace(/\{\{admission_no\}\}/g, admissionNo)
    .replace(/\{\{roll_no\}\}/g, rollNo)
    .replace(/\{\{class_name\}\}/g, className)
    .replace(/\{\{section_name\}\}/g, sectionName)
    .replace(/\{\{father_name\}\}/g, fatherName)
    .replace(/\{\{dob\}\}/g, dob)
    .replace(/\{\{gender\}\}/g, gender)
    .replace(/\{\{academic_year\}\}/g, sessionLabel)
    .replace(/\{\{exam_name\}\}/g, examName)
    .replace(/\{\{school_title\}\}/g, schoolTitle)
    .replace(/\{\{affiliation_board\}\}/g, affiliation)
    .replace(/\{\{school_address\}\}/g, schoolAddress)
    .replace(/\{\{school_code\}\}/g, schoolCode)
    .replace(/\{\{header_logo_html\}\}/g, headerLogoHtml)
    .replace(/\{\{hologram_logo_html\}\}/g, hologramLogoHtml)
    .replace(/\{\{student_photo_html\}\}/g, studentPhotoHtml)
    .replace(/\{\{board_watermark_text\}\}/g, boardWatermark)
    .replace(/\{\{schedules_table_html\}\}/g, schedulesTableHtml)
    .replace(/\{\{issue_date\}\}/g, issueDate);

  return html;
};

/**
 * Generates an A4 Portrait PDF Buffer for one or multiple student admit cards
 * @param {Array<Object>|Object} admitCardData - Single admit card item or array of items
 * @returns {Promise<Buffer>} - Generated PDF Buffer
 */
exports.generateAdmitCardPdfBuffer = async (admitCardData) => {
  const dataList = Array.isArray(admitCardData) ? admitCardData : [admitCardData];
  if (dataList.length === 0) {
    throw new Error('No admit card records found for PDF generation');
  }

  const baseTemplateHtml = getTemplateHtml();

  let finalHtml = '';
  if (dataList.length === 1) {
    finalHtml = buildSingleAdmitCardHtml(dataList[0], baseTemplateHtml);
  } else {
    // Multi-page batch admit card
    const pagesHtml = dataList
      .map((item) => {
        const itemHtml = buildSingleAdmitCardHtml(item, baseTemplateHtml);
        const bodyMatch = itemHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const bodyInner = bodyMatch ? bodyMatch[1] : itemHtml;
        return `<div class="admitcard-page">${bodyInner}</div>`;
      })
      .join('\n');

    const headMatch = baseTemplateHtml.match(/<head[^>]*>([\s\S]*)<\/head>/i);
    const headInner = headMatch ? headMatch[1] : '';

    finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  ${headInner}
  <style>
    .admitcard-page {
      width: 210mm;
      height: 297mm;
      page-break-after: always;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    .admitcard-page:last-child {
      page-break-after: avoid;
    }
  </style>
</head>
<body style="margin: 0; padding: 0;">
  ${pagesHtml}
</body>
</html>`;
  }

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=medium',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(finalHtml, {
      waitUntil: ['load', 'domcontentloaded'],
      timeout: 10000,
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
};
