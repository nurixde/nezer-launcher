const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'microsoft-client.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
}).outputText;
const moduleObject = { exports: {} };
new Function('module', 'exports', output)(moduleObject, moduleObject.exports);
const {normalizeMicrosoftClientId, normalizeDeviceCode} = moduleObject.exports;

test('only valid public Microsoft client IDs are accepted', () => {
  assert.equal(normalizeMicrosoftClientId('12345678-1234-ABCD-1234-abcdefabcdef'), '12345678-1234-abcd-1234-abcdefabcdef');
  assert.equal(normalizeMicrosoftClientId(' '), '');
  assert.throws(() => normalizeMicrosoftClientId('not-an-app-id'), /UUID/);
  assert.throws(() => normalizeMicrosoftClientId(123), /строкой/);
});

test('legacy Live/SISU device code response is understood', () => {
  const result = normalizeDeviceCode({
    user_code: 'ABCD-EFGH',
    verification_uri: 'https://www.microsoft.com/link',
    expires_in: 900
  }, 1000);
  assert.equal(result.userCode, 'ABCD-EFGH');
  assert.equal(result.expiresAt, 901000);
});

test('new MSAL device code response is understood', () => {
  const expiresOn = new Date('2026-11-10T12:30:00.000Z');
  const result = normalizeDeviceCode({
    userCode: 'EFGH-JKLM',
    verificationUri: 'https://microsoft.com/link',
    expiresOn
  }, 1000);
  assert.equal(result.userCode, 'EFGH-JKLM');
  assert.equal(result.expiresAt, expiresOn.getTime());
});

test('unrecognized verification URLs are refused', () => {
  assert.equal(normalizeDeviceCode({userCode:'ABCD',verificationUri:'https://evil.example/login'}), null);
  assert.equal(normalizeDeviceCode({userCode:'ABCD',verificationUri:'javascript:alert(1)'}), null);
  assert.equal(normalizeDeviceCode(null), null);
});

test('MSAL uses a distinct cache namespace from legacy SISU', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.ts'), 'utf8');
  assert.match(s, /flow: 'msal', authTitle: clientId/);
  assert.match(s, /nezer-msal-/);
});
