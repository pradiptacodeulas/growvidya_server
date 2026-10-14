const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

let cachedTemplate = null;
const TEMPLATE_PATH = path.join(__dirname, '../templates/marksheets/default-marksheet.html');

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
    console.warn('[marksheetPdf.service] Failed to convert image to base64:', err.message);
  }

  return imgUrlOrPath;
};

/**
 * Computes grade code given percentage and grades scale
 */
const computeGradeFromPct = (pct, grades = []) => {
  if (pct === null || pct === undefined || isNaN(pct) || !Array.isArray(grades) || grades.length === 0) {
    return '';
  }
  const val = Number(pct);
  for (const g of grades) {
    const min = Number(g.min_percentage ?? g.min_mark ?? 0);
    const max = Number(g.max_percentage ?? g.max_mark ?? 100);
    if (val >= min && val <= max) {
      return g.grade_name || g.grade || '';
    }
  }
  return '';
};

/**
 * Generates the HTML tables for terms shown one after another sequentially (not in the same row)
 */
const buildSubjectsTableHtml = (terms = [], subjects = [], grades = []) => {
  if (!subjects || subjects.length === 0 || !terms || terms.length === 0) {
    return '<div style="text-align:center; padding: 20px; color: #64748b;">No subject marks recorded for this student.</div>';
  }

  return terms.map((term) => {
    const examTypes = Array.isArray(term.exam_types) ? term.exam_types : [];
    const isSingleNoType = examTypes.length === 0;
    const isSingleNamedType = examTypes.length === 1;

    let colSpan = 4;
    let colHeadersHtml = '';

    if (isSingleNoType) {
      colSpan = 4;
      colHeadersHtml = `
        <th class="subject-col" style="width: 40%;">Subject</th>
        <th style="width: 20%;">Marks Obtained</th>
        <th style="width: 20%;">Full Marks</th>
        <th style="width: 20%;">Grade</th>
      `;
    } else if (isSingleNamedType) {
      colSpan = 5;
      colHeadersHtml = `
        <th class="subject-col" style="width: 35%;">Subject</th>
        <th style="width: 20%;">${examTypes[0]}</th>
        <th style="width: 15%;">Total</th>
        <th style="width: 15%;">Full Marks</th>
        <th style="width: 15%;">Grade</th>
      `;
    } else {
      colSpan = 1 + examTypes.length + 3;
      colHeadersHtml = `
        <th class="subject-col" style="width: 32%;">Subject</th>
        ${examTypes.map((t) => `<th>${t}</th>`).join('')}
        <th style="width: 14%;">Total</th>
        <th style="width: 14%;">Full Marks</th>
        <th style="width: 12%;">Grade</th>
      `;
    }

    let tbodyHtml = '';
    let termTotalSum = 0;
    let termFullMarksSum = 0;

    const formatMarkDisplay = (m, fm, isAbsent) => {
      if ((fm === null || fm === undefined) && (m === null || m === undefined)) {
        return 'NA';
      }
      if (m === null || m === undefined) {
        return 'NA';
      }
      const scoreHtml = (Number(m) === 0 && isAbsent)
        ? '<span style="color: #dc2626; font-weight: 700;">A</span>'
        : String(m);
      return fm !== null && fm !== undefined ? `${scoreHtml} / ${fm}` : scoreHtml;
    };

    subjects.forEach((sub) => {
      const tData = sub.terms ? sub.terms[term.name] : null;
      if (!tData) return;
      const termTotal = tData.termTotal !== null && tData.termTotal !== undefined ? tData.termTotal : 0;
      const termFullMarks = tData.termFullMarks !== null && tData.termFullMarks !== undefined ? tData.termFullMarks : 0;
      const termGrade = tData.termGrade || '';
      const isAbsent = Boolean(tData.isAbsent);

      termTotalSum += termTotal;
      termFullMarksSum += termFullMarks;

      if (isSingleNoType) {
        const m = tData.marks ? tData.marks[0] : tData.termTotal;
        const fm = tData.fullMarks ? tData.fullMarks[0] : null;
        tbodyHtml += `
          <tr>
            <td class="subject-col">${sub.subject_name}</td>
            <td class="bold-col">${formatMarkDisplay(m, fm, isAbsent)}</td>
            <td>${termFullMarks}</td>
            <td class="bold-col">${termGrade}</td>
          </tr>
        `;
      } else if (isSingleNamedType) {
        const m = tData.marks ? tData.marks[0] : null;
        const fm = tData.fullMarks ? tData.fullMarks[0] : null;
        tbodyHtml += `
          <tr>
            <td class="subject-col">${sub.subject_name}</td>
            <td>${formatMarkDisplay(m, fm, isAbsent)}</td>
            <td class="bold-col">${termTotal}</td>
            <td>${termFullMarks}</td>
            <td class="bold-col">${termGrade}</td>
          </tr>
        `;
      } else {
        let typeTds = '';
        examTypes.forEach((_, idx) => {
          const m = tData.marks ? tData.marks[idx] : null;
          const fm = tData.fullMarks ? tData.fullMarks[idx] : null;
          typeTds += `<td>${formatMarkDisplay(m, fm, isAbsent)}</td>`;
        });
        tbodyHtml += `
          <tr>
            <td class="subject-col">${sub.subject_name}</td>
            ${typeTds}
            <td class="bold-col">${termTotal}</td>
            <td>${termFullMarks}</td>
            <td class="bold-col">${termGrade}</td>
          </tr>
        `;
      }
    });

    const termPct = termFullMarksSum > 0
      ? (Math.round((termTotalSum / termFullMarksSum) * 1000) / 10).toFixed(1)
      : '0.0';
    const termOverallGrade = computeGradeFromPct(termPct, grades);

    let tfootHtml = '';
    if (isSingleNoType) {
      tfootHtml = `
        <tfoot>
          <tr>
            <td class="subject-col" style="font-weight: 800;">TOTAL</td>
            <td class="bold-col">${termTotalSum}</td>
            <td class="bold-col">${termFullMarksSum}</td>
            <td class="bold-col">${termOverallGrade}</td>
          </tr>
        </tfoot>
      `;
    } else if (isSingleNamedType) {
      tfootHtml = `
        <tfoot>
          <tr>
            <td class="subject-col" style="font-weight: 800;">TOTAL</td>
            <td></td>
            <td class="bold-col">${termTotalSum}</td>
            <td class="bold-col">${termFullMarksSum}</td>
            <td class="bold-col">${termOverallGrade}</td>
          </tr>
        </tfoot>
      `;
    } else {
      const emptyTypeTds = examTypes.map(() => '<td></td>').join('');
      tfootHtml = `
        <tfoot>
          <tr>
            <td class="subject-col" style="font-weight: 800;">TOTAL</td>
            ${emptyTypeTds}
            <td class="bold-col">${termTotalSum}</td>
            <td class="bold-col">${termFullMarksSum}</td>
            <td class="bold-col">${termOverallGrade}</td>
          </tr>
        </tfoot>
      `;
    }

    return `
      <div class="term-table-block">
        <table class="marks-table">
          <thead>
            <tr class="term-banner-row">
              <th colspan="${colSpan}">
                ${term.name}
              </th>
            </tr>
            <tr class="sub-header">
              ${colHeadersHtml}
            </tr>
          </thead>
          <tbody>
            ${tbodyHtml}
          </tbody>
          ${tfootHtml}
        </table>
      </div>
    `;
  }).join('');
};

/**
 * Builds the Grading Scale legend table
 */
const buildGradingScaleHtml = (grades = []) => {
  if (!grades || grades.length === 0) {
    return '';
  }

  let ths = '';
  let tds = '';
  grades.forEach((g) => {
    const min = g.min_percentage !== undefined ? g.min_percentage : g.min_mark ?? 0;
    const max = g.max_percentage !== undefined ? g.max_percentage : g.max_mark ?? 100;
    ths += `<th>${g.grade_name || g.grade}</th>`;
    tds += `<td>${min}-${max}%</td>`;
  });

  return `
    <table class="grading-scale-table">
      <thead><tr>${ths}</tr></thead>
      <tbody><tr>${tds}</tr></tbody>
    </table>
  `;
};

/**
 * Ensures the academic session is formatted as a full year range (e.g. 2025-2026) rather than a single year
 */
const formatAcademicSessionRange = (rawSession) => {
  if (!rawSession) return '';

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
 * Builds the complete HTML for a single student marksheet
 */
const buildSingleMarksheetHtml = (item, baseTemplate) => {
  const student = item.student || {};
  const school = item.school || {};
  const exam = item.exam || {};
  const terms = item.terms || [];
  const subjects = item.subjects || [];
  const grades = item.grades || [];

  const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim();
  const admissionNo = student.admission_no || '';
  const rollNo = student.roll_no || '';
  const className = student.class_name || '';
  const sectionName = student.section_name || '';
  const fatherName = (student.father_name || '').trim();
  const dob = student.dob ? new Date(student.dob).toLocaleDateString('en-GB') : '';
  const gender = student.gender === 2 || student.gender === '2' || student.gender === 'Female'
    ? 'Female'
    : (student.gender === 1 || student.gender === '1' || student.gender === 'Male' ? 'Male' : '');
  const sessionLabel = formatAcademicSessionRange(exam.academic_year);

  const schoolTitle = school.school_title || school.school_name || '';
  const affiliation = school.affiliation_board ? `Affiliated to ${school.affiliation_board}` : '';
  const schoolAddress = [school.address, school.city, school.state, school.postal_code].filter(Boolean).join(', ');
  const schoolCode = school.school_code ? `Code: ${school.school_code}` : '';

  const rawSchoolLogo = toBase64DataUri(school.school_logo);
  const hasLogo = Boolean(rawSchoolLogo && rawSchoolLogo.trim());

  // Show uploaded logo if present; otherwise show 'No Logo' text instead of taking from static file
  const headerLogoHtml = hasLogo
    ? `<img src="${rawSchoolLogo}" alt="Logo" class="school-logo" onerror="this.style.display='none'" />`
    : `<div class="no-logo-badge">No Logo</div>`;

  const hologramLogoHtml = hasLogo
    ? `<img src="${rawSchoolLogo}" alt="Watermark Crest" class="hologram-logo-img" onerror="this.style.display='none'" />`
    : `<div class="hologram-no-logo-badge">NO LOGO</div>`;

  // Format Board Name for the diagonal repeating security watermark
  const rawBoard = (school.affiliation_board || '').trim();
  let boardWatermark = '';
  if (rawBoard) {
    if (/^cbse$/i.test(rawBoard) || /^cbsc$/i.test(rawBoard)) {
      boardWatermark = 'CENTRAL BOARD OF SECONDARY EDUCATION • CBSE';
    } else if (/^icse$/i.test(rawBoard)) {
      boardWatermark = 'COUNCIL FOR THE INDIAN SCHOOL CERTIFICATE EXAMINATIONS • ICSE';
    } else {
      boardWatermark = `${rawBoard.toUpperCase()} BOARD`;
    }
  }

  const subjectsTableHtml = buildSubjectsTableHtml(terms, subjects, grades);
  const gradingScaleHtml = buildGradingScaleHtml(grades);

  // Compute aggregate totals
  let totalMarksObtained = 0;
  let grandFullMarks = 0;
  subjects.forEach((s) => {
    totalMarksObtained += s.grandTotal || 0;
    grandFullMarks += s.grandFullMarks || 0;
  });

  const overallPercentage = grandFullMarks > 0
    ? (Math.round((totalMarksObtained / grandFullMarks) * 1000) / 10).toFixed(1)
    : '0.0';

  const overallGrade = computeGradeFromPct(overallPercentage, grades);

  const resultStatus = Number(overallPercentage) >= 33 ? 'PASSED' : 'NEEDS IMPROVEMENT';
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
    .replace(/\{\{school_title\}\}/g, schoolTitle)
    .replace(/\{\{affiliation_board\}\}/g, affiliation)
    .replace(/\{\{school_address\}\}/g, schoolAddress)
    .replace(/\{\{school_code\}\}/g, schoolCode)
    .replace(/\{\{header_logo_html\}\}/g, headerLogoHtml)
    .replace(/\{\{hologram_logo_html\}\}/g, hologramLogoHtml)
    .replace(/\{\{school_logo\}\}/g, rawSchoolLogo || '')
    .replace(/\{\{board_watermark_text\}\}/g, boardWatermark)
    .replace(/\{\{subjects_table_html\}\}/g, subjectsTableHtml)
    .replace(/\{\{total_marks_obtained\}\}/g, String(totalMarksObtained))
    .replace(/\{\{grand_full_marks\}\}/g, String(grandFullMarks))
    .replace(/\{\{overall_percentage\}\}/g, overallPercentage)
    .replace(/\{\{overall_grade\}\}/g, overallGrade)
    .replace(/\{\{result_status\}\}/g, resultStatus)
    .replace(/\{\{grading_scale_html\}\}/g, gradingScaleHtml)
    .replace(/\{\{issue_date\}\}/g, issueDate);

  return html;
};

/**
 * Generates an A4 Portrait PDF Buffer for one or multiple student marksheets
 * @param {Array<Object>|Object} marksheetData - Single marksheet item or array of items
 * @returns {Promise<Buffer>} - Generated PDF Buffer
 */
exports.generateMarksheetPdfBuffer = async (marksheetData) => {
  const dataList = Array.isArray(marksheetData) ? marksheetData : [marksheetData];
  if (dataList.length === 0) {
    throw new Error('No marksheet records found for PDF generation');
  }

  const baseTemplateHtml = getTemplateHtml();

  let finalHtml = '';
  if (dataList.length === 1) {
    finalHtml = buildSingleMarksheetHtml(dataList[0], baseTemplateHtml);
  } else {
    // Multi-page batch marksheet
    const pagesHtml = dataList
      .map((item) => {
        const itemHtml = buildSingleMarksheetHtml(item, baseTemplateHtml);
        const bodyMatch = itemHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const bodyInner = bodyMatch ? bodyMatch[1] : itemHtml;
        return `<div class="marksheet-page">${bodyInner}</div>`;
      })
      .join('\n');

    const headMatch = baseTemplateHtml.match(/<head[^>]*>([\s\S]*)<\/head>/i);
    const headInner = headMatch ? headMatch[1] : '';

    finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  ${headInner}
  <style>
    .marksheet-page {
      width: 210mm;
      height: 297mm;
      page-break-after: always;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    .marksheet-page:last-child {
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
