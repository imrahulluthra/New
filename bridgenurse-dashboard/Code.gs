/**
 * BridgeNurse survey dashboard, hosted by Google Apps Script.
 *
 * The web page (Index.html) asks getSurveyValues() for the sheet's rows each time
 * it loads or refreshes. Emails and phone numbers are removed here, on Google's
 * servers, so they never reach anyone's browser.
 */

// The response sheet. Change these only if the sheet or tab is renamed or moved.
const SPREADSHEET_ID = '1woB2wepjtUwiE-iBqmKnliYKdYAJykltysItpSz6Qu0';
const SHEET_NAME = 'Form Responses 1';

// false hides candidate names on the page (they show as "Candidate 12" instead).
const SHOW_NAMES = true;

// Columns whose header matches any of these are never sent to the page.
const PRIVATE_COLUMNS = [/^email/i, /mobile/i, /phone/i, /upload a proof/i];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('BridgeNurse Survey')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Returns the sheet as {values: [[header…], [row…], …]} without private columns. */
function getSurveyValues() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Could not find the tab "' + SHEET_NAME + '" in the spreadsheet.');
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { values: [] };

  const header = values[0].map(String);
  const keep = [];
  const proofCol = header.findIndex((h) => /upload a proof/i.test(h));
  header.forEach((h, i) => {
    if (!PRIVATE_COLUMNS.some((re) => re.test(h.trim()))) keep.push(i);
  });
  const nameCol = header.findIndex((h) => /^name$/i.test(h.trim()));

  const out = values.map((row, r) => {
    const kept = keep.map((i) => {
      if (r > 0 && i === nameCol && !SHOW_NAMES) return 'Candidate ' + r;
      return row[i];
    });
    // Keep only whether a proof was uploaded, not the link to the file.
    kept.push(r === 0 ? 'Upload a proof (optional)' : proofCol >= 0 && String(row[proofCol]).trim() ? 'yes' : '');
    return kept;
  });
  return { values: out, updated: new Date().toISOString() };
}
