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
      // Fetch extension metadata to find the correct method for this action
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
    // For GET requests, input goes as query params (if any)
    const finalUrl = (httpMethod === 'GET' && Object.keys(input).length > 0)
      ? `${url}?${new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)])).toString()}`
      : url;

    const res = await fetch(finalUrl, opts);
    const body = await res.json();
    if (!res.ok) return { passed: false, error: `HTTP ${res.status}: ${JSON.stringify(body)}` };
    return { passed: true, response: body };
  } catch (err) {
    return { passed: false, error: `Request failed: ${(err as Error).message}` };
  }
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
  void scenarios; // reserved for future scenario-driven browser interaction
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
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 30000 });
    const loadScreenshot = `${componentId}-load.png`;
    await page.screenshot({ path: join(dir, loadScreenshot), fullPage: true });
    screenshots.push(loadScreenshot);

    if (consoleErrors.length > 0) {
      errors.push(`Console errors on load: ${consoleErrors.join('; ')}`);
    }

    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.trim().length < 10) {
      errors.push('Page appears blank or has minimal content');
    }

    const finalScreenshot = `${componentId}-final.png`;
    await page.screenshot({ path: join(dir, finalScreenshot), fullPage: true });
    screenshots.push(finalScreenshot);

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
