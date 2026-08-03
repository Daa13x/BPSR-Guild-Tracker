const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime, call } = require('./runtime');

function setCell(sheet, header, row, value) {
  const column = sheet.rows[0].indexOf(header);
  assert.notEqual(column, -1, `missing ${header} column`);
  sheet.rows[row - 1][column] = value;
}

function countColumnWrites(sheet, header) {
  const target = sheet.rows[0].indexOf(header) + 1;
  const original = sheet.getRange.bind(sheet);
  let writes = 0;
  sheet.getRange = function (row, column, height = 1, width = 1) {
    const range = original(row, column, height, width);
    const setValue = range.setValue.bind(range);
    const setValues = range.setValues.bind(range);
    range.setValue = function (value) {
      if (column <= target && target < column + width) writes++;
      return setValue(value);
    };
    range.setValues = function (values) {
      if (column <= target && target < column + width) writes++;
      return setValues(values);
    };
    return range;
  };
  return function () { return writes; };
}

function countTableReads(sheets, names) {
  const reads = {};
  names.forEach(function (name) {
    reads[name] = 0;
    const sheet = sheets[name];
    const original = sheet.getRange.bind(sheet);
    sheet.getRange = function () {
      const range = original.apply(sheet, arguments);
      const getValues = range.getValues.bind(range);
      range.getValues = function () {
        reads[name]++;
        return getValues();
      };
      return range;
    };
  });
  return reads;
}

test('signed board reads do not write session telemetry and refresh touches it once', () => {
  const c = runtime();
  const account = call(c, 'createAccount', { characterName: 'Read Only' });
  const sessions = c.__sheets[c.AUTH_SHEETS.SESSIONS];
  setCell(sessions, 'LastUsedAt', 2, new Date(0));
  const writes = countColumnWrites(sessions, 'LastUsedAt');

  call(c, 'leaderboard', { token: account.session.token });
  call(c, 'masterSeal', { token: account.session.token });
  assert.equal(writes(), 0);

  call(c, 'refresh', { token: account.session.token, kind: 'member' });
  assert.equal(writes(), 1);
});

test('member refresh reads each auth data table once while preserving active alt context', () => {
  const c = runtime();
  const main = call(c, 'createAccount', { characterName: 'Main Account' });
  const alt = call(c, 'createAccount', { characterName: 'Alt Account' });
  call(c, 'linkAltAccount', { token: main.session.token, backupCode: alt.backupCode });
  call(c, 'switchActiveAccount', { token: main.session.token, memberId: alt.member.memberId });

  const names = [c.AUTH_SHEETS.SESSIONS, c.AUTH_SHEETS.LINKS, c.AUTH_SHEETS.MEMBERS, c.SHEETS.PLAYERS];
  const reads = countTableReads(c.__sheets, names);
  const refreshed = call(c, 'refresh', { token: main.session.token, kind: 'member' });

  assert.equal(refreshed.profile.characterName, 'Alt Account');
  assert.equal(refreshed.accounts.activeMemberId, alt.member.memberId);
  assert.deepEqual(Array.from(refreshed.accounts.accounts, a => a.characterName), ['Main Account', 'Alt Account']);
  names.forEach(function (name) { assert.equal(reads[name], 1, `${name} should be read once`); });
});
