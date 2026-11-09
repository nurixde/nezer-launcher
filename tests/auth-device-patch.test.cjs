const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/patch-prismarine-auth.cjs');
const fixture = 'async function demo() {\n    this.updateCache(token)\n    return token\n        this.updateCache(token)\n        this.polling = false\n      } catch (e) {\n        console.debug(e)\n      }\n    }\n    this.polling = false\n}\n';

test('Microsoft device poll errors are not silently swallowed', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nezer-auth-'));
  try {
    const filename = path.join(folder, 'LiveTokenManager.js');
    fs.writeFileSync(filename, fixture);
    function patch() {
      return spawnSync(process.execPath, [script], {
        encoding: 'utf8', env: {...process.env, NEZER_PRISMARINE_AUTH_FILE: filename}
      });
    }
    const first = patch();
    assert.equal(first.status, 0, first.stderr);
    const result = fs.readFileSync(filename,'utf8');
    assert.match(result, /throw e/);
    assert.match(result, /await this\.updateCache\(token\)/);
    assert.equal(patch().status, 0, 'patch remains idempotent');
    assert.equal(fs.readFileSync(filename,'utf8'), result);
  } finally {
    fs.rmSync(folder, {recursive:true,force:true});
  }
});
