const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// =========================================================
// FILES / COMPANY
// =========================================================

const LOGO_PATH = path.join(
  __dirname,
  '..',
  'assets',
  'logo.jpeg'
);

const COMPANY_ADDRESS =
  process.env.COMPANY_ADDRESS || '';

// =========================================================
// MONTHS
// =========================================================

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// =========================================================
// HELPERS
// =========================================================

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const pad = (value) =>
  String(value).padStart(2, '0');

const inr = (value) =>
  num(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const isEmpty = (value) =>
  value === null ||
  value === undefined ||
  value === '';

const mask = (value) => {
  if (isEmpty(value)) {
    return '-';
  }

  const text = String(value);

  if (text.length <= 4) {
    return text;
  }

  return (
    'X'.repeat(text.length - 4) +
    text.slice(-4)
  );
};

// =========================================================
// DATE FORMAT
// =========================================================
//
// Converts:
// 2026-07-01
// 2026-07-01T00:00:00.000Z
// Date object
//
// Into:
// 01 Jul 2026
//
// Using the date portion directly avoids timezone
// shifting the date by one day.
// =========================================================

const formatDate = (value) => {
  if (isEmpty(value)) {
    return '-';
  }

  let year;
  let month;
  let day;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return '-';
    }

    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  } else {
    const text = String(value);

    const match = text.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return '-';
      }

      year = date.getFullYear();
      month = date.getMonth() + 1;
      day = date.getDate();
    }
  }

  if (
    !year ||
    !month ||
    !day ||
    month < 1 ||
    month > 12
  ) {
    return '-';
  }

  return `${pad(day)} ${
    MONTHS[month - 1].slice(0, 3)
  } ${year}`;
};

// =========================================================
// TAX REGIME
// =========================================================

const formatTaxRegime = (value) => {
  if (isEmpty(value)) {
    return '-';
  }

  const regime = String(value)
    .trim()
    .toLowerCase();

  if (regime === 'new') {
    return 'New Regime';
  }

  if (regime === 'old') {
    return 'Old Regime';
  }

  return String(value);
};

// =========================================================
// EMPLOYEE STATUS
// =========================================================

const formatStatus = (value) => {
  return value === true
    ? 'Active'
    : 'Inactive';
};

// =========================================================
// AMOUNT IN WORDS
// INDIAN NUMBERING SYSTEM
// =========================================================

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

const twoDigits = (n) => {
  n = Math.floor(num(n));

  if (n <= 0) {
    return '';
  }

  if (n < 20) {
    return ONES[n];
  }

  return (
    TENS[Math.floor(n / 10)] +
    (n % 10
      ? ` ${ONES[n % 10]}`
      : '')
  );
};

const threeDigits = (n) => {
  n = Math.floor(num(n));

  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;

  return [
    hundreds
      ? `${ONES[hundreds]} Hundred`
      : '',
    remainder
      ? twoDigits(remainder)
      : '',
  ]
    .filter(Boolean)
    .join(' ');
};

const inWords = (value) => {
  let n = Math.floor(num(value));

  if (n === 0) {
    return 'Zero';
  }

  const crore = Math.floor(n / 10000000);
  n %= 10000000;

  const lakh = Math.floor(n / 100000);
  n %= 100000;

  const thousand = Math.floor(n / 1000);
  n %= 1000;

  return [
    crore
      ? `${threeDigits(crore)} Crore`
      : '',

    lakh
      ? `${twoDigits(lakh)} Lakh`
      : '',

    thousand
      ? `${twoDigits(thousand)} Thousand`
      : '',

    n
      ? threeDigits(n)
      : '',
  ]
    .filter(Boolean)
    .join(' ');
};

const netWords = (value) => {
  const amount = Math.round(
    num(value) * 100
  );

  const rupees = Math.floor(
    amount / 100
  );

  const paise = amount % 100;

  return `Rupees ${inWords(rupees)}${
    paise
      ? ` and ${twoDigits(paise)} Paise`
      : ''
  } Only`;
};

// =========================================================
// PDF EXPORT
// =========================================================

module.exports = (res, p) => {
  const month = Number(p.month);
  const year = Number(p.year);

  const monthName =
    MONTHS[month - 1] || '';

  const lastDay = new Date(
    year,
    month,
    0
  ).getDate();

  // =======================================================
  // CREATE PDF
  // =======================================================

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true,
  });

  // =======================================================
  // RESPONSE HEADERS
  // =======================================================

  res.setHeader(
    'Content-Type',
    'application/pdf'
  );

  // File name: "<Full Name> - <Month> <Year>.pdf", safe for headers and file systems.
  const safeName = String(p.name || p.emp_code || 'Employee')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Employee';
  const fileName = `${safeName} - ${monthName} ${year}.pdf`;
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );

  doc.pipe(res);

  const pageW = doc.page.width;

  const left = 40;

  const contentW =
    pageW - left * 2;

  let y = 28;

  // =======================================================
  // TABLE CELL HELPER
  // =======================================================

  const cell = (
    x,
    cy,
    width,
    height,
    text,
    options = {}
  ) => {
    const fill =
      options.fill || null;

    const color =
      options.color || '#0f172a';

    const bold =
      options.bold || false;

    const size =
      options.size || 9;

    const align =
      options.align || 'left';

    if (fill) {
      doc
        .save()
        .rect(
          x,
          cy,
          width,
          height
        )
        .fill(fill)
        .restore();
    }

    doc
      .save()
      .rect(
        x,
        cy,
        width,
        height
      )
      .lineWidth(0.5)
      .strokeColor('#cbd5e1')
      .stroke()
      .restore();

    doc
      .fillColor(color)
      .font(
        bold
          ? 'Helvetica-Bold'
          : 'Helvetica'
      )
      .fontSize(size)
      .text(
        String(text ?? ''),
        x + 8,
        cy + (height - size) / 2 - 1,
        {
          width: width - 16,
          height: height - 6,
          ellipsis: true,
          align,
        }
      );
  };

  // =======================================================
  // 1. COMPANY LOGO
  // =======================================================

  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(
        LOGO_PATH,
        (pageW - 200) / 2,
        y,
        {
          fit: [200, 58],
          align: 'center',
          valign: 'center',
        }
      );

      y += 65;
    } catch (error) {
      console.error(
        'Logo could not be loaded:',
        error.message
      );
    }
  }

  // =======================================================
  // 2. COMPANY ADDRESS
  // =======================================================

  if (COMPANY_ADDRESS) {
    doc
      .fillColor('#64748b')
      .font('Helvetica')
      .fontSize(8)
      .text(
        COMPANY_ADDRESS,
        left,
        y,
        {
          width: contentW,
          align: 'center',
        }
      );

    y += 13;
  }

  y += 6;

  // =======================================================
  // 3. TITLE
  // =======================================================

  doc
    .rect(
      left,
      y,
      contentW,
      46
    )
    .fill('#4f46e5');

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(
      `Payslip for ${monthName} ${year}`,
      left,
      y + 8,
      {
        width: contentW,
        align: 'center',
      }
    );

  doc
    .font('Helvetica')
    .fontSize(9)
    .text(
      `Pay period: 01 ${monthName.slice(
        0,
        3
      )} ${year} to ${pad(
        lastDay
      )} ${monthName.slice(
        0,
        3
      )} ${year}`,
      left,
      y + 27,
      {
        width: contentW,
        align: 'center',
      }
    );

  y += 46 + 12;

  // =======================================================
  // 4. EMPLOYEE DETAILS
  // =======================================================
  //
  // Department intentionally excluded.
  // Annual CTC intentionally excluded.
  //
  // All information here comes from the employee
  // record joined by the payslip download route.
  // =======================================================

  // Loss Of Pay days come from the calculation snapshot saved with the payslip.
  let snapshot = p.calculation_snapshot;
  if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; } }
  const lossOfPayDays = Array.isArray(snapshot?.unpaid_dates) ? snapshot.unpaid_dates.length : 0;
  const money2 = (value) => (Math.round(num(value) * 100) / 100).toString();

  const employeeDetails = [
    ['Employee Name', p.name],
    ['Employee ID', p.emp_code || p.employee_id],
    ['Designation', p.designation],
    ['Date of Joining', formatDate(p.joining_date)],
    ['Email', p.email],
    ['Date of Birth', formatDate(p.dob)],
    ['PAN', p.pan],
    ['PF UAN', p.pf_uan],
    ['Bank', p.bank_name],
    ['Bank Branch', p.bank_branch],
    ['Bank Account No.', mask(p.account_number)],
    ['IFSC Code', p.ifsc_code],
    ['Days in Month', p.month_days ?? lastDay],
    ['Paid Days', money2(p.net_paid_days)],
    ['Loss Of Pay (days)', money2(lossOfPayDays)],
    ['Pay Period', `01 ${monthName.slice(0, 3)} ${year} - ${pad(lastDay)} ${monthName.slice(0, 3)} ${year}`],
    ...(p.resignation_date ? [['Date of Resignation', formatDate(p.resignation_date)], ['', '']] : []),
  ];

  const detailLabelW = 100;
  const detailValueW =
    (contentW -
      detailLabelW * 2) /
    2;

  const detailRowH = 22;

  for (
    let i = 0;
    i < employeeDetails.length;
    i += 2
  ) {
    const first =
      employeeDetails[i];

    const second =
      employeeDetails[i + 1] || [
        '',
        '',
      ];

    let x = left;

    // First label
    cell(
      x,
      y,
      detailLabelW,
      detailRowH,
      first[0],
      {
        fill: '#f1f5f9',
        color: '#475569',
        bold: true,
        size: 8,
      }
    );

    x += detailLabelW;

    // First value
    cell(
      x,
      y,
      detailValueW,
      detailRowH,
      isEmpty(first[1])
        ? '-'
        : first[1],
      {
        size: 8.5,
      }
    );

    x += detailValueW;

    // Second label
    cell(
      x,
      y,
      detailLabelW,
      detailRowH,
      second[0],
      {
        fill: '#f1f5f9',
        color: '#475569',
        bold: true,
        size: 8,
      }
    );

    x += detailLabelW;

    // Second value
    cell(
      x,
      y,
      detailValueW,
      detailRowH,
      isEmpty(second[1])
        ? ''
        : second[1],
      {
        size: 8.5,
      }
    );

    y += detailRowH;
  }

  y += 14;

  // =======================================================
  // 5. EARNINGS & DEDUCTIONS
  // =======================================================

  const earnings = [
    [
      'Basic',
      p.basic,
    ],
    [
      'HRA (House Rent Allowance)',
      p.hra,
    ],
    [
      'Special Allowance',
      p.special_allowance,
    ],
    [
      'LTA (Leave Travel Allowance)',
      p.lta,
    ],
    [
      'Other Allowances',
      p.other_allowances,
    ],
    [
      'Additional Allowance',
      p.allowances,
    ],
  ];

  const loanRecoveries = Array.isArray(p.advance_recoveries) ? p.advance_recoveries : [];
  const salaryAdvance = Math.round((num(p.advance) - loanRecoveries.reduce((sum, entry) => sum + num(entry.amount), 0)) * 100) / 100;
  const deductions = [
    ...(num(p.late_login_deduction) > 0
      ? [['Late login (half day)', p.late_login_deduction]] : []),
    [
      "EPF (Employees' Provident Fund)",
      p.epf,
    ],
    [
      'Professional Tax',
      p.professional_tax,
    ],
    ...loanRecoveries.map((entry) => [entry.record_type === 'salary_advance' ? `Salary advance ADV-${entry.advance_id}` : `Loan LOAN-${entry.advance_id} (incl. interest)`, entry.amount]),
    ...(salaryAdvance > 0
      ? [[loanRecoveries.length ? 'Salary advance' : 'Loan / salary advance', salaryAdvance]]
      : []),
    ...(p.unpaid_leave_deduction == null
      ? (num(p.deductions) > 0 ? [['Other / Loss Of Pay deductions', p.deductions]] : [])
      : [['Loss Of Pay', p.unpaid_leave_deduction], ['Additional deductions', p.additional_deductions]].filter(([, value]) => num(value) > 0)),
  ];

  const totalEarnings =
    earnings.reduce(
      (sum, [, value]) =>
        sum + num(value),
      0
    );

  const totalDeductions =
    deductions.reduce(
      (sum, [, value]) =>
        sum + num(value),
      0
    );

  // IMPORTANT:
  // net_pay is the actual value stored in PostgreSQL.
  const netPay = num(p.net_pay);

  const tableWidths = [
    170,
    87.5,
    170,
    87.5,
  ];

  const tableHeader = {
    fill: '#eef2ff',
    color: '#312e81',
    bold: true,
    size: 8.5,
  };

  let x = left;

  [
    'Earnings',
    'Amount (INR)',
    'Deductions',
    'Amount (INR)',
  ].forEach((header, index) => {
    cell(
      x,
      y,
      tableWidths[index],
      25,
      header,
      {
        ...tableHeader,
        align:
          index % 2
            ? 'right'
            : 'left',
      }
    );

    x += tableWidths[index];
  });

  y += 25;

  const rows = Math.max(
    earnings.length,
    deductions.length
  );

  const salaryRowH = 22;

  for (
    let i = 0;
    i < rows;
    i++
  ) {
    const earning =
      earnings[i];

    const deduction =
      deductions[i];

    // Earnings label
    cell(
      left,
      y,
      tableWidths[0],
      salaryRowH,
      earning
        ? earning[0]
        : '',
      {
        size: 8.5,
      }
    );

    // Earnings amount
    cell(
      left + tableWidths[0],
      y,
      tableWidths[1],
      salaryRowH,
      earning
        ? inr(earning[1])
        : '',
      {
        size: 8.5,
        align: 'right',
      }
    );

    // Deduction label
    cell(
      left +
        tableWidths[0] +
        tableWidths[1],
      y,
      tableWidths[2],
      salaryRowH,
      deduction
        ? deduction[0]
        : '',
      {
        size: 8.5,
      }
    );

    // Deduction amount
    cell(
      left +
        tableWidths[0] +
        tableWidths[1] +
        tableWidths[2],
      y,
      tableWidths[3],
      salaryRowH,
      deduction
        ? inr(deduction[1])
        : '',
      {
        size: 8.5,
        align: 'right',
      }
    );

    y += salaryRowH;
  }

  // =======================================================
  // TOTALS
  // =======================================================

  const totalOptions = {
    fill: '#f1f5f9',
    color: '#0f172a',
    bold: true,
    size: 8.5,
  };

  cell(
    left,
    y,
    tableWidths[0],
    25,
    'Total Earnings',
    totalOptions
  );

  cell(
    left + tableWidths[0],
    y,
    tableWidths[1],
    25,
    inr(totalEarnings),
    {
      ...totalOptions,
      align: 'right',
    }
  );

  cell(
    left +
      tableWidths[0] +
      tableWidths[1],
    y,
    tableWidths[2],
    25,
    'Total Deductions',
    totalOptions
  );

  cell(
    left +
      tableWidths[0] +
      tableWidths[1] +
      tableWidths[2],
    y,
    tableWidths[3],
    25,
    inr(totalDeductions),
    {
      ...totalOptions,
      align: 'right',
    }
  );

  y += 25 + 14;

  if (num(p.late_login_deduction) > 0) {
    doc.fillColor('#475569').font('Helvetica').fontSize(8.5)
      .text(p.late_login_reason, left, y, { width: contentW });
    y = doc.y + 10;
  }

  // =======================================================
  // 6. NET PAY
  // =======================================================

  doc
    .roundedRect(
      left,
      y,
      contentW,
      46,
      6
    )
    .fill('#4f46e5');

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(
      'NET PAY',
      left + 16,
      y + 17
    );

  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(
      `INR ${inr(netPay)}`,
      left + 16,
      y + 13,
      {
        width: contentW - 32,
        align: 'right',
      }
    );

  y += 46 + 8;

  // =======================================================
  // 7. NET PAY IN WORDS
  // =======================================================

  doc
    .rect(
      left,
      y,
      contentW,
      40
    )
    .lineWidth(0.5)
    .strokeColor('#cbd5e1')
    .stroke();

  doc
    .fillColor('#475569')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(
      'Net Pay in Words',
      left + 10,
      y + 7
    );

  doc
    .fillColor('#0f172a')
    .font('Helvetica')
    .fontSize(9)
    .text(
      netWords(netPay),
      left + 10,
      y + 20,
      {
        width: contentW - 20,
      }
    );

  y += 40 + 16;

  // =======================================================
  // 8. FOOTER
  // =======================================================

  const currentYear =
    new Date().getFullYear();

  doc
    .fillColor('#94a3b8')
    .font('Helvetica')
    .fontSize(7.5)
    .text(
      `© ${currentYear} 5 Gen Educon Private Limited. All rights reserved.`,
      left,
      y,
      {
        width: contentW,
        align: 'center',
      }
    );

  // =======================================================
  // FINISH PDF
  // =======================================================

  doc.end();
};
