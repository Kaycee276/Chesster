const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isAllowedLicense, evaluateLicenses } = require('./license-policy.cjs');

const project = '/workspace/frontend';
const packageReport = (licenses, path = '/workspace/frontend/node_modules/example') => ({
  'example@1.0.0': { licenses, path },
});

test('accepts exact permitted licenses and valid compound SPDX alternatives', () => {
  for (const license of ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC']) {
    assert.equal(isAllowedLicense(license), true, license);
  }
  assert.equal(isAllowedLicense('(MIT OR Apache-2.0) AND BSD-3-Clause'), true);
  assert.equal(isAllowedLicense('GPL-3.0-only OR MIT'), true);
});

test('rejects disallowed AND obligations and licenses containing a permitted substring', () => {
  for (const license of [
    'GPL-3.0-only', 'AGPL-3.0-only', 'MIT AND GPL-3.0-only', 'NOT-MIT',
    'MIT*', 'UNKNOWN', 'UNLICENSED', '', 'MIT WITH unknown-exception',
  ]) {
    assert.equal(isAllowedLicense(license), false, license);
  }
});

test('rejects malformed expressions even if one OR alternative is permitted', () => {
  for (const license of ['MIT OR', 'MIT OR (', 'MIT OR GPL-3.0-only garbage',
    'MIT OR OR ISC', '(MIT', 'MIT)', 'MIT/ISC', 'MIT OR GPL-3.0-only AND']) {
    assert.equal(isAllowedLicense(license), false, license);
  }
  assert.equal(isAllowedLicense('('.repeat(100) + 'MIT' + ')'.repeat(100)), false);
});

test('fails closed for ambiguous arrays and invalid license metadata', () => {
  assert.equal(isAllowedLicense(['MIT', 'ISC']), true);
  assert.equal(isAllowedLicense(['MIT', 'GPL-3.0-only']), false);
  for (const license of [[], ['MIT', null], null, {}, 42]) {
    assert.equal(isAllowedLicense(license), false);
  }
});

test('reports rejected production dependencies and keeps the complete checked count', () => {
  const report = {
    ...packageReport('MIT'),
    'unsafe@2.0.0': { licenses: 'MIT AND AGPL-3.0-only', path: '/modules/unsafe' },
  };
  const result = evaluateLicenses(report, project, ['example', 'unsafe']);
  assert.equal(result.checked, 2);
  assert.deepEqual(result.rejected, [{ name: 'unsafe@2.0.0', licenses: 'MIT AND AGPL-3.0-only' }]);
  assert.equal(report['unsafe@2.0.0'].licenses, 'MIT AND AGPL-3.0-only');
});

test('excludes only the application itself, not private dependencies or same-name packages', () => {
  const report = {
    'frontend@0.0.0': { licenses: 'UNLICENSED', path: project },
    'frontend@1.0.0': { licenses: 'GPL-3.0-only', path: '/modules/frontend', private: true },
    ...packageReport('ISC'),
  };
  const result = evaluateLicenses(report, project, ['example']);
  assert.equal(result.checked, 2);
  assert.equal(result.rejected[0].name, 'frontend@1.0.0');
});

test('rejects empty, malformed and incomplete inventories instead of passing silently', () => {
  for (const report of [null, [], {}, { error: 'scan failed' }, { 'example@1': null },
    { 'example@1': { licenses: 'MIT' } }]) {
    assert.throws(() => evaluateLicenses(report, project, ['example']));
  }
  assert.throws(() => evaluateLicenses(packageReport('MIT'), project, ['missing']), /missing/);
  assert.throws(() => evaluateLicenses({
    'frontend@0.0.0': { path: project, licenses: 'MIT' },
  }, project, ['example']), /missing/);
});

test('CLI enforces compliant, rejected and invalid reports with distinct exit codes', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chesster-license-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reportFile = path.join(directory, 'licenses.json');
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: 'application', dependencies: { example: '1.0.0' },
  }));
  const run = (report) => {
    fs.writeFileSync(reportFile, JSON.stringify(report));
    return spawnSync(process.execPath, [path.join(__dirname, 'license-policy.cjs'),
      reportFile, directory], { encoding: 'utf8' });
  };
  assert.equal(run(packageReport('MIT')).status, 0);
  const disallowed = run(packageReport('GPL-3.0-only'));
  assert.equal(disallowed.status, 1);
  assert.match(disallowed.stderr, /example@1.0.0/);
  const empty = run({});
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /invalid license inventory/);
  const missing = run({ 'other@1': { licenses: 'ISC', path: '/modules/other' } });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing direct dependencies: example/);
  const usage = spawnSync(process.execPath, [path.join(__dirname, 'license-policy.cjs')],
    { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);
});
