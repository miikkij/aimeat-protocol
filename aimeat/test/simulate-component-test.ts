/**
 * Simulate what the browser test page does for component-company-card.
 * Uses REAL generated code and REAL data from the debug folder.
 * Run: npx tsx test/simulate-component-test.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PROJECT = 'prj-mnisxg4m-todlc';
const COMPONENT = 'component-company-card';
const BASE = `data/debug/generator/${PROJECT}/components`;

// 1. Read the REAL generated cortex code
let cortexCode = '';
try {
  cortexCode = readFileSync(`${BASE}/${COMPONENT}/generated.txt`, 'utf8');
  console.log('✅ Generated cortex code loaded:', cortexCode.length, 'chars');
} catch {
  console.log('❌ No generated.txt found');
  process.exit(1);
}

// Extract the JS from the generated text (may have yaml+js or explanation text)
const jsMatch = cortexCode.match(/```javascript\s*\n([\s\S]*?)```/);
const jsCode = jsMatch ? jsMatch[1] : cortexCode;
console.log('   JS code extracted:', jsCode.length, 'chars');
console.log('   Has IIFE:', jsCode.includes('(function'));
console.log('   LIB_NAME:', jsCode.match(/LIB_NAME\s*=\s*['"]([^'"]+)['"]/)?.[1] || 'NOT FOUND');

// 2. Read the REAL data cortex code
let dataCortexCode = '';
try {
  const raw = readFileSync(`${BASE}/cortex-data/ai-raw-response.txt`, 'utf8');
  const dcJs = raw.match(/```javascript\s*\n([\s\S]*?)```/);
  dataCortexCode = dcJs ? dcJs[1] : '';
  console.log('✅ Data cortex code loaded:', dataCortexCode.length, 'chars');
  console.log('   LIB_NAME:', dataCortexCode.match(/LIB_NAME\s*=\s*['"]([^'"]+)['"]/)?.[1] || 'NOT FOUND');
} catch {
  console.log('❌ No data cortex code found');
}

// 3. Read the REAL test code
let testCode = '';
try {
  testCode = readFileSync(`${BASE}/${COMPONENT}/test-code.js`, 'utf8');
  console.log('✅ Test code loaded:', testCode.length, 'chars');
} catch {
  console.log('❌ No test-code.js found');
}

// 4. Read the component spec to understand what render() expects
let spec: Record<string, unknown> = {};
try {
  spec = JSON.parse(readFileSync(`${BASE}/${COMPONENT}/spec.txt`, 'utf8'));
  console.log('✅ Spec loaded:', spec.name, '- render signature:', (spec.render as Record<string, unknown>)?.signature);
} catch {
  console.log('❌ No spec.txt found');
}

// 5. Read the data cortex spec to understand return shapes
let dcSpec: Record<string, unknown> = {};
try {
  dcSpec = JSON.parse(readFileSync(`${BASE}/cortex-data/spec.txt`, 'utf8'));
  const methods = (dcSpec.methods as Array<Record<string, unknown>>) || [];
  console.log('✅ Data cortex spec loaded:', dcSpec.name, '- methods:', methods.map(m => m.name).join(', '));

  // Show what getCompany returns
  const gc = methods.find(m => m.name === 'getCompany');
  if (gc?.returnsExample) {
    const ex = typeof gc.returnsExample === 'string' ? gc.returnsExample : JSON.stringify(gc.returnsExample);
    console.log('   getCompany returnsExample (first 200):', ex.substring(0, 200));
  }
} catch {
  console.log('❌ No data cortex spec found');
}

console.log('\n' + '═'.repeat(60));
console.log('  LAUNCHING PLAYWRIGHT SIMULATION');
console.log('═'.repeat(60) + '\n');

// 6. Build a standalone HTML page that simulates the test page
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Simulation: ${COMPONENT}</title></head>
<body>
<h1>Simulating: ${COMPONENT}</h1>
<pre id="log"></pre>
<div id="render-area" style="border:2px solid blue; padding:16px; margin:16px 0; min-height:100px;">
  <h3>Component Render Area</h3>
</div>
<div id="result"></div>

<script>
// Simulate AIMEAT namespace
window.AIMEAT = {};
window.AIMEAT.auth = { getSession: function() { return null; } };

// Simulate session.fetch that returns mock data based on the data cortex spec
window.AIMEAT.session = {
  jwt: 'fake',
  async fetch(path, opts) {
    console.log('[session.fetch]', path);
    // Parse the action from the path: /v1/ext/NAME/ACTION
    var parts = path.split('/');
    var action = parts[parts.length - 1];
    var body = opts && opts.body ? JSON.parse(opts.body) : {};

    // Return mock data matching the data cortex spec returnsExamples
    if (action === 'getCompany' || action === 'searchCompanies') {
      // Real PRH-like nested data
      var company = {
        businessId: { value: body.businessId || '3323553-5', registrationDate: '2022-11-07', source: '3' },
        euId: { value: 'FIFPRO.3323553-5', source: '1' },
        names: [{ name: 'Overscale Solutions Oy', type: '1', registrationDate: '2022-11-09', version: 1, source: '1' }],
        mainBusinessLine: { type: '62100', descriptions: [{ languageCode: '1', description: 'Ohjelmistojen suunnittelu' }], typeCodeSet: 'TOIMI4', registrationDate: '2026-01-01', source: '2' },
        companyForms: [{ type: '16', descriptions: [{ languageCode: '1', description: 'Osakeyhtiö' }], registrationDate: '2022-11-09' }],
        addresses: [{ type: 2, street: 'Pohjantie', buildingNumber: '8-10', postCode: '02100', postOffices: [{ city: 'ESPOO', languageCode: '1' }] }],
        registeredEntries: [{ type: '1', descriptions: [{ languageCode: '1', description: 'Rekisterissä' }], registrationDate: '2022-11-09', register: '1', authority: '2' }],
        companySituations: [],
        website: { url: 'www.overscalesolutions.com', registrationDate: '2022-11-07', source: '0' },
        status: '2',
        tradeRegisterStatus: '1',
        registrationDate: '2022-11-09',
        lastModified: '2026-02-03T13:17:42',
        fetchedAt: '2026-04-03T10:00:00Z'
      };
      if (action === 'searchCompanies') {
        return { ok: true, data: { totalResults: 1, companies: [company] } };
      }
      return { ok: true, data: company };
    }
    if (action === 'addToWatchlist') {
      return { ok: true, data: { businessId: body.businessId, companyName: 'Overscale Solutions Oy', addedAt: new Date().toISOString(), lastChecked: new Date().toISOString(), lastSnapshot: {}, unreadChanges: 0 } };
    }
    if (action === 'removeFromWatchlist') return { ok: true, data: true };
    if (action === 'getWatchlist') return { ok: true, data: [] };
    if (action === 'getChangeHistory') return { ok: true, data: [] };
    if (action === 'markChangesRead') return { ok: true, data: true };
    return { ok: true, data: null };
  }
};

// Simulate AIMEAT.data
window.AIMEAT.data = {
  async get(key) { return null; },
  async getPublic(ns, key) { return null; }
};

// Simulate AIMEAT.register
window.AIMEAT.register = function(name, exports) {
  console.log('[AIMEAT.register]', name);
  window.AIMEAT[name] = exports;
};
</script>

<!-- Load data cortex FIRST -->
<script>
${dataCortexCode}
</script>

<!-- Then load component cortex -->
<script>
${jsCode}
</script>

<script>
// Auto-capture any large DOM additions (component renders)
window.__capturedRender = '';
var observer = new MutationObserver(function(mutations) {
  for (var m of mutations) {
    for (var n of m.addedNodes) {
      if (n.nodeType === 1 && n.innerHTML && n.innerHTML.length > 200) {
        window.__capturedRender = n.innerHTML;
      }
    }
  }
});
observer.observe(document.body, { childList: true });

// Test runner
window.__testResults = null;
window.__testRunning = true;
window.__renderSnapshot = null;
(async function() {
  try {
    ${testCode}
  } catch (e) {
    if (!window.__testResults) {
      window.__testResults = { passed: false, errors: ['Test threw: ' + e.message], details: e.stack };
    }
  } finally {
    // Show rendered component snapshot BEFORE clearing
    // Use auto-captured render if manual snapshot wasn't set
    var renderHTML = window.__renderSnapshot || window.__capturedRender || '';
    if (renderHTML) {
      var snapDiv = document.createElement('div');
      snapDiv.id = 'render-snapshot';
      snapDiv.style.border = '2px solid green';
      snapDiv.style.padding = '16px';
      snapDiv.style.margin = '16px 0';
      snapDiv.innerHTML = '<h3>Rendered Component Snapshot</h3>' + renderHTML;
      document.body.appendChild(snapDiv);
    }

    window.__testRunning = false;
    if (!window.__testResults) {
      window.__testResults = { passed: false, errors: ['Test did not complete'] };
    }
    var el = document.getElementById('result');
    if (el && window.__testResults) {
      el.textContent = JSON.stringify(window.__testResults, null, 2);
      el.style.color = window.__testResults.passed ? 'green' : 'red';
    }
  }
})();
</script>
</body></html>`;

// 7. Run in Playwright
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// Listen for console messages
page.on('console', msg => {
  const type = msg.type();
  if (type === 'error') console.log('  [BROWSER ERROR]', msg.text());
  else if (type === 'warn') console.log('  [BROWSER WARN]', msg.text());
  else console.log('  [BROWSER]', msg.text());
});

page.on('pageerror', err => {
  console.log('  [PAGE ERROR]', err.message);
});

// Load the HTML
await page.setContent(html, { waitUntil: 'networkidle' });

// Wait for test to finish
try {
  await page.waitForFunction(() => (window as any).__testRunning === false, { timeout: 10000 });
} catch {
  console.log('⚠️ Test timed out after 10s');
}

// Get results
const results = await page.evaluate(() => (window as any).__testResults);
const snapshot = await page.evaluate(() => (window as any).__renderSnapshot || (window as any).__capturedRender || null);

// Get the actual DOM state — what's in the body?
const bodyHTML = await page.evaluate(() => document.body.innerHTML);
const allDivs = await page.evaluate(() => {
  const divs: Array<{id: string; classes: string; textLen: number; preview: string}> = [];
  document.querySelectorAll('div').forEach(d => {
    divs.push({
      id: d.id || '(no id)',
      classes: d.className || '(no class)',
      textLen: (d.textContent || '').length,
      preview: (d.textContent || '').substring(0, 100)
    });
  });
  return divs;
});

console.log('\n' + '═'.repeat(60));
console.log('  TEST RESULTS');
console.log('═'.repeat(60));
console.log(JSON.stringify(results, null, 2));

console.log('\n' + '═'.repeat(60));
console.log('  RENDER SNAPSHOT');
console.log('═'.repeat(60));
if (snapshot) {
  console.log('Snapshot length:', snapshot.length, 'chars');
  console.log('Preview:', snapshot.substring(0, 300));
} else {
  console.log('❌ No render snapshot captured');
}

console.log('\n' + '═'.repeat(60));
console.log('  DOM STATE — All divs in body');
console.log('═'.repeat(60));
for (const d of allDivs) {
  console.log(`  ${d.id} (${d.classes}) — ${d.textLen} chars — "${d.preview.substring(0, 60)}..."`);
}

// Take screenshot
const screenshotPath = `${BASE}/${COMPONENT}/simulation-screenshot.png`;
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log('\n📸 Screenshot saved to:', screenshotPath);

await browser.close();

// Summary
console.log('\n' + '═'.repeat(60));
if (results?.passed) {
  console.log('  ✅ SIMULATION PASSED');
} else {
  console.log('  ❌ SIMULATION FAILED');
  console.log('  Errors:', results?.errors?.join('; '));
}
console.log('═'.repeat(60));

process.exit(results?.passed ? 0 : 1);
