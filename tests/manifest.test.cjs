const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Transform the pure helpers for the Node test runner without third-party dependencies.
const source = fs.readFileSync(path.resolve(__dirname, '../electron/manifest.ts'), 'utf8')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  .replace(/: string\b/g, '')
  .replace(/: number \| null/g, '')
  .replace(/: number\b/g, '');
const helpers = new Function(source + '\nreturn { safeVersionId, javaRequirement, parseJavaMajor };')();

test('blocks traversal in version IDs', () => {
  assert.throws(() => helpers.safeVersionId('../escape'));
  assert.throws(() => helpers.safeVersionId('1.21/../../evil'));
  assert.equal(helpers.safeVersionId('1.21.4'), '1.21.4');
});

test('picks Java required by vanilla versions', () => {
  assert.equal(helpers.javaRequirement('1.8.9'), 8);
  assert.equal(helpers.javaRequirement('1.17.1'), 16);
  assert.equal(helpers.javaRequirement('1.19.4'), 17);
  assert.equal(helpers.javaRequirement('1.20.5'), 21);
  assert.equal(helpers.javaRequirement('1.21.10'), 21);
  assert.equal(helpers.javaRequirement('26.1'), 25);
});

test('parses Java version output', () => {
  assert.equal(helpers.parseJavaMajor('java version "1.8.0_361"'), 8);
  assert.equal(helpers.parseJavaMajor('openjdk version "21.0.2"'), 21);
  assert.equal(helpers.parseJavaMajor('openjdk 25 2025-09-16'), 25);
});
