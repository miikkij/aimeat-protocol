const fs = require('fs');
const f = 'public/views/portal-classic.js';
let c = fs.readFileSync(f, 'utf8');
const before = c;
// Replace t('key', locale) with ct('key')
c = c.replace(/\bt\('([^']+)',\s*locale\)/g, "ct('$1')");
const count = (before.match(/\bt\('[^']+',\s*locale\)/g) || []).length;
fs.writeFileSync(f, c, 'utf8');
console.log('Replaced ' + count + " t(key, locale) calls with ct(key)");
