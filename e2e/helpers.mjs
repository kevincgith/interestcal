// Shared by the browser tests
const FORMAT = { word: 'Word', pdf: 'PDF', excel: 'Excel', xlsx: 'Excel', docx: 'Word' };

/**
 * Download a file from the open tab: choose its format (Word | PDF | Excel), then press Download.
 * @param {string} which  'Word', 'PDF' or 'Excel', or the old button names ('Download Excel') and ids ('#mXlsx')
 */
export async function downloadAs(page, which) {
  const key = String(which).replace(/^Download\s+/i, '').replace(/^#(?:[mp](?=[A-Z]))?/, '').toLowerCase(); // '#mXlsx' -> 'xlsx'
  const name = FORMAT[key] ?? which;
  const row = page.locator('[role="tabpanel"]:not([hidden]) .download-row');
  await row.getByRole('radio', { name, exact: true }).check();
  await row.locator('.download').click();
}
