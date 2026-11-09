'use strict';
// prismarine-auth 3.1.1 masks failed Microsoft device-token exchanges as a timeout.
// Keep OAuth verification; expose actual failures and await token cache persistence.
const fs = require('node:fs');
const path = require('node:path');
const target = process.env.NEZER_PRISMARINE_AUTH_FILE || path.resolve(__dirname, '../node_modules/prismarine-auth/src/TokenManagers/LiveTokenManager.js');
if (!fs.existsSync(target)) throw new Error('prismarine-auth 3.1.1 is not installed: ' + target);
let code = fs.readFileSync(target, 'utf8');
const patches = [
  ['    this.updateCache(token)\n    return token', '    await this.updateCache(token)\n    return token'],
  ['        this.updateCache(token)\n        this.polling = false', '        await this.updateCache(token)\n        this.polling = false'],
  ['      } catch (e) {\n        console.debug(e)\n      }\n    }\n    this.polling = false',
   '      } catch (e) {\n        // Propagate OAuth/network errors instead of silently waiting until timeout.\n        throw e\n      }\n    }\n    this.polling = false']
];
for (const [before, after] of patches) {
  if (code.includes(after)) continue;
  if (!code.includes(before)) throw new Error('Unsupported prismarine-auth source version; refusing an unsafe patch.');
  code = code.replace(before, after);
}
fs.writeFileSync(target, code, 'utf8');
console.log('[NEZER] Microsoft device login compatibility patch applied.');
