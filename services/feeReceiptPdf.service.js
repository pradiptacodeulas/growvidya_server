const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE_PATH = path.join(__dirname, '../templates/receipts/default-receipt.html');

/**
 * Converts a number to Indian currency words
 */
const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertChunk(num) {
  let str = '';
  if (num >= 100) {
    str += ones[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }
  if (num >= 20) {
    str += tens[Math.floor(num / 10)] + ' ';
    num %= 10;
  }
  if (num > 0) {
    str += ones[num] + ' ';
  }
  return str.trim();
}

function numberToIndianWords(n) {
  const rawNum = Math.abs(Number(n) || 0);
  const intPart = Math.floor(rawNum);
  if (intPart === 0 && rawNum === 0) return 'Zero Rupees Only';

  const crore = Math.floor(intPart / 10000000);
  const lakh = Math.floor((intPart % 10000000) / 100000);
  const thousand = Math.floor((intPart % 100000) / 1000);
  const hundred = intPart % 1000;

  let result = '';
  if (crore > 0) result += convertChunk(crore) + ' Crore ';
  if (lakh > 0) result += convertChunk(lakh) + ' Lakh ';
  if (thousand > 0) result += convertChunk(thousand) + ' Thousand ';
  if (hundred > 0) result += convertChunk(hundred) + ' ';

  const paise = Math.round((rawNum - intPart) * 100);
  let words = result.trim();
  if (words) {
    words += ' Rupees';
  } else {
    words = 'Zero Rupees';
  }

  if (paise > 0) {
    words += ' and ' + convertChunk(paise) + ' Paise';
  }

  return words + ' Only';
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) {
    return String(dateStr);
  }
};

const formatCurrency = (amount) => {
  const num = parseFloat(amount || 0);
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Escapes HTML characters to prevent XSS
 */
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Simple Mustache/Handlebars-like renderer
 */
const renderTemplate = (template, data) => {
  let output = template;

  // 1. Process conditional blocks: {{#if key}}...{{/if}}
  output = output.replace(/\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, content) => {
    return data[key] ? content : '';
  });

  // 2. Process variable placeholders: {{key}}
  output = output.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    return data[key] !== undefined && data[key] !== null ? data[key] : '';
  });

  return output;
};

class FeeReceiptPdfService {
  /**
   * Generates the complete HTML for the fee payment receipt
   */
  static generateReceiptHtml(payment) {
    const templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf8');

    const schoolName = payment.school_name || '';
    let branchName = payment.branch_name || '';
    let schoolAddress = payment.branch_address || payment.school_address || '';

    // Constraint: DO NOT repeat school name anywhere on the receipt
    if (schoolName && branchName) {
      const escapedSchoolName = schoolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      branchName = branchName.replace(new RegExp(escapedSchoolName, 'gi'), '');
      branchName = branchName.replace(/^[\s(\-–/]+/, '').replace(/[\s)\-–/]+$/, '').trim();
    }

    if (schoolName && schoolAddress) {
      const escapedSchoolName = schoolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      schoolAddress = schoolAddress.replace(new RegExp(escapedSchoolName, 'gi'), '');
      schoolAddress = schoolAddress.replace(/^[\s,(\-–/]+/, '').replace(/[\s,)\-–/]+$/, '').trim();
    }

    const contactParts = [];
    if (payment.school_phone) contactParts.push(`Phone: ${escapeHtml(payment.school_phone)}`);
    if (payment.school_email) contactParts.push(`Email: ${escapeHtml(payment.school_email)}`);
    const schoolContact = contactParts.join(' | ');

    // Items table generation
    let itemsRows = '';
    if (Array.isArray(payment.items) && payment.items.length > 0) {
      itemsRows = payment.items
        .map((item, idx) => `
          <tr>
            <td class="serial text-center">${idx + 1}</td>
            <td class="description">${escapeHtml(item.component_name || 'Fee Component')}</td>
            <td class="amount text-end fw-bold">${formatCurrency(item.amount)}</td>
          </tr>
        `)
        .join('');
    } else {
      itemsRows = `
        <tr>
          <td class="serial text-center">1</td>
          <td class="description">${escapeHtml(payment.invoice_title || 'Fee Payment Installment')}</td>
          <td class="amount text-end fw-bold">${formatCurrency(payment.amount_paid)}</td>
        </tr>
      `;
    }

    const totalInvoiced = parseFloat(payment.invoice_total || 0);
    const amountPaid = parseFloat(payment.amount_paid || 0);
    const totalDue = parseFloat(payment.invoice_due || 0);

    const showInvoiceTotal = totalInvoiced > 0 && totalInvoiced !== amountPaid;
    const showDue = payment.invoice_due !== undefined && payment.invoice_due !== null && totalDue > 0;

    const data = {
      school_name: escapeHtml(schoolName),
      branch_name: escapeHtml(branchName),
      school_address: escapeHtml(schoolAddress),
      school_contact: schoolContact,
      receipt_no: escapeHtml(payment.receipt_no || '-'),
      payment_date: formatDate(payment.payment_date || payment.created_at),
      invoice_no: payment.invoice_no ? escapeHtml(payment.invoice_no) : '',
      txn_no: payment.transaction_id || payment.reference_no || payment.cheque_no
        ? escapeHtml(payment.transaction_id || payment.reference_no || payment.cheque_no)
        : '',
      student_name: escapeHtml(`${payment.first_name || ''} ${payment.last_name || ''}`.trim() || '-'),
      admission_number: escapeHtml(payment.admission_number || '-'),
      class_section: escapeHtml(`${payment.class_name || '-'}${payment.section_name ? ` (${payment.section_name})` : ''}`),
      roll_number: escapeHtml(payment.roll_number || '-'),
      payment_method: escapeHtml(payment.payment_method || '-'),
      academic_session: escapeHtml(payment.academic_year || payment.invoice_title || '-'),
      items_rows: itemsRows,
      show_invoice_total: showInvoiceTotal,
      invoice_total_formatted: formatCurrency(totalInvoiced),
      amount_paid_formatted: formatCurrency(amountPaid),
      show_due: showDue,
      due_amount_formatted: formatCurrency(totalDue),
      amount_in_words: numberToIndianWords(amountPaid),
      remarks_or_terms: payment.notes
        ? escapeHtml(payment.notes)
        : 'This is an official computer-generated fee payment receipt. Retain this receipt for future reference.',
    };

    return renderTemplate(templateContent, data);
  }

  /**
   * Generates high-quality A4 PDF Buffer using Puppeteer
   */
  static async generateReceiptPdfBuffer(payment) {
    const html = this.generateReceiptHtml(payment);

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
      await page.setContent(html, {
        waitUntil: ['load', 'domcontentloaded'],
        timeout: 15000,
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
  }
}

module.exports = FeeReceiptPdfService;
