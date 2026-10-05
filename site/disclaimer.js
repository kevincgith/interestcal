// The disclaimer printed on every download, matching the site footer. The full terms are on terms.html.

export const DISCLAIMER =
  'Disclaimer: for general information only, not legal, financial or mortgage advice. Rates and price index ' +
  'figures are collected automatically and may be delayed or wrong; the official publisher’s figures prevail. Check every figure before ' +
  'relying on it.';
export const TERMS_URL = 'https://app.kevinlhc.com/interestcal/terms.html';
// For plain-text downloads (Word, Excel, CSV), which can't hold a named link
export const DISCLAIMER_WITH_TERMS = `${DISCLAIMER} Terms of use: ${TERMS_URL}`;

/**
 * Draws the disclaimer under the content of a jsPDF report, on a new page if it doesn't fit, with "Terms of Use" as a
 * clickable link (no raw URL printed).
 * @param {object} doc     jsPDF document
 * @param {number} y       top of the free space on the current page
 * @param {object} opts    { margin, color: [r, g, b], clean: (s) => string for Helvetica's Latin-1 }
 */
export function pdfDisclaimer(doc, y, { margin, color, clean }) {
  const size = 7.5;
  const lineHeight = size * 1.3;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...color);
  const lines = doc.splitTextToSize(clean(DISCLAIMER), width);
  const needed = lineHeight * (lines.length + 1) + 8;
  if (y + needed > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    y = margin;
  }
  y += 8;
  doc.text(lines, margin, y + size, { lineHeightFactor: 1.3 });
  y += lineHeight * lines.length;
  doc.text('See the ', margin, y + size);
  const x = margin + doc.getTextWidth('See the ');
  doc.setTextColor(31, 95, 139);
  doc.textWithLink('Terms of Use', x, y + size, { url: TERMS_URL });
  doc.setTextColor(...color);
  doc.text('.', x + doc.getTextWidth('Terms of Use'), y + size);
}
