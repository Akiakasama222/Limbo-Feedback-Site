'use strict';
// The "setup check" shown to the admin: which settings are missing or wrong, and whether the Google Sheet can be read.
const { describeServiceAccount } = require('./google');
const { getStore, COLUMNS } = require('./store');

async function checkSetup() {
  const checks = [];
  const add = (name, ok, message) => checks.push({ name, ok, message });

  const sheetId = process.env.GOOGLE_SHEET_ID;
  add('GOOGLE_SHEET_ID', !!sheetId, sheetId ? 'Set.' : 'Missing. Add it under Vercel > Settings > Environment Variables (the long ID from your sheet address), then redeploy.');

  const account = describeServiceAccount();
  add('GOOGLE_SERVICE_ACCOUNT_JSON', account.ok, account.ok ? 'Valid. Your Google Sheet must be shared (as Editor) with: ' + account.email : account.problem);

  add('MAKE_WEBHOOK_URL', true, process.env.MAKE_WEBHOOK_URL
    ? 'Set: new feedback is sent to Make, which adds the row to the sheet.'
    : 'Not set: the site adds new rows to the sheet itself.');

  if (sheetId && account.ok) {
    try {
      const { headers, rows } = await getStore().diagnose();
      const same = COLUMNS.every((name, i) => headers[i] === name) && headers.length === COLUMNS.length;
      const oldLayout = COLUMNS.slice(0, 10).every((name, i) => headers[i] === name) && headers.length === 10;
      add('Google Sheet access', true, 'Connected. ' + rows + ' entr' + (rows === 1 ? 'y' : 'ies') + ' found.');
      add('Sheet header row (row 1)', same, same ? 'Correct.'
        : oldLayout ? 'Add the header "rating" in cell K1 (star ratings are saved in column K), and map it in your Make scenario.'
        : 'Row 1 must be exactly: ' + COLUMNS.join(', ') + ' - but it is: ' + (headers.join(', ') || '(empty)'));
    } catch (err) {
      add('Google Sheet access', false, err.detail || err.message);
    }
  } else {
    add('Google Sheet access', false, 'Not checked yet - fix the settings above first.');
  }
  return checks;
}

module.exports = { checkSetup };
