const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const GstSettingModel = require('../models/gstSetting.model');
const FooterSettingModel = require('../models/footerSetting.model');

const TEMPLATE_PATH = path.join(__dirname, '../templates/invoices/subscription-tax-invoice.html');

const LOCAL_LOGO_CANDIDATES = [
  path.resolve(__dirname, '../public/assets/logo_dark.png'),
  path.resolve(__dirname, '../../growvidya_client/src/assets/logo_dark.png'),
  path.resolve(__dirname, '../../growvidya_onboarding/public/logo_dark.png'),
  path.resolve(__dirname, '../../growvidya_admin/src/assets/logo_dark.png'),
];

let _cachedLogoDataUri = null;
let _cachedTemplateHtml = null;
let _sharedBrowserPromise = null;

/**
 * Loads the local Growvidya logo strictly from local disk assets (never from internet or cloud storage)
 * and caches the Base64 Data URI in memory for fast invoice PDF rendering.
 */
function getLocalGrowvidyaLogoUri() {
  if (_cachedLogoDataUri !== null) {
    return _cachedLogoDataUri;
  }

  for (const candidatePath of LOCAL_LOGO_CANDIDATES) {
    try {
      if (fs.existsSync(candidatePath)) {
        const buffer = fs.readFileSync(candidatePath);
        if (buffer && buffer.length > 0) {
          _cachedLogoDataUri = `data:image/png;base64,${buffer.toString('base64')}`;
          return _cachedLogoDataUri;
        }
      }
    } catch (_) {}
  }

  _cachedLogoDataUri = '';
  return _cachedLogoDataUri;
}

function getTemplateHtml() {
  if (!_cachedTemplateHtml) {
    _cachedTemplateHtml = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  }
  return _cachedTemplateHtml;
}

/**
 * Maintains a warm singleton Puppeteer browser instance so invoice PDF generation
 * does not cold-boot Chromium on every request.
 */
async function getWarmBrowser() {
  if (_sharedBrowserPromise) {
    try {
      const browser = await _sharedBrowserPromise;
      if (browser && browser.connected) {
        return browser;
      }
    } catch (_) {
      _sharedBrowserPromise = null;
    }
  }

  _sharedBrowserPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=medium',
    ],
  });

  const browser = await _sharedBrowserPromise;
  browser.on('disconnected', () => {
    _sharedBrowserPromise = null;
  });
  return browser;
}

const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
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
  if (intPart === 0 && rawNum === 0) return 'Zero Rupees Only.';

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

  return words + ' Only.';
}

function formatNumber(amount) {
  const num = parseFloat(amount || 0);
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrency(amount) {
  return '₹' + formatNumber(amount);
}

function formatDate(dateVal) {
  if (!dateVal) return '—';
  try {
    const str = String(dateVal).slice(0, 10);
    const parts = str.split('-');
    if (parts.length === 3) {
      const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      }
    }
    const d = new Date(dateVal);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
  } catch (_) {}
  return String(dateVal);
}

function formatPaymentMethodLabel(method) {
  const key = String(method || '').toLowerCase();
  if (key === 'razorpay') return 'Razorpay Online Checkout';
  if (key === 'bank_transfer') return 'Offline Bank Transfer (UTR)';
  if (key === 'free_trial') return 'Free Trial Activation';
  if (key === 'coupon_100') return '100% Promotional Coupon';
  if (key === 'super_admin_manual') return 'Manual Assignment';
  return method ? String(method).replace(/_/g, ' ').toUpperCase() : '—';
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderTemplate(template, data) {
  let output = template;

  output = output.replace(/\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, content) => {
    return data[key] ? content : '';
  });

  output = output.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    return data[key] !== undefined && data[key] !== null ? data[key] : '';
  });

  return output;
}

class SubscriptionInvoicePdfService {
  /**
   * Build the full HTML string for an order's Tax Invoice matching invoice.pdf layout
   */
  static async generateInvoiceHtml(order) {
    const [gstSettings, footerSetting] = await Promise.all([
      GstSettingModel.getCurrent().catch(() => null),
      FooterSettingModel.getCurrent().catch(() => null),
    ]);

    const companyLogoUri = getLocalGrowvidyaLogoUri();
    const companyName = gstSettings?.company_legal_name || '';
    const companyAddress = gstSettings?.company_address || '';
    const companyGstin = gstSettings?.company_gstin || '';
    const companyPhone = gstSettings?.company_phone || '';
    const companyEmail = gstSettings?.company_email || '';
    const hsnSacCode = gstSettings?.hsn_sac_code || '';

    const contactParts = [];
    if (companyPhone) contactParts.push(`Mobile: ${escapeHtml(companyPhone)}`);
    if (companyEmail) contactParts.push(`Email: ${escapeHtml(companyEmail)}`);
    const companyContactLine = contactParts.join('   ');

    const schoolName = order.school?.name || order.school_name || '';
    const schoolCode = order.school?.code || order.school_code || '';
    const schoolAddress = order.school?.address || order.school_address || order.shipping_address || '';
    const schoolCity = order.school?.city || order.school_city || '';
    const schoolState = order.billing_state_name || order.school?.state || order.school_state || '';
    const schoolPostalCode = order.school?.postal_code || order.school_postal_code || '';
    const schoolPhone = order.school?.phone || order.school_phone || '';
    const schoolEmail = order.school?.email || order.school_email || '';

    const locParts = [schoolCity, schoolState, schoolPostalCode].filter(Boolean);
    const schoolLocationLine = locParts.join(', ');

    const taxType = order.tax_type || 'none';
    const isIntraState = taxType === 'intra_state';
    const isInterState = taxType === 'inter_state';

    const cgstRate = parseFloat(order.cgst_percentage) || 0;
    const sgstRate = parseFloat(order.sgst_percentage) || 0;
    const igstRate = parseFloat(order.igst_percentage) || 0;

    const subtotalAmount = parseFloat(order.subtotal_amount) || 0;
    const discountAmount = parseFloat(order.discount_amount) || 0;
    const taxableAmount =
      order.taxable_amount !== undefined && order.taxable_amount !== null
        ? parseFloat(order.taxable_amount) || 0
        : Math.max(0, Math.round((subtotalAmount - discountAmount) * 100) / 100);
    const cgstAmount = parseFloat(order.cgst_amount) || 0;
    const sgstAmount = parseFloat(order.sgst_amount) || 0;
    const igstAmount = parseFloat(order.igst_amount) || 0;
    const grandTotal = parseFloat(order.grand_total) || 0;

    const rawItems = Array.isArray(order.line_items) ? order.line_items : [];
    const totalGrossItems = rawItems.reduce((acc, it) => acc + (parseFloat(it.total_price ?? it.total) || 0), 0);

    let itemsTableHead = '';
    let spacerCells = '';
    if (isIntraState) {
      itemsTableHead = `
        <tr>
          <th class="text-center" style="width: 34px;">#</th>
          <th class="text-left">Item</th>
          <th class="text-center" style="width: 68px;">HSN/SAC</th>
          <th class="text-right" style="width: 82px;">Rate / Item</th>
          <th class="text-center" style="width: 54px;">Qty</th>
          <th class="text-right" style="width: 88px;">Taxable Value</th>
          <th class="text-right" style="width: 88px;">CGST</th>
          <th class="text-right" style="width: 88px;">SGST</th>
          <th class="text-right" style="width: 92px;">Amount</th>
        </tr>
      `;
      spacerCells = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    } else if (isInterState) {
      itemsTableHead = `
        <tr>
          <th class="text-center" style="width: 34px;">#</th>
          <th class="text-left">Item</th>
          <th class="text-center" style="width: 72px;">HSN/SAC</th>
          <th class="text-right" style="width: 88px;">Rate / Item</th>
          <th class="text-center" style="width: 58px;">Qty</th>
          <th class="text-right" style="width: 96px;">Taxable Value</th>
          <th class="text-right" style="width: 100px;">IGST</th>
          <th class="text-right" style="width: 98px;">Amount</th>
        </tr>
      `;
      spacerCells = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    } else {
      itemsTableHead = `
        <tr>
          <th class="text-center" style="width: 38px;">#</th>
          <th class="text-left">Item</th>
          <th class="text-center" style="width: 80px;">HSN/SAC</th>
          <th class="text-right" style="width: 100px;">Rate / Item</th>
          <th class="text-center" style="width: 64px;">Qty</th>
          <th class="text-right" style="width: 110px;">Taxable Value</th>
          <th class="text-right" style="width: 110px;">Amount</th>
        </tr>
      `;
      spacerCells = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    }

    let totalQty = 0;
    const itemsTableRows = rawItems
      .map((item, idx) => {
        const qty = Number(item.quantity || 1);
        totalQty += qty;
        const unitPrice = parseFloat(item.unit_price) || 0;
        const grossLine = parseFloat(item.total_price ?? item.total) || 0;

        // Proportional taxable value for this line item after discount
        const lineShare = totalGrossItems > 0 ? grossLine / totalGrossItems : 0;
        const lineTaxable =
          discountAmount > 0
            ? Math.round(taxableAmount * lineShare * 100) / 100
            : grossLine;

        const lineCgst = isIntraState ? Math.round(lineTaxable * (cgstRate / 100) * 100) / 100 : 0;
        const lineSgst = isIntraState ? Math.round(lineTaxable * (sgstRate / 100) * 100) / 100 : 0;
        const lineIgst = isInterState ? Math.round(lineTaxable * (igstRate / 100) * 100) / 100 : 0;
        const lineFinalAmount = Math.round((lineTaxable + lineCgst + lineSgst + lineIgst) * 100) / 100;

        if (isIntraState) {
          return `
            <tr>
              <td class="text-center">${idx + 1}</td>
              <td><div class="item-title">${escapeHtml(item.title)}</div></td>
              <td class="text-center">${escapeHtml(hsnSacCode)}</td>
              <td class="text-right">${formatNumber(unitPrice)}</td>
              <td class="text-center">${qty}</td>
              <td class="text-right">${formatNumber(lineTaxable)}</td>
              <td class="text-right">${formatNumber(lineCgst)} (${cgstRate}%)</td>
              <td class="text-right">${formatNumber(lineSgst)} (${sgstRate}%)</td>
              <td class="text-right"><strong>${formatNumber(lineFinalAmount)}</strong></td>
            </tr>
          `;
        }

        if (isInterState) {
          return `
            <tr>
              <td class="text-center">${idx + 1}</td>
              <td><div class="item-title">${escapeHtml(item.title)}</div></td>
              <td class="text-center">${escapeHtml(hsnSacCode)}</td>
              <td class="text-right">${formatNumber(unitPrice)}</td>
              <td class="text-center">${qty}</td>
              <td class="text-right">${formatNumber(lineTaxable)}</td>
              <td class="text-right">${formatNumber(lineIgst)} (${igstRate}%)</td>
              <td class="text-right"><strong>${formatNumber(lineFinalAmount)}</strong></td>
            </tr>
          `;
        }

        return `
          <tr>
            <td class="text-center">${idx + 1}</td>
            <td><div class="item-title">${escapeHtml(item.title)}</div></td>
            <td class="text-center">${escapeHtml(hsnSacCode)}</td>
            <td class="text-right">${formatNumber(unitPrice)}</td>
            <td class="text-center">${qty}</td>
            <td class="text-right">${formatNumber(lineTaxable)}</td>
            <td class="text-right"><strong>${formatNumber(lineFinalAmount)}</strong></td>
          </tr>
        `;
      })
      .join('');

    const totalsRows = [];
    if (discountAmount > 0) {
      totalsRows.push(`
        <tr>
          <td class="t-label">Gross Subtotal</td>
          <td class="t-val">${formatCurrency(subtotalAmount)}</td>
        </tr>
        <tr>
          <td class="t-label">Coupon Discount${order.coupon_code ? ` (${escapeHtml(order.coupon_code)})` : ''}</td>
          <td class="t-val">- ${formatCurrency(discountAmount)}</td>
        </tr>
      `);
    }

    totalsRows.push(`
      <tr>
        <td class="t-label">Taxable Amount</td>
        <td class="t-val">${formatCurrency(taxableAmount)}</td>
      </tr>
    `);

    if (isIntraState) {
      totalsRows.push(`
        <tr>
          <td class="t-label">CGST ${cgstRate}%</td>
          <td class="t-val">${formatCurrency(cgstAmount)}</td>
        </tr>
        <tr>
          <td class="t-label">SGST ${sgstRate}%</td>
          <td class="t-val">${formatCurrency(sgstAmount)}</td>
        </tr>
      `);
    } else if (isInterState) {
      totalsRows.push(`
        <tr>
          <td class="t-label">IGST ${igstRate}%</td>
          <td class="t-val">${formatCurrency(igstAmount)}</td>
        </tr>
      `);
    }

    totalsRows.push(`
      <tr class="grand-row">
        <td class="t-label">Total</td>
        <td class="t-val">${formatCurrency(grandTotal)}</td>
      </tr>
      <tr class="payable-row">
        <td class="t-label">Amount Paid</td>
        <td class="t-val">${formatCurrency(grandTotal)}</td>
      </tr>
    `);

    const bank = order.company_bank_account || null;
    const txnRef =
      order.razorpay_payment_id ||
      order.utr_number ||
      order.razorpay_order_id ||
      order.order_no ||
      '—';

    const validityPeriod =
      order.start_date && order.end_date
        ? `${formatDate(order.start_date)} to ${formatDate(order.end_date)}`
        : '';

    const templateData = {
      company_logo_uri: companyLogoUri,
      company_name: escapeHtml(companyName),
      company_address: escapeHtml(companyAddress),
      company_gstin: escapeHtml(companyGstin),
      company_contact_line: companyContactLine,
      school_name: escapeHtml(schoolName),
      school_code: escapeHtml(schoolCode),
      school_address: escapeHtml(schoolAddress),
      school_location_line: escapeHtml(schoolLocationLine),
      school_phone: escapeHtml(schoolPhone),
      school_email: escapeHtml(schoolEmail),
      invoice_no: escapeHtml(order.invoice_no || order.order_no || '—'),
      order_no: escapeHtml(order.order_no || '—'),
      invoice_date: escapeHtml(formatDate(order.paid_at || order.created_at)),
      place_of_supply: escapeHtml((schoolState || gstSettings?.home_state_name || '—').toUpperCase()),
      items_table_head: itemsTableHead,
      items_table_rows: itemsTableRows,
      spacer_cells: spacerCells,
      total_items: rawItems.length,
      total_qty: totalQty,
      amount_in_words: escapeHtml(numberToIndianWords(grandTotal)),
      payment_method_label: escapeHtml(formatPaymentMethodLabel(order.payment_method)),
      transaction_ref: escapeHtml(txnRef),
      validity_period: escapeHtml(validityPeriod),
      bank_name: bank?.bank_name ? escapeHtml(bank.bank_name) : '',
      bank_account_number: bank?.account_number ? escapeHtml(bank.account_number) : '',
      bank_ifsc: bank?.ifsc_code ? escapeHtml(bank.ifsc_code) : '',
      bank_branch: bank?.branch_name ? escapeHtml(bank.branch_name) : '',
      bank_upi: bank?.upi_id ? escapeHtml(bank.upi_id) : '',
      totals_table_rows: totalsRows.join('\n'),
      shipping_address: order.shipping_address ? escapeHtml(order.shipping_address) : '',
      footer_text: footerSetting?.footer_text ? escapeHtml(footerSetting.footer_text) : '',
    };

    return renderTemplate(getTemplateHtml(), templateData);
  }

  /**
   * Generate the official A4 Tax Invoice PDF buffer using a warm Puppeteer tab
   */
  static async generateInvoicePdfBuffer(order) {
    const html = await SubscriptionInvoicePdfService.generateInvoiceHtml(order);
    const browser = await getWarmBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close().catch(() => {});
    }
  }
}

module.exports = SubscriptionInvoicePdfService;
