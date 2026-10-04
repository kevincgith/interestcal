// Builds a Word (.docx) interest schedule in the style of a statutory demand / judgment interest table:
//   Interest on the Debt of HK$150,861,190.50                                   HK$
//   (i) Interest on the sum of HK$150,861,190.50 at the rate of 8.250% per annum      409,185.15
//       from 20 September 2025 to 2 October 2025 (12 days)
//       (i.e. 150,861,190.50 × 8.250% × 12 ÷ 365 = 409,185.15)
//   Total:                                                                   9,883.88
// A .docx is a zip of a few XML files; it's written here directly (stored, uncompressed), so no library is needed.
// Dates are the calculator's own periods: "from" the first day, which earns interest, "to" the end date, which doesn't
// (so 20 September to 2 October is 12 days), as on screen and in the other downloads.

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
/** "2026-10-01" -> "1 October 2026" */
export const longDate = (iso) => `${+iso.slice(8, 10)} ${LONG_MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

/** 1 -> "i", 4 -> "iv", 14 -> "xiv" */
export function roman(n) {
  const parts = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of parts) for (; n >= v; n -= v) out += s;
  return out;
}

// "the sum of HK$100,000.00", or on a combined row whose principal changed, "the sums of HK$100,000.00 then HK$90,000.00"
const sumText = (p, money, cur) => {
  const sums = [...new Set((p.parts ?? [p]).map((x) => x.principal))];
  return sums.length === 1 ? `the sum of ${cur}${money(sums[0])}` : `the sums of ${sums.map((x) => `${cur}${money(x)}`).join(' then ')}`;
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- WordprocessingML ----

const run = (text, { bold = false, underline = false } = {}) =>
  `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${underline ? '<w:u w:val="single"/>' : ''}</w:rPr>` +
  `<w:t xml:space="preserve">${esc(text).replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">')}</w:t></w:r>`;
const para = (runs, { align, hanging } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="0"/>${hanging ? `<w:ind w:left="${hanging}" w:hanging="${hanging}"/>` : ''}` +
  `${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runs}</w:p>`;
const LEFT_W = 7000;
const RIGHT_W = 2026;
const cell = (width, paras) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paras}</w:tc>`;
const tableRow = (left, right) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(LEFT_W, left)}${cell(RIGHT_W, right)}</w:tr>`;

/**
 * @param {object} r    result of calculateInterest
 * @param {object} ctx  { money: (n) => string, rate: (fraction) => string, formula: (period) => string,
 *   currency?: 'HK$' (default) or 'US$' }
 * @returns {string} word/document.xml
 */
export function documentXml(r, { money, rate, formula, currency: cur = 'HK$' }) {
  const rows = [
    tableRow(
      para(run(`Interest on the Debt of ${cur}${money(r.principal)}`, { bold: true })),
      para(run(cur, { bold: true, underline: true }), { align: 'right' }),
    ),
  ];
  r.periods.forEach((p, i) => {
    const days = `${p.days} ${p.days === 1 ? 'day' : 'days'}`;
    const amount = money(p.interest);
    rows.push(tableRow(
      para(run(`(${roman(i + 1)})\tInterest on ${sumText(p, money, cur)} at the rate of ${rate(p.rate)} per annum ` +
        `from ${longDate(p.start)} to ${longDate(p.end)} (${days})`), { hanging: 680 }) +
        para(run(`(i.e. ${formula(p)} = ${amount})`)) +
        para(''),
      para(run(amount), { align: 'right' }),
    ));
  });
  rows.push(tableRow(para(run('Total:', { bold: true })), para(run(money(r.totalInterest), { bold: true }), { align: 'right' })));

  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  const table =
    `<w:tbl><w:tblPr><w:tblW w:w="${LEFT_W + RIGHT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
    `<w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${LEFT_W}"/><w:gridCol w:w="${RIGHT_W}"/></w:tblGrid>${rows.join('')}</w:tbl>`;

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    `${table}${para('')}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>' +
  '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" ' +
  'w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults></w:styles>';

const PARTS = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
    'Target="word/document.xml"/></Relationships>',
  'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
    'Target="styles.xml"/></Relationships>',
  'word/styles.xml': STYLES,
};

// ---- Zip (stored entries, no compression) ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {[string, Uint8Array][]} files @returns {Uint8Array} */
export function zip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // fixed date: the output depends only on the content
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, DOS_TIME, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** @returns {Uint8Array} the .docx file */
export function buildDocx(r, ctx) {
  const enc = new TextEncoder();
  const files = { ...PARTS, 'word/document.xml': documentXml(r, ctx) };
  return zip(Object.entries(files).map(([name, xml]) => [name, enc.encode(xml)]));
}
