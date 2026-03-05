// Extract CSS constants from view JS files into external CSS files
const fs = require('fs');
const path = require('path');

const extractions = [
  { file: 'views/portal.js', varName: 'PORTAL_CSS', out: 'css/views/portal.css', scope: '.portal-view' },
  { file: 'views/profile.js', varName: 'PROFILE_CSS', out: 'css/views/profile.css', scope: '.pf' },
  { file: 'views/portal-classic.js', varName: 'CLASSIC_CSS', out: 'css/views/portal-classic.css', scope: '.cl' },
  { file: 'views/portal-dev.js', varName: 'DEV_CSS', out: 'css/views/portal-dev.css', scope: '.dev-portal' },
  { file: 'views/hobbies.js', varName: 'HOBBIES_CSS', out: 'css/views/hobbies.css', scope: '.hb' },
];

const publicDir = path.resolve(__dirname);

for (const { file, varName, out, scope } of extractions) {
  const src = fs.readFileSync(path.join(publicDir, file), 'utf8');
  const marker = `const ${varName} = \``;
  const start = src.indexOf(marker);
  if (start === -1) { console.log(`  SKIP: ${varName} not found in ${file}`); continue; }
  const cssStart = start + marker.length;
  const cssEnd = src.indexOf('`;', cssStart);
  if (cssEnd === -1) { console.log(`  SKIP: closing backtick not found for ${varName}`); continue; }
  const css = src.substring(cssStart, cssEnd).trim();
  const outPath = path.join(publicDir, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `/* ${path.basename(file, '.js')} view — scoped under ${scope} */\n${css}\n`);
  console.log(`  OK: ${out} (${css.length} chars)`);
}

// For views using inline <style> blocks, we need manual extraction
console.log('\nViews with inline <style> blocks need manual extraction:');
for (const name of ['marketplace', 'openclaw', 'aimeat-os', 'guides']) {
  const file = `views/${name}.js`;
  const src = fs.readFileSync(path.join(publicDir, file), 'utf8');
  const styleCount = (src.match(/<style>/g) || []).length;
  console.log(`  ${file}: ${styleCount} <style> blocks`);
}
