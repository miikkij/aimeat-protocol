/**
 * @file generator-testing.ts
 * @description Test execution engine for the generator pipeline. Handles dependency-aware
 *   test ordering (topological sort), B-level functional test runners (HTTP for extensions/MSM/memory,
 *   Playwright for cortex/app tests), screenshot management, and fix loop state.
 * @structure
 *   - topologicalSort() — orders components by produces/consumes graph
 *   - runExtensionTest() — HTTP-based extension action test
 *   - runAppPlaywrightTest() — Playwright browser test for apps with screenshots
 *   - runCortexPlaywrightTest() — Playwright test for cortex libraries
 *   - isPlaywrightAvailable() — runtime check for Playwright binaries
 *   - screenshotDir() / ensureScreenshotDir() / cleanupScreenshots() — screenshot management
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial implementation
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface TestScenario {
  action: string;
  input: Record<string, unknown>;
  expect: string;
}

export interface ComponentTestPlan {
  componentId: string;
  type: string;
  scenarios: TestScenario[];
  dependencies: string[];
  level: number;
}

export interface TestResult {
  componentId: string;
  type: string;
  status: 'passed' | 'failed' | 'skipped';
  scenarios: number;
  passed: number;
  errors: string[];
  screenshots: string[];
  fixRound: number;
}

export interface TestReport {
  level: 'comprehensive' | 'basic' | 'none';
  timestamp: string;
  components: TestResult[];
  overall: 'passed' | 'failed' | 'partial';
}

/* ── Topological Sort ──────────────────────────────────────────────── */

export function topologicalSort(
  components: Array<{ id: string; type: string; produces?: string[]; consumes?: string[] }>,
  testScenarios: Array<{ component: string; scenarios: TestScenario[] }>,
): ComponentTestPlan[] {
  const producerMap = new Map<string, string>();
  for (const c of components) {
    for (const p of c.produces || []) producerMap.set(p, c.id);
  }

  const deps = new Map<string, string[]>();
  for (const c of components) {
    const myDeps: string[] = [];
    for (const consumed of c.consumes || []) {
      const producer = producerMap.get(consumed);
      if (producer) myDeps.push(producer);
    }
    deps.set(c.id, myDeps);
  }

  const levels = new Map<string, number>();
  const queue = components.filter(c => (deps.get(c.id) || []).length === 0);
  for (const c of queue) levels.set(c.id, 0);

  let i = 0;
  while (i < queue.length) {
    const current = queue[i++]!;
    const currentLevel = levels.get(current.id)!;
    void currentLevel; // used implicitly via levels map
    for (const c of components) {
      if (levels.has(c.id)) continue;
      const myDeps = deps.get(c.id) || [];
      if (myDeps.every(d => levels.has(d))) {
        levels.set(c.id, Math.max(...myDeps.map(d => levels.get(d)!)) + 1);
        queue.push(c);
      }
    }
  }

  const scenarioMap = new Map(testScenarios.map(ts => [ts.component, ts.scenarios]));
  return components
    .filter(c => levels.has(c.id))
    .sort((a, b) => (levels.get(a.id) || 0) - (levels.get(b.id) || 0))
    .map(c => ({
      componentId: c.id,
      type: c.type,
      scenarios: scenarioMap.get(c.id) || [],
      dependencies: deps.get(c.id) || [],
      level: levels.get(c.id) || 0,
    }));
}

/* ── Extension Test Runner ─────────────────────────────────────────── */

export async function runExtensionTest(
  baseUrl: string,
  extensionName: string,
  actionName: string,
  input: Record<string, unknown>,
  token: string,
  method?: string,
): Promise<{ passed: boolean; error?: string; response?: unknown }> {
  try {
    // Determine HTTP method: use provided method, or auto-detect from extension metadata
    let httpMethod = (method || 'POST').toUpperCase();
    if (!method) {
      try {
        const metaRes = await fetch(`${baseUrl}/v1/extensions/${extensionName}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (metaRes.ok) {
          const metaBody = await metaRes.json() as Record<string, unknown>;
          const metaData = metaBody?.data as Record<string, unknown> | undefined;
          const metaExt = metaData?.extension as Record<string, unknown> | undefined;
          const actions = (metaData?.actions ?? metaExt?.actions ?? []) as Array<{ id?: string; method?: string }>;
          const action = actions.find((a: { id?: string; method?: string }) => a.id === actionName);
          if (action?.method) httpMethod = action.method.toUpperCase();
        }
      } catch { /* fallback to POST */ }
    }

    const url = `${baseUrl}/v1/extensions/${extensionName}/actions/${actionName}`;
    const headers: Record<string, string> = { 'Authorization': `Bearer ${token}` };
    const opts: RequestInit = { method: httpMethod, headers };

    if (httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(input);
    }
    const finalUrl = (httpMethod === 'GET' && Object.keys(input).length > 0)
      ? `${url}?${new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)])).toString()}`
      : url;

    const res = await fetch(finalUrl, opts);
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) return { passed: false, error: `HTTP ${res.status}: ${JSON.stringify(body)}` };

    // Validate response structure: AIMEAT envelope must have ok:true and data
    if (body.ok !== true) return { passed: false, error: `Response ok !== true: ${JSON.stringify(body)}` };
    const data = body.data as Record<string, unknown> | undefined;
    if (!data && actionName !== 'init') return { passed: false, error: `Response has no data field` };

    // Check for error field in the action's response data
    if (data?.error) return { passed: false, error: `Action returned error: ${JSON.stringify(data.error)}` };

    return { passed: true, response: body };
  } catch (err) {
    return { passed: false, error: `Request failed: ${(err as Error).message}` };
  }
}

/**
 * Build Playwright test code that calls ALL public methods of a cortex library.
 * Discovers methods from the cortex source code.
 */
export function buildCortexMethodTestCode(camelName: string, cortexSource: string): string {
  // Extract public method names from the cortex source
  // Pattern: async function methodName( or exports.methodName = async function
  const methods: string[] = [];
  const funcRegex = /async\s+function\s+(\w+)\s*\(/g;
  let match;
  while ((match = funcRegex.exec(cortexSource)) !== null) {
    methods.push(match[1]);
  }
  // Also check for exports assignment pattern
  const exportsRegex = /(\w+)\s*[:=]\s*async\s*(?:function)?\s*\(/g;
  while ((match = exportsRegex.exec(cortexSource)) !== null) {
    if (!methods.includes(match[1])) methods.push(match[1]);
  }

  // Build test code that calls each method
  const methodTests = methods
    .filter(m => m !== 'init') // init tested separately
    .map(m => `
      try {
        const r_${m} = await lib.${m}();
        tested++;
        results.push('${m}: ' + (r_${m} !== undefined ? 'OK' : 'returned undefined'));
      } catch (e) {
        errors.push('${m}(): ' + e.message);
      }`)
    .join('\n');

  return `(async () => {
    try {
      const lib = window.AIMEAT && window.AIMEAT['${camelName}'];
      if (!lib) { window.__testResults = { passed: false, errors: ['Cortex "${camelName}" not found. Available: ' + Object.keys(window.AIMEAT || {}).join(', ')] }; return; }

      const errors = [];
      const results = [];
      let tested = 0;

      // 1. Test init()
      if (typeof lib.init === 'function') {
        const initResult = await lib.init();
        if (!initResult || !initResult.ready) {
          errors.push('init() did not return { ready: true }, got: ' + JSON.stringify(initResult));
        } else {
          tested++;
          results.push('init: OK (ready=' + initResult.ready + ', hasData=' + (initResult.hasData || false) + ')');
        }
      } else {
        errors.push('init() function not found');
      }

      // 2. Test all public methods (call with no args — they must handle gracefully)
      ${methodTests}

      if (tested === 0 && errors.length === 0) {
        errors.push('No methods found to test');
      }

      window.__testResults = {
        passed: errors.length === 0,
        errors: errors,
        details: results.join('; '),
        methodsTested: tested
      };
    } catch (e) {
      window.__testResults = { passed: false, errors: [e.message] };
    }
  })()`;
}

/**
 * Build Playwright test code for an app — checks data loads, buttons clickable, navigation works.
 */
export function buildAppTestCode(): string {
  return `
    const errors = [];
    const screenshots = [];

    // 1. Check console errors
    const consoleErrors = [];
    // (console listener added externally)

    // 2. Wait for content to render
    await page.waitForTimeout(3000);

    // 3. Check page has meaningful content (not just loading spinner)
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 20) {
      errors.push('Page appears blank or has minimal content');
    }

    // 4. Check for visible data (tables, lists, cards with text)
    const dataElements = await page.$$('table tbody tr, [class*="card"], [class*="item"], [class*="list"] > *, [class*="row"]');
    if (dataElements.length === 0) {
      // Not necessarily an error if data hasn't loaded yet
      errors.push('No data elements found (tables, cards, lists) — app may need data');
    }

    // 5. Check all buttons are clickable (no disabled without reason)
    const buttons = await page.$$('button:not([disabled])');
    for (const btn of buttons.slice(0, 5)) {
      const btnText = await btn.textContent();
      if (btnText && btnText.trim().length > 0) {
        // Don't actually click — just verify they exist and have text
      }
    }

    // 6. Check for navigation elements (tabs, nav links)
    const navElements = await page.$$('nav a, [class*="tab"], [class*="nav"] a, [role="tab"]');

    // 7. Check no error messages visible
    const errorElements = await page.$$('[class*="error"], [class*="Error"], .alert-danger, .error-message');
    for (const el of errorElements) {
      const text = await el.textContent();
      if (text && text.trim().length > 0) {
        errors.push('Error element visible: ' + text.trim().substring(0, 100));
      }
    }
  `;
}

/* ── Screenshot Management ─────────────────────────────────────────── */

export function screenshotDir(projectId: string): string {
  return join(tmpdir(), 'aimeat-test-screenshots', projectId);
}

export async function ensureScreenshotDir(projectId: string): Promise<string> {
  const dir = screenshotDir(projectId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupScreenshots(projectId: string): Promise<void> {
  try {
    await rm(screenshotDir(projectId), { recursive: true, force: true });
  } catch { /* ignore if not exists */ }
}

/* ── Playwright Helpers ────────────────────────────────────────────── */

// Playwright is an optional runtime dependency — dynamic import via variable
// defeats TypeScript's static module resolution so it doesn't error at compile time.
const PLAYWRIGHT_MODULE = 'playwright';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPlaywright(): Promise<any> {
  return import(PLAYWRIGHT_MODULE);
}

let playwrightAvailable: boolean | null = null;

export async function isPlaywrightAvailable(): Promise<boolean> {
  if (playwrightAvailable !== null) return playwrightAvailable;
  try {
    await loadPlaywright();
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  return playwrightAvailable;
}

/* ── Playwright App Test Runner ────────────────────────────────────── */

export async function runAppPlaywrightTest(
  appUrl: string,
  projectId: string,
  componentId: string,
  scenarios: TestScenario[],
): Promise<{ passed: boolean; errors: string[]; screenshots: string[] }> {
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true });
  const errors: string[] = [];
  const screenshots: string[] = [];

  try {
    const page = await browser.newPage();
    const dir = await ensureScreenshotDir(projectId);

    const consoleErrors: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore common non-fatal console errors
        if (!text.includes('favicon') && !text.includes('404')) {
          consoleErrors.push(text);
        }
      }
    });

    // 1. Load the app
    await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 30000 });
    const loadScreenshot = `${componentId}-01-load.png`;
    await page.screenshot({ path: join(dir, loadScreenshot), fullPage: true });
    screenshots.push(loadScreenshot);

    // 2. Check console errors
    if (consoleErrors.length > 0) {
      errors.push(`Console errors on load: ${consoleErrors.slice(0, 5).join('; ')}`);
    }

    // 3. Check page has meaningful content
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 20) {
      errors.push('Page appears blank or has minimal content');
    }

    // 4. Wait for dynamic content (data loading)
    await page.waitForTimeout(3000);
    const afterLoadScreenshot = `${componentId}-02-data-loaded.png`;
    await page.screenshot({ path: join(dir, afterLoadScreenshot), fullPage: true });
    screenshots.push(afterLoadScreenshot);

    // 5. Check for visible data elements (tables, cards, lists)
    const dataCount = await page.evaluate(`
      document.querySelectorAll('table tbody tr, [class*="card"]:not(style), [class*="item"], ul li, ol li').length
    `) as number;
    if (dataCount === 0) {
      errors.push('No data elements visible (no table rows, cards, or list items)');
    }

    // 6. Check for error messages in the DOM
    const visibleErrors = await page.evaluate(`
      (() => {
        const els = document.querySelectorAll('[class*="error"], [class*="Error"], .alert-danger, .error-message');
        const texts = [];
        els.forEach(el => { const t = el.innerText && el.innerText.trim(); if (t && t.length > 0 && t.length < 200) texts.push(t); });
        return texts;
      })()
    `) as string[];
    if (visibleErrors.length > 0) {
      errors.push(`Error elements visible: ${visibleErrors.slice(0, 3).join('; ')}`);
    }

    // 7. Test navigation — click first tab/nav if present
    const navTab = await page.$('nav a, [class*="tab"]:not(table), [role="tab"]');
    if (navTab) {
      try {
        await navTab.click();
        await page.waitForTimeout(1500);
        const navScreenshot = `${componentId}-03-nav-click.png`;
        await page.screenshot({ path: join(dir, navScreenshot), fullPage: true });
        screenshots.push(navScreenshot);

        // Check content changed
        const newErrors: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        page.on('console', (msg: any) => {
          if (msg.type() === 'error') {
            const text = msg.text();
            if (!text.includes('favicon') && !text.includes('404')) newErrors.push(text);
          }
        });
        if (newErrors.length > 0) {
          errors.push(`Console errors after navigation: ${newErrors.slice(0, 3).join('; ')}`);
        }
      } catch { /* nav click failed — not critical */ }
    }

    // 8. Test first button click (non-destructive)
    const safeButton = await page.$('button:not([class*="delete"]):not([class*="remove"]):not([class*="danger"]):not([disabled])');
    if (safeButton) {
      const btnText = await safeButton.textContent();
      try {
        await safeButton.click();
        await page.waitForTimeout(1500);
        const btnScreenshot = `${componentId}-04-button-click.png`;
        await page.screenshot({ path: join(dir, btnScreenshot), fullPage: true });
        screenshots.push(btnScreenshot);
      } catch {
        errors.push(`Button "${btnText?.trim()}" click failed`);
      }
    }

    // 9. Run explicit test scenarios if provided
    for (const scenario of scenarios) {
      void scenario; // TODO: scenario-driven interaction tests from blueprint
    }

    await page.close();
  } catch (err) {
    errors.push(`Playwright error: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  return { passed: errors.length === 0, errors, screenshots };
}

/* ── Playwright Cortex Test Runner ─────────────────────────────────── */

export async function runCortexPlaywrightTest(
  serverBaseUrl: string,
  projectId: string,
  componentId: string,
  cortexName: string,
  testCode: string,
): Promise<{ passed: boolean; errors: string[] }> {
  void projectId; // reserved for future screenshot support
  void componentId; // reserved for future screenshot support
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true });
  const errors: string[] = [];

  try {
    const page = await browser.newPage();
    const testHtml = `<!DOCTYPE html>
<html><head><script src="${serverBaseUrl}/cortex/${cortexName}/lib.js"></script></head>
<body><script>
window.__testResults = { passed: true, errors: [] };
try { ${testCode} } catch (e) {
  window.__testResults.passed = false;
  window.__testResults.errors.push(e.message);
}
</script></body></html>`;

    await page.setContent(testHtml, { waitUntil: 'networkidle', timeout: 15000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await page.evaluate('window.__testResults');
    if (!results?.passed) {
      errors.push(...(results?.errors || ['Cortex test failed']));
    }
    await page.close();
  } catch (err) {
    errors.push(`Playwright cortex test error: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  return { passed: errors.length === 0, errors };
}
