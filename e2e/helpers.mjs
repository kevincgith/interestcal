// Shared by the browser tests
const FORMAT = { word: 'Word', pdf: 'PDF', excel: 'Excel', xlsx: 'Excel', docx: 'Word' };

/**
 * Download a file from the open tab: press its button in "Download [Word | PDF | Excel]".
 * @param {string} which  'Word', 'PDF' or 'Excel', or the old button names ('Download Excel') and ids ('#mXlsx')
 */
export async function downloadAs(page, which) {
  const key = String(which).replace(/^Download\s+/i, '').replace(/^#(?:[mp](?=[A-Z]))?/, '').toLowerCase(); // '#mXlsx' -> 'xlsx'
  const name = FORMAT[key] ?? which;
  await page.locator('[role="tabpanel"]:not([hidden])').getByRole('button', { name: `Download ${name}`, exact: true }).click();
}
