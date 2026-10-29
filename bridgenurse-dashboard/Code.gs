/**
 * BridgeNurse survey dashboard, hosted by Google Apps Script.
 *
 * The web page (Index.html) calls getDashboardData() each time it loads or refreshes.
 * Everything private (emails, phone numbers, links to uploaded files) is used here,
 * on Google's servers, to clean the data and is then removed, so it never reaches
 * anyone's browser.
 */

// The sheet. Change these only if the spreadsheet or a tab is renamed or moved.
const SPREADSHEET_ID = '1woB2wepjtUwiE-iBqmKnliYKdYAJykltysItpSz6Qu0';
const SHEET_NAME = 'Form Responses 1';
const WAITLIST_TAB = 'Website submissions';

// false hides candidate names on the page (they show as "Candidate 12" instead).
const SHOW_NAMES = true;

// Pipeline stages for the Status column, in order. A blank Status counts as "Not contacted".
const STATUS_ORDER = ['Not contacted', 'Called', 'Interested', 'Documents', 'Language class'];
const STATUS_EXCLUDE = /^exclude/i;

// Referral codes written in words, mapped to the code they stand for.
const REFERRAL_ALIASES = [[/rahul/i, 'RAH961']];

// Columns whose header matches any of these are never sent to the page.
const PRIVATE_COLUMNS = [/^email/i, /mobile/i, /phone/i, /upload a proof/i];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('BridgeNurse Survey')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Both tabs, cleaned, without private columns, plus counts of what cleaning removed. */
function getDashboardData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const survey = cleanTab_(ss, SHEET_NAME, true);
  const waitlist = cleanTab_(ss, WAITLIST_TAB, false);

  // People who filled both the survey and the website form, matched by email or phone.
  const surveyKeys = new Set();
  survey.keys.forEach((ks) => ks.forEach((k) => surveyKeys.add(k)));
  let inBoth = 0;
  waitlist.keys.forEach((ks, i) => {
    const both = ks.some((k) => surveyKeys.has(k));
    if (both) inBoth++;
    waitlist.values[i + 1].push(both ? 'yes' : '');
  });
  if (waitlist.values.length) waitlist.values[0].push('Also in survey');

  return {
    survey: { values: survey.values },
    waitlist: { values: waitlist.values },
    cleaning: {
      survey_raw: survey.raw, survey_test: survey.test, survey_repeats: survey.repeats, survey_kept: survey.kept,
      waitlist_raw: waitlist.raw, waitlist_test: waitlist.test, waitlist_repeats: waitlist.repeats, waitlist_kept: waitlist.kept,
      in_both: inBoth, unique_people: survey.kept + waitlist.kept - inBoth,
    },
    updated: new Date().toISOString(),
  };
}

/**
 * Reads one tab and returns its rows with test entries removed, each person counted once
 * (their latest submission, matched by email or phone), private columns dropped and
 * referral codes tidied.
 */
function cleanTab_(ss, tabName, hasStatus) {
  const sheet = ss.getSheetByName(tabName);
  const empty = { values: [], keys: [], raw: 0, test: 0, repeats: 0, kept: 0 };
  if (!sheet) return empty;
  const range = sheet.getDataRange();
  const shown = range.getDisplayValues();
  const typed = range.getValues();
  if (shown.length < 1) return empty;

  const header = shown[0].map((h) => String(h).trim());
  const find = (re) => header.findIndex((h) => re.test(h));
  const col = {
    ts: find(/^timestamp/i), name: find(/^name$/i), email: find(/^email/i), work: find(/currently working/i),
    ref: find(/referral code/i), proof: find(/upload a proof/i), status: hasStatus ? find(/^status$/i) : -1,
  };
  const phoneCols = header.map((h, i) => (/mobile|phone/i.test(h) ? i : -1)).filter((i) => i >= 0);
  const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');

  // 1. Drop blank rows and test entries.
  const rows = [];
  let raw = 0, test = 0;
  for (let r = 1; r < shown.length; r++) {
    const row = shown[r];
    if (!row.some((c) => String(c).trim() !== '')) continue;
    raw++;
    const name = cell(row, col.name), email = cell(row, col.email).toLowerCase(), work = cell(row, col.work);
    const isTest = /^tes[rt]\d*$/i.test(name) || /^test[^@]*@/.test(email) || /^test$/i.test(email) || /^test$/i.test(work)
      || STATUS_EXCLUDE.test(cell(row, col.status));
    if (isTest) { test++; continue; }
    const keys = [];
    if (/@/.test(email)) keys.push('e:' + email);
    phoneCols.forEach((i) => { const d = cell(row, i).replace(/\D/g, ''); if (d.length >= 10) keys.push('p:' + d.slice(-10)); });
    const t = typed[r][col.ts];
    rows.push({ r, keys, time: t instanceof Date ? t.getTime() : Date.parse(cell(row, col.ts)) || r });
  }

  // 2. Group submissions that share an email or phone; keep each person's latest one.
  const parent = rows.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const owner = {};
  rows.forEach((x, i) => x.keys.forEach((k) => { if (k in owner) parent[root(i)] = root(owner[k]); else owner[k] = i; }));
  const groups = {};
  rows.forEach((x, i) => { (groups[root(i)] = groups[root(i)] || []).push(x); });
  const people = Object.keys(groups).map((g) => groups[g].sort((a, b) => a.time - b.time));
  people.sort((a, b) => a[a.length - 1].r - b[b.length - 1].r);

  // 3. Build the rows the page sees.
  const keep = header.map((h, i) => i).filter((i) => !PRIVATE_COLUMNS.some((re) => re.test(header[i])));
  const outHeader = keep.map((i) => header[i]).concat(['Upload a proof (optional)', 'Repeat submissions', 'Sheet row']);
  const values = [outHeader], keys = [];
  people.forEach((subs, n) => {
    const latest = shown[subs[subs.length - 1].r];
    const row = keep.map((i) => latest[i]);
    const at = (i) => keep.indexOf(i);

    // Someone who typed a referral code where their name should be.
    let name = cell(latest, col.name), ref = cell(latest, col.ref);
    if (/^[a-z]{2,4}\d{2,4}$/i.test(name)) { if (!ref) ref = name.toUpperCase(); name = 'Name not given'; }
    if (!SHOW_NAMES) name = 'Candidate ' + (n + 1);
    if (at(col.name) >= 0) row[at(col.name)] = name;

    if (at(col.ref) >= 0) {
      let code = ref.replace(/\s+/g, ' ').trim();
      const alias = REFERRAL_ALIASES.find(([re]) => re.test(code));
      if (alias) code = alias[1];
      else if (/^[a-z0-9-]+$/i.test(code)) code = code.toUpperCase();
      row[at(col.ref)] = code;
    }

    // The furthest pipeline stage any of their submissions reached.
    if (col.status >= 0 && at(col.status) >= 0) {
      const best = subs.map((s) => cell(shown[s.r], col.status)).reduce((a, b) => (STATUS_ORDER.indexOf(b) > STATUS_ORDER.indexOf(a) || (b && !a) ? b : a), '');
      row[at(col.status)] = best;
    }

    const proof = subs.some((s) => col.proof >= 0 && cell(shown[s.r], col.proof));
    values.push(row.concat([proof ? 'yes' : '', String(subs.length - 1), String(subs[subs.length - 1].r + 1)]));
    keys.push([].concat.apply([], subs.map((s) => s.keys)));
  });

  return { values, keys, raw, test, repeats: rows.length - people.length, kept: people.length };
}
