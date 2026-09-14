const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Cache template HTML in memory
let cachedTemplate = null;
const TEMPLATE_PATH = path.join(__dirname, '../templates/certificates/default-certificate.html');

/**
 * Loads the HTML template from disk
 */
const getTemplateHtml = () => {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  }
  return cachedTemplate;
};

/**
 * Converts a local file path or public upload path to a base64 Data URI
 * so Puppeteer can embed it reliably without network or CORS latency.
 */
const toBase64DataUri = (imgUrlOrPath) => {
  if (!imgUrlOrPath) return '';
  if (typeof imgUrlOrPath !== 'string') return '';
  if (imgUrlOrPath.startsWith('data:')) return imgUrlOrPath;

  try {
    let cleanPath = imgUrlOrPath.replace(/^https?:\/\/[^\/]+/i, ''); // Strip domain if present
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
    console.warn('[certificatePdf.service] Failed to convert image to base64:', err.message);
  }

  return imgUrlOrPath;
};

/**
 * Formats body paragraphs into HTML with highlighted spans
 */
const formatCertificateBodyHtml = (rawDescription, cert) => {
  if (!rawDescription || !rawDescription.trim()) {
    const studentName = `${cert.first_name || ''} ${cert.last_name || ''}`.trim() || 'Student';
    const guardian = cert.guardian_name || '—';
    const admNo = cert.admission_number || `AD${cert.student_id || cert.id || ''}`;
    const rollNo = cert.roll_number || '—';
    const clsName = cert.class_name || '—';
    const secName = cert.section_name || '—';

    return `<p>This is to certify that <span class="highlight">${studentName}</span>, ` +
      `bearing Admission No. <span class="highlight">${admNo}</span> and ` +
      `Roll No. <span class="highlight">${rollNo}</span> of Class <span class="highlight">${clsName} (Section ${secName})</span>, ` +
      `has successfully satisfied all requirements and bears an exemplary moral character and conduct.</p>`;
  }

  let text = rawDescription
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, '');

  // Format any YYYY-MM-DD strings to DD/MM/YYYY
  text = text.replace(/(\d{4})-(\d{2})-(\d{2})(?:\s+\d{2}:\d{2}:\d{2})?/g, (m, y, mo, d) => `${d}/${mo}/${y}`);

  const fullName = `${cert.first_name || ''} ${cert.last_name || ''}`.trim();
  const guardian = cert.guardian_name || '';
  const admNo = cert.admission_number || '';
  const rollNo = cert.roll_number || '';
  const clsName = cert.class_name || '';
  const secName = cert.section_name || '';
  const academicYear = cert.academic_year_name || cert.academic_year || '';

  // Replace placeholders with highlighted spans
  text = text
    .replace(/\{\{\s*(?:student_)?name\s*\}\}/gi, `~~~HL~~~${fullName}~~~END_HL~~~`)
    .replace(/\{\{\s*(?:guardian|father)_name\s*\}\}/gi, `~~~HL~~~${guardian}~~~END_HL~~~`)
    .replace(/\{\{\s*class(?:_name)?\s*\}\}/gi, `~~~HL~~~${clsName}~~~END_HL~~~`)
    .replace(/\{\{\s*section\s*\}\}/gi, `~~~HL~~~${secName}~~~END_HL~~~`)
    .replace(/\{\{\s*roll_(?:number|no)\s*\}\}/gi, `~~~HL~~~${rollNo}~~~END_HL~~~`)
    .replace(/\{\{\s*academic_year\s*\}\}/gi, `~~~HL~~~${academicYear}~~~END_HL~~~`)
    .replace(/\{\{\s*(?:admission_number|admission_no)\s*\}\}/gi, `~~~HL~~~${admNo}~~~END_HL~~~`);

  // Split into paragraphs
  const rawParas = text.split(/\n\s*\n+/);
  return rawParas
    .map((p) => {
      const clean = p.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (!clean) return '';

      const withHighlights = clean
        .replace(/~~~HL~~~([\s\S]*?)~~~END_HL~~~/g, '<span class="highlight">$1</span>')
        .replace(/Mr\.\/Ms\.\s*_{2,}/gi, `Mr./Ms. <span class="highlight">${fullName}</span>`)
        .replace(/son\/daughter of Mr\.\/Mrs\.\s*_{2,}/gi, `son/daughter of Mr./Mrs. <span class="highlight">${guardian}</span>`);

      return `<p>${withHighlights}</p>`;
    })
    .filter(Boolean)
    .join('');
};

/**
 * Builds the complete HTML string for a single certificate
 */
const buildSingleCertificateHtml = (cert, templateHtml) => {
  const studentName = `${cert.first_name || ''} ${cert.last_name || ''}`.trim() || 'Student';
  const issueDateStr = cert.certificate_date || cert.date || new Date().toISOString().split('T')[0];
  const [y, m, d] = issueDateStr.split('-');
  const formattedDate = d && m && y ? `${d}/${m}/${y}` : issueDateStr;

  const serialNo = cert.id ? `CERT-${String(cert.id).padStart(5, '0')}` : 'CERT-00001';
  const borderUri = toBase64DataUri(cert.borderImg || cert.border);
  const logoUri = toBase64DataUri(cert.school_logo);
  const bodyHtml = formatCertificateBodyHtml(cert.certificate_description || cert.description, cert);

  let html = templateHtml
    .replace(/\{\{student_name\}\}/g, studentName)
    .replace(/\{\{school_name\}\}/g, cert.school_name || 'Growvidya Academy')
    .replace(/\{\{affiliation\}\}/g, cert.affiliation_board || cert.affiliation || '')
    .replace(/\{\{school_address\}\}/g, cert.school_address || '')
    .replace(/\{\{school_code\}\}/g, cert.school_code ? `Code: ${cert.school_code}` : '')
    .replace(/\{\{school_logo_src\}\}/g, logoUri)
    .replace(/\{\{border_image_url\}\}/g, borderUri)
    .replace(/\{\{serial_no\}\}/g, serialNo)
    .replace(/\{\{issue_date\}\}/g, formattedDate)
    .replace(/\{\{certificate_heading\}\}/g, cert.certificate_heading || cert.template_name || 'CERTIFICATE')
    .replace(/\{\{certificate_body\}\}/g, bodyHtml)
    .replace(/\{\{certified_by\}\}/g, cert.certified_by || 'Principal');

  return html;
};

/**
 * Generates a high-resolution A4 Portrait PDF Buffer for one or more certificates
 * @param {Array<Object>|Object} certificates - Single certificate object or array of certificates
 * @returns {Promise<Buffer>} - Generated PDF Buffer
 */
exports.generateCertificatesPdfBuffer = async (certificates) => {
  const certList = Array.isArray(certificates) ? certificates : [certificates];
  if (certList.length === 0) {
    throw new Error('No certificates provided for PDF generation');
  }

  const baseTemplateHtml = getTemplateHtml();

  let finalHtml = '';
  if (certList.length === 1) {
    finalHtml = buildSingleCertificateHtml(certList[0], baseTemplateHtml);
  } else {
    // Multi-page document: extract inner styles & wrap each certificate in an A4 page container
    const pagesHtml = certList
      .map((cert) => {
        const certHtml = buildSingleCertificateHtml(cert, baseTemplateHtml);
        const bodyMatch = certHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const bodyInner = bodyMatch ? bodyMatch[1] : certHtml;
        return `<div class="certificate-page">${bodyInner}</div>`;
      })
      .join('\n');

    // Extract head
    const headMatch = baseTemplateHtml.match(/<head[^>]*>([\s\S]*)<\/head>/i);
    const headInner = headMatch ? headMatch[1] : '';

    finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  ${headInner}
  <style>
    .certificate-page {
      width: 210mm;
      height: 297mm;
      page-break-after: always;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    .certificate-page:last-child {
      page-break-after: avoid;
    }
  </style>
</head>
<body style="margin: 0; padding: 0;">
  ${pagesHtml}
</body>
</html>`;
  }

  // Launch Puppeteer with performance flags
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
