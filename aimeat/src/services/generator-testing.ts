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
 *   v2.1.0 — 2026-03-24 — Add diagnostic trace for callExt/readExtMemory
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

export interface TraceEntry {
  fn: string;
  args: string;
  result: string;
  status: number;
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
  trace?: TraceEntry[];
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
): Promise<{ passed: boolean; errors: string[]; details?: string; trace?: TraceEntry[] }> {
  // Diagnostic trace — records every helper call with input/output
  const trace: TraceEntry[] = [];
  const trunc = (v: unknown, max = 500): string => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s && s.length > max ? s.slice(0, max) + '…' : (s ?? 'null');
  };

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

    // Cortex-style helpers — same interface cortex uses to consume extensions
    const callExt = async (extName: string, actionId: string, body: Record<string, unknown> = {}) => {
      const resp = await testFetch(`/v1/ext/${extName}/${actionId}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      // Return the action's actual data (unwrap AIMEAT envelope)
      const b = resp.body as Record<string, unknown> | null;
      const result = (b as any)?.data ?? null;
      trace.push({ fn: 'callExt', args: `${extName}/${actionId}(${trunc(body, 200)})`, result: trunc(result), status: resp.status });
      return result;
    };

    const readExtMemory = async (extName: string, key: string) => {
      const resp = await testFetch(`/v1/memory/ext:${extName}/${key}`, { method: 'GET' });
      const b = resp.body as Record<string, unknown> | null;
      let result: unknown = null;
      if (resp.ok && (b as any)?.data?.value !== undefined) result = (b as any).data.value;
      else if (resp.ok && (b as any)?.data !== undefined) result = (b as any).data;
      trace.push({ fn: 'readExtMemory', args: `${extName}/${key}`, result: trunc(result), status: resp.status });
      return result;
    };

    type TestFetchFn = (url: string, opts?: RequestInit) => Promise<{ status: number; ok: boolean; body: unknown }>;
    type CallExtFn = (extName: string, actionId: string, body?: Record<string, unknown>) => Promise<unknown>;
    type ReadExtMemoryFn = (extName: string, key: string) => Promise<unknown>;
    // Execute the AI-generated test code — provides testFetch + callExt + readExtMemory
    const testFn = new Function('testFetch', 'baseUrl', 'callExt', 'readExtMemory', `return (async () => { ${testCode} })()`) as
      (testFetch: TestFetchFn, baseUrl: string, callExt: CallExtFn, readExtMemory: ReadExtMemoryFn) => Promise<{ passed: boolean; errors: string[]; details?: string }>;

    const result = await testFn(testFetch, baseUrl, callExt, readExtMemory);
    return {
      passed: result?.passed ?? false,
      errors: result?.errors ?? ['Test returned no result'],
      details: result?.details,
      trace,
    };
  } catch (err) {
    return { passed: false, errors: [`Test execution error: ${(err as Error).message}`], trace };
  }
}

/* ── AI-Generated Playwright Test Executor ───────────────────────── */

/**
 * Execute AI-generated Playwright test code for client-side components (cortex, app).
 * The AI generates JavaScript that runs in the browser context.
 * For apps: navigates to URL, interacts with page, takes screenshots.
 * For cortex: loads cortex lib, calls methods, verifies results.
 */
/**
 * Execute a browser test by navigating to a test page URL.
 * For cortex/app tests, the server provides a self-contained test page at
 * GET /v1/generator/test-page/:projectId/:componentId that includes auth,
 * library scripts, and test code — Playwright just navigates and reads results.
 *
 * For app tests, navigates to the app URL and injects test code via addScriptTag.
 */
export async function executePlaywrightTest(
  _testCode: string,
  projectId: string,
  componentId: string,
  targetUrl: string,
  _preScripts: string[] = [],
  authToken?: string,
  _serverPort?: number,
): Promise<{ passed: boolean; errors: string[]; screenshots: string[] }> {
  let pw;
  let browser;
  try {
    pw = await loadPlaywright();
    browser = await pw.chromium.launch({ headless: true });
  } catch (err) {
    return { passed: false, errors: [`Playwright not available: ${(err as Error).message?.split('\n')[0]}`], screenshots: [] };
  }
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

    // Set auth header for all requests so the test page can be loaded
    if (authToken) {
      await page.setExtraHTTPHeaders({ 'Authorization': `Bearer ${authToken}` });
    }

    // Navigate to the target URL (test page for cortex, app URL for apps)
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Take initial screenshot
    const initScreenshot = `${componentId}-01-load.png`;
    await page.screenshot({ path: join(dir, initScreenshot), fullPage: true });
    screenshots.push(initScreenshot);

    // Wait for test to finish — the test page sets window.__testRunning = false when done
    try {
      await page.waitForFunction('window.__testRunning === false', { timeout: 60000 });
    } catch {
      // Timeout — test took too long
    }

    // Take post-test screenshot
    const finalScreenshot = `${componentId}-02-tested.png`;
    await page.screenshot({ path: join(dir, finalScreenshot), fullPage: true });
    screenshots.push(finalScreenshot);

    // Collect results from window.__testResults
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
