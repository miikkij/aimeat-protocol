/**
 * @file generator-testing.ts
 * @description Test execution engine for the generator pipeline. AI generates all test code
 *   via the prompt-driven workflow. This file provides only infrastructure:
 *   - topologicalSort() — dependency ordering
 *   - executeHttpTest() — runs AI-generated HTTP test code (extension, MSM, memory)
 *   - executePlaywrightTest() — runs AI-generated Playwright test code (cortex, app)
 *   - Screenshot management
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial implementation
 *   v2.0.0 — 2026-03-21 — Remove all deterministic test logic. Tests are AI-generated
 *     via prompt-driven workflow. This file is infrastructure only.
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
    void currentLevel;
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

/* ── AI-Generated HTTP Test Executor ─────────────────────────────── */

/**
 * Execute AI-generated test code for server-side components (extension, MSM, memory, translation).
 * The AI generates a JavaScript function body that uses `testFetch(url, opts)` to make HTTP calls
 * and returns { passed: boolean, errors: string[], details: string }.
 */
export async function executeHttpTest(
  testCode: string,
  baseUrl: string,
  token: string,
): Promise<{ passed: boolean; errors: string[]; details?: string }> {
  try {
    // Build a sandboxed function that the AI test code can use
    const testFetch = async (url: string, opts?: RequestInit) => {
      const hdrs: Record<string, string> = { ...((opts?.headers as Record<string, string>) || {}), 'Authorization': `Bearer ${token}` };
      if (opts?.body && !hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json';
      // Strip body from GET/HEAD/DELETE requests — Node.js fetch throws "cannot have body"
      // for GET/HEAD, and DELETE with empty body is pointless. AI often generates body: '{}' for all methods.
      const method = (opts?.method || 'GET').toUpperCase();
      const fetchOpts = { ...opts, headers: hdrs };
      if ((method === 'GET' || method === 'HEAD' || method === 'DELETE') && fetchOpts.body) {
        delete fetchOpts.body;
      }
      const res = await fetch(url.startsWith('/') ? `${baseUrl}${url}` : url, fetchOpts);
      const body = await res.json();
      return { status: res.status, ok: res.ok, body };
    };

    type TestFetchFn = (url: string, opts?: RequestInit) => Promise<{ status: number; ok: boolean; body: unknown }>;
    // Execute the AI-generated test code
    const testFn = new Function('testFetch', 'baseUrl', `return (async () => { ${testCode} })()`) as
      (testFetch: TestFetchFn, baseUrl: string) => Promise<{ passed: boolean; errors: string[]; details?: string }>;

    const result = await testFn(testFetch, baseUrl);
    return {
      passed: result?.passed ?? false,
      errors: result?.errors ?? ['Test returned no result'],
      details: result?.details,
    };
  } catch (err) {
    return { passed: false, errors: [`Test execution error: ${(err as Error).message}`] };
  }
}

/* ── AI-Generated Playwright Test Executor ───────────────────────── */

/**
 * Execute AI-generated Playwright test code for client-side components (cortex, app).
 * The AI generates JavaScript that runs in the browser context.
 * For apps: navigates to URL, interacts with page, takes screenshots.
 * For cortex: loads cortex lib, calls methods, verifies results.
 */
export async function executePlaywrightTest(
  testCode: string,
  projectId: string,
  componentId: string,
  targetUrl: string,
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
        if (!text.includes('favicon')) consoleErrors.push(text);
      }
    });

    // Navigate to target
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Take initial screenshot
    const initScreenshot = `${componentId}-01-load.png`;
    await page.screenshot({ path: join(dir, initScreenshot), fullPage: true });
    screenshots.push(initScreenshot);

    // Execute AI-generated test code in the page context
    // The test code sets window.__testResults = { passed, errors, details }
    const wrappedCode = `
      window.__testResults = { passed: false, errors: ['Test did not complete'] };
      try {
        ${testCode}
      } catch (e) {
        window.__testResults = { passed: false, errors: ['Test threw: ' + e.message] };
      }
    `;
    await page.evaluate(wrappedCode);

    // Wait for async operations
    await page.waitForTimeout(3000);

    // Take post-test screenshot
    const finalScreenshot = `${componentId}-02-tested.png`;
    await page.screenshot({ path: join(dir, finalScreenshot), fullPage: true });
    screenshots.push(finalScreenshot);

    // Collect results
    const results = await page.evaluate('window.__testResults') as { passed?: boolean; errors?: string[]; details?: string } | null;

    if (consoleErrors.length > 0) {
      errors.push(`Console errors: ${consoleErrors.slice(0, 5).join('; ')}`);
    }

    if (results) {
      if (!results.passed) {
        errors.push(...(results.errors || ['Test failed']));
      }
    } else {
      errors.push('Test did not set window.__testResults');
    }

    await page.close();
  } catch (err) {
    errors.push(`Playwright error: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  return { passed: errors.length === 0, errors, screenshots };
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

const PLAYWRIGHT_MODULE = '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPlaywright(): Promise<any> {
  return import(PLAYWRIGHT_MODULE);
}

export async function isPlaywrightAvailable(): Promise<boolean> {
  // Check every time — don't cache, playwright may be installed after server start
  try {
    await loadPlaywright();
    return true;
  } catch {
    return false;
  }
}
