/**
 * Simulate component test with CORRECT test code (manual, not LLM-generated)
 * This tests what the component ACTUALLY does, with proper async waiting.
 * Run: npx tsx test/simulate-component-test-fixed.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PROJECT = 'prj-mnisxg4m-todlc';
const BASE = `data/debug/generator/${PROJECT}/components`;

// Read real generated code
const cortexRaw = readFileSync(`${BASE}/component-company-card/generated.txt`, 'utf8');
const jsMatch = cortexRaw.match(/```javascript\s*\n([\s\S]*?)```/);
const componentCode = jsMatch ? jsMatch[1] : '';

const dcRaw = readFileSync(`${BASE}/cortex-data/ai-raw-response.txt`, 'utf8');
const dcJs = dcRaw.match(/```javascript\s*\n([\s\S]*?)```/);
const dataCortexCode = dcJs ? dcJs[1] : '';

console.log('Component code:', componentCode.length, 'chars');
console.log('Data cortex code:', dataCortexCode.length, 'chars');

// CORRECT test code — with async wait and proper field paths
const correctTestCode = `
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; console.log(msg); };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

const lib = window.AIMEAT.yrityskortti;
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }
if (typeof lib.render !== 'function') { fail('render not a function'); window.__testResults = results; return; }
pass('Component library loaded');

// Create container
const container = document.createElement('div');
container.id = 'test-container';
document.body.appendChild(container);

// Call render with businessId prop (component fetches data internally)
log('Calling render...');
const result = lib.render(container, {
  businessId: '3323553-5',
  locale: 'fi',
  translations: {
    'app.loading': 'Ladataan...',
    'app.company.title': 'Yrityskortti',
    'app.error': 'Virhe',
    'app.refresh': 'Päivitä',
    'app.close': 'Sulje',
    'app.watchlist.add': 'Lisää seurantaan',
    'app.watchlist.remove': 'Poista seurannasta',
    'app.watchlist.lastUpdated': 'Viimeksi päivitetty'
  },
  onSelect: (id) => log('onSelect: ' + id),
  onWatchlistToggle: (id, val) => log('onWatchlistToggle: ' + id + ' ' + val)
});

log('render returned: ' + (result ? 'object with keys: ' + Object.keys(result).join(',') : 'null'));

// CRITICAL: WAIT for async data to load and populate the DOM
log('Waiting 3 seconds for async render...');
await new Promise(r => setTimeout(r, 3000));

// Now check DOM
const html = container.innerHTML;
const text = container.textContent || '';
log('After wait — HTML length: ' + html.length);
log('After wait — text length: ' + text.length);
log('After wait — text preview: ' + text.substring(0, 300));

// Check if company data rendered
if (text.includes('Overscale Solutions Oy')) pass('Company name rendered');
else if (text.includes('3323553-5')) pass('Business ID rendered (name may use different path)');
else if (text.length > 100) pass('Substantial text content (' + text.length + ' chars) — component rendered something');
else fail('No meaningful content rendered after 3s wait');

// Check buttons
const buttons = container.querySelectorAll('button');
log('Buttons found: ' + buttons.length);
if (buttons.length > 0) pass('Has ' + buttons.length + ' button(s)');
else fail('No buttons rendered');

// Capture snapshot
window.__renderSnapshot = container.innerHTML;

// Final
if (results.errors.length === 0) results.passed = true;
window.__testResults = results;
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Fixed Simulation</title></head>
<body>
<h1>Fixed Component Test</h1>
<div id="render-area" style="border:2px solid blue;padding:16px;margin:16px 0;min-height:100px">
  <h3>Component Render Area</h3>
</div>
<div id="result"></div>

<script>
window.AIMEAT = {};
window.AIMEAT.auth = { getSession: function() { return null; } };
window.AIMEAT.session = {
  jwt: 'fake',
  async fetch(path, opts) {
    console.log('[fetch]', path);
    var parts = path.split('/');
    var action = parts[parts.length - 1];
    var body = opts && opts.body ? JSON.parse(opts.body) : {};
    var company = {
      businessId: { value: body.businessId || '3323553-5', registrationDate: '2022-11-07', source: '3' },
      euId: { value: 'FIFPRO.3323553-5', source: '1' },
      names: [{ name: 'Overscale Solutions Oy', type: '1', registrationDate: '2022-11-09', version: 1, source: '1' }],
      mainBusinessLine: { type: '62100', descriptions: [{ languageCode: '1', description: 'Ohjelmistojen suunnittelu' }] },
      companyForms: [{ type: '16', descriptions: [{ languageCode: '1', description: 'Osakeyhtiö' }] }],
      addresses: [{ type: 2, street: 'Pohjantie', buildingNumber: '8-10', postCode: '02100', postOffices: [{ city: 'ESPOO' }] }],
      registeredEntries: [{ type: '1', descriptions: [{ languageCode: '1', description: 'Rekisterissä' }] }],
      companySituations: [],
      website: { url: 'www.overscalesolutions.com' },
      status: '2', tradeRegisterStatus: '1', registrationDate: '2022-11-09',
      lastModified: '2026-02-03T13:17:42', fetchedAt: '2026-04-03T10:00:00Z'
    };
    if (action === 'searchCompanies') return { ok: true, data: { totalResults: 1, companies: [company] } };
    if (action === 'getCompany') return { ok: true, data: company };
    if (action === 'addToWatchlist') return { ok: true, data: { businessId: body.businessId, companyName: 'Overscale Solutions Oy', addedAt: new Date().toISOString(), lastChecked: new Date().toISOString(), lastSnapshot: company, unreadChanges: 0 } };
    if (action === 'removeFromWatchlist') return { ok: true, data: true };
    if (action === 'getWatchlist') return { ok: true, data: [] };
    if (action === 'getChangeHistory') return { ok: true, data: [] };
    if (action === 'markChangesRead') return { ok: true, data: true };
    return { ok: true, data: null };
  }
};
window.AIMEAT.data = { async get(key) { return null; }, async getPublic(ns, key) { return null; } };
window.AIMEAT.register = function(name, exports) { console.log('[register]', name); window.AIMEAT[name] = exports; };
</script>

<script>${dataCortexCode}</script>
<script>${componentCode}</script>

<script>
window.__testResults = null;
window.__testRunning = true;
window.__renderSnapshot = null;
(async function() {
  try {
    ${correctTestCode}
  } catch (e) {
    console.error('Test error:', e);
    if (!window.__testResults) window.__testResults = { passed: false, errors: ['Test threw: ' + e.message] };
  } finally {
    if (window.__renderSnapshot) {
      var snap = document.createElement('div');
      snap.id = 'render-snapshot';
      snap.style.border = '2px solid green';
      snap.style.padding = '16px';
      snap.style.margin = '16px 0';
      snap.innerHTML = '<h3 style="color:green">Rendered Component Snapshot</h3>' + window.__renderSnapshot;
      document.body.appendChild(snap);
    }
    window.__testRunning = false;
    if (!window.__testResults) window.__testResults = { passed: false, errors: ['Test did not complete'] };
    var el = document.getElementById('result');
    if (el) { el.textContent = JSON.stringify(window.__testResults, null, 2); el.style.color = window.__testResults.passed ? 'green' : 'red'; }
  }
})();
</script>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on('console', msg => console.log(`  [${msg.type().toUpperCase()}]`, msg.text()));
page.on('pageerror', err => console.log('  [PAGE ERROR]', err.message));

await page.setContent(html, { waitUntil: 'networkidle' });

try {
  await page.waitForFunction(() => (window as any).__testRunning === false, { timeout: 15000 });
} catch {
  console.log('⚠️ Test timed out');
}

const results = await page.evaluate(() => (window as any).__testResults);
console.log('\n' + '═'.repeat(60));
console.log('  RESULTS');
console.log('═'.repeat(60));
console.log(JSON.stringify(results, null, 2));

await page.screenshot({ path: `${BASE}/component-company-card/simulation-fixed-screenshot.png`, fullPage: true });
console.log('\n📸 Screenshot saved');

await browser.close();
console.log(results?.passed ? '\n✅ PASSED' : '\n❌ FAILED');
process.exit(results?.passed ? 0 : 1);
