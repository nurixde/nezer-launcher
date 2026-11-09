const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'auth-errors.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleObject = { exports: {} };
new Function('module', 'exports', code)(moduleObject, moduleObject.exports);
const { friendlyAuthError } = moduleObject.exports;

test('timeout during Microsoft sign-in recommends a new code', () => {
  const message = friendlyAuthError(new Error('Authentication failed, timed out'), 'microsoft');
  assert.match(message, /НОВЫЙ код/);
  assert.match(message, /Microsoft/);
});

test('Xbox timeout is not misreported as invalid device code', () => {
  const message = friendlyAuthError(new Error('Authentication failed, timed out'), 'minecraft');
  assert.match(message, /Xbox\/Minecraft/);
  assert.doesNotMatch(message, /НОВЫЙ код/);
});

test('errors remain actionable and no auth credentials are added to logs', () => {
  assert.match(friendlyAuthError(new Error('fetch failed'), 'microsoft'), /интернет/);
  assert.match(friendlyAuthError(new Error('403 Forbidden'), 'minecraft'), /403 Forbidden/);
});

test('new interactive flow skips stale authentication caches', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.ts'), 'utf8');
  assert.match(mainSource, /forceRefresh: freshLogin/);
  assert.match(mainSource, /\}, interactive\);/);
});
