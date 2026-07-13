/**
 * @file src/routes/foundry/testing.ts
 * @description Foundry test-execution routes: per-component test runner, debug-artifact writer, apply-settings, extension probe, legacy bulk-test stub, screenshot serving, and the self-contained browser test page. Extracted from src/routes/foundry.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/foundry.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { executeHttpTest, executePlaywrightTest, isPlaywrightAvailable, ensureScreenshotDir, screenshotDir } from '../../services/foundry-testing.js';
import type { TestReport, TestResult } from '../../services/foundry-testing.js';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { FoundryDebugWriter } from '../../services/foundry-debug.js';

export function registerTestingRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  // POST /v1/foundry/:projectId/test/:componentId — execute AI-generated test code
  // NOTE: registered before bulk test and /:projectId/components/:componentId
  // SECURITY (H-7): testCode runs via `new Function` in the host Node process
  // (and/or a CSP-bypassed Playwright browser) with NO sandbox — i.e. RCE as the
  // caller. Restricted to operator: on a single-operator node this is the same
  // person who already controls the host; on a multi-owner node it prevents a
  // regular owner from escalating past their data scope to host/secrets.
  router.post('/v1/foundry/:projectId/test/:componentId',
    requireAuth(),
    requireRole('operator'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { testCode, environment } = req.body ?? {};

      if (!testCode) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'testCode is required — AI must generate the test code first'));
        return;
      }

      // Load component record for metadata
      const compRec = await storage.getMemory(gaii, `foundry.${projectId}.component.${componentId}`);
      const compVal = (compRec?.value as Record<string, unknown>) ?? {};
      const compType = (compVal.type as string) || 'unknown';

      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      const baseUrl = `http://localhost:${config.port}`;

      let result: TestResult;

      // Determine execution environment: browser (Playwright) or server (HTTP)
      const env = (environment as string) || (compType === 'cortex' || compType === 'app' ? 'browser' : 'server');

      if (env === 'browser') {
        // Browser test — execute AI-generated code in Playwright
        if (!await isPlaywrightAvailable()) {
          result = { componentId, type: compType, status: 'skipped', scenarios: 0, passed: 0, errors: ['Playwright not available'], screenshots: [], fixRound: 0 };
        } else {
          // All browser tests use the self-contained test page
          // It includes auth, library scripts, and test code — Playwright just navigates and reads results
          const targetUrl = `${baseUrl}/v1/foundry/test-page/${projectId}/${componentId}`;

          await ensureScreenshotDir(projectId);
          const pwResult = await executePlaywrightTest(testCode as string, projectId, componentId, targetUrl, [], token);
          result = { componentId, type: compType, status: pwResult.passed ? 'passed' : 'failed', scenarios: 1, passed: pwResult.passed ? 1 : 0, errors: pwResult.errors, screenshots: pwResult.screenshots, fixRound: 0 };
        }
      } else {
        // Server test — execute AI-generated code with testFetch helper
        const httpResult = await executeHttpTest(testCode as string, baseUrl, token);
        result = { componentId, type: compType, status: httpResult.passed ? 'passed' : 'failed', scenarios: 1, passed: httpResult.passed ? 1 : 0, errors: httpResult.errors, screenshots: [], fixRound: 0, trace: httpResult.trace };
      }

      // Debug: write test artifacts to disk and log to terminal
      const debugWriter = new FoundryDebugWriter(projectId);
      const compLabel = (compVal.label as string) || componentId;
      await debugWriter.writeTestCode(componentId, testCode as string);
      await debugWriter.writeTestResult(componentId, result as unknown as Record<string, unknown>);
      await debugWriter.appendLog({
        event: 'test_executed',
        componentId,
        componentLabel: compLabel,
        type: compType,
        environment: env,
        status: result.status,
        errors: result.errors,
        passed: result.passed,
        scenarios: result.scenarios,
      });

      // Terminal output — clear summary of what happened
      const statusIcon = result.status === 'passed' ? '\u2705' : result.status === 'failed' ? '\u274C' : '\u23ED';
      logger.info(`[foundry-test] ${statusIcon} ${compLabel} (${compType}): ${result.status}${result.errors.length > 0 ? ' — ' + result.errors.length + ' errors' : ''}`, {
        projectId, componentId, environment: env, errors: result.errors.slice(0, 3),
      });
      // Log trace for failed tests — shows every callExt/readExtMemory call with results
      if (result.status === 'failed' && result.trace && result.trace.length > 0) {
        for (const t of result.trace) {
          logger.info(`[foundry-test]   ${t.fn}(${t.args}) → [${t.status}] ${t.result}`);
        }
      }

      res.json(success(config.nodeId, { result }));
    }
  );

  // POST /v1/foundry/:projectId/debug/:componentId — write debug artifact to disk
  router.post('/v1/foundry/:projectId/debug/:componentId',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const { phase, content } = req.body ?? {};

      if (!phase || !content) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'phase and content are required'));
        return;
      }

      const debugWriter = new FoundryDebugWriter(projectId);
      const phases: Record<string, () => Promise<void>> = {
        'prompt': () => debugWriter.writeComponentPrompt(componentId, content as string),
        'generated': () => debugWriter.writeComponentGenerated(componentId, content as string),
        'validation': () => debugWriter.writeValidation(componentId, content as Record<string, unknown>),
        'test-prompt': () => debugWriter.writeTestPrompt(componentId, content as string),
        'test-code': () => debugWriter.writeTestCode(componentId, content as string),
        'test-result': () => debugWriter.writeTestResult(componentId, content as Record<string, unknown>),
        'project-meta': () => debugWriter.writeProjectMeta(
          (content as Record<string, unknown>).project as Record<string, unknown>,
          (content as Record<string, unknown>).interviewSpec,
          (content as Record<string, unknown>).blueprint,
        ),
      };

      const handler = phases[phase as string];
      if (handler) {
        await handler();
      } else {
        // Generic fallback — write any phase as a text artifact
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        await debugWriter.writeArtifact(componentId, phase as string, text);
      }
      await debugWriter.appendLog({ event: `debug_${phase}`, componentId, timestamp: new Date().toISOString() });
      res.json(success(config.nodeId, { written: true, phase, componentId }));
    }
  );

  // POST /v1/foundry/:projectId/apply-settings/:extensionName — inject project settings into extension config
  // Reads settings from foundry.{projectId}.settings and merges them into the extension's config object.
  // This bridges blueprint settings (collected from user) to the extension's runtime config (ctx.config).
  router.post('/v1/foundry/:projectId/apply-settings/:extensionName',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const extensionName = req.params['extensionName'] as string;

      // Load project settings
      const settingsRec = await storage.getMemory(gaii, `foundry.${projectId}.settings`);
      const settings = (settingsRec?.value as Record<string, unknown>) ?? {};

      // Debug: log what we found
      const settingsKeys = Object.keys(settings);
      const settingsDebug = settingsKeys.map(k => {
        const v = settings[k];
        if (typeof v === 'string' && v.startsWith('enc:')) return `${k}: [encrypted ${v.length} chars]`;
        if (typeof v === 'string') return `${k}: "${v.slice(0, 3)}...[${v.length} chars]"`;
        return `${k}: ${JSON.stringify(v)}`;
      });
      logger.info(`apply-settings: found ${settingsKeys.length} settings for project ${projectId}`, { keys: settingsDebug });

      if (settingsKeys.length === 0) {
        res.json(success(config.nodeId, { applied: 0, message: 'No settings to apply', debug: { settingsRecordExists: !!settingsRec } }));
        return;
      }

      // Load extension
      const ext = await storage.getExtension(extensionName);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${extensionName}" not found`));
        return;
      }

      logger.info(`apply-settings: extension ${extensionName} current config keys: ${Object.keys(ext.config).join(', ')}`);

      // Pass values through as-is (no encryption/decryption)
      const decrypted = { ...settings };
      const decryptLog = Object.keys(settings).map(k => {
        const v = settings[k];
        return `${k}: ${typeof v === 'string' ? v.length + ' chars' : typeof v}`;
      });

      logger.info(`apply-settings: decrypt results`, { results: decryptLog });

      // Merge settings into extension config (preserving __schedules and other internal keys)
      const newConfig = { ...ext.config, ...decrypted };
      await storage.updateExtension(extensionName, { config: newConfig });

      // Log final state (masked)
      const finalKeys = Object.keys(newConfig).filter(k => !k.startsWith('__'));
      const finalDebug = finalKeys.map(k => {
        const v = newConfig[k];
        if (typeof v === 'string' && v.length > 3) return `${k}: "${v.slice(0, 3)}..."`;
        return `${k}: ${JSON.stringify(v)}`;
      });
      logger.info(`apply-settings: extension ${extensionName} config updated`, { configKeys: finalDebug });

      res.json(success(config.nodeId, { applied: Object.keys(decrypted).length, keys: Object.keys(decrypted), decryptLog }));
    }
  );

  // POST /v1/foundry/:projectId/probe-extension — call extension actions with test params, capture real responses
  // Used by autopilot to get actual API response shapes for injection into cortex/app prompts.
  router.post('/v1/foundry/:projectId/probe-extension',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const { extensionName, scenarios } = req.body as {
        extensionName?: string;
        scenarios?: Array<{ action: string; input: Record<string, unknown> }>;
      };

      if (!extensionName || !scenarios || !Array.isArray(scenarios)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'extensionName and scenarios[] required.'));
      }

      // Verify project ownership
      const projectRecord = await storage.getMemory(gaii, `foundry.${projectId}.project`);
      if (!projectRecord) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found.'));
      }

      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      const baseUrl = `http://localhost:${config.port}`;
      const results: Array<{ action: string; input: Record<string, unknown>; status: number; response: unknown }> = [];

      for (const scenario of scenarios) {
        try {
          const resp = await fetch(`${baseUrl}/v1/ext/${encodeURIComponent(extensionName)}/${encodeURIComponent(scenario.action)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(scenario.input || {}),
          });
          const body = await resp.json() as Record<string, unknown>;
          results.push({
            action: scenario.action,
            input: scenario.input || {},
            status: resp.status,
            response: (body as { data?: unknown }).data ?? body,
          });
        } catch (e) {
          results.push({
            action: scenario.action,
            input: scenario.input || {},
            status: 500,
            response: { error: (e as Error).message },
          });
        }
      }

      logger.info('[foundry] Extension probe complete', { extensionName, probed: results.length, projectId });

      res.json(success(config.nodeId, { extensionName, results }));
    },
  );

  // POST /v1/foundry/:projectId/test — legacy bulk test endpoint
  // Tests are now per-component via AI-generated code. This endpoint returns a stub.
  router.post('/v1/foundry/:projectId/test',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const report: TestReport = {
        level: 'none',
        timestamp: new Date().toISOString(),
        components: [],
        overall: 'passed',
      };
      res.json(success(config.nodeId, { report }, [
        { description: 'Tests are now per-component. Use POST /v1/foundry/:projectId/test/:componentId with AI-generated testCode.', method: 'POST', url: `/v1/foundry/${req.params['projectId'] as string}/test/:componentId` },
      ]));
    }
  );

  // GET /v1/foundry/:projectId/screenshots/:filename — serve test screenshot PNGs
  // NOTE: registered before /:projectId/components/:componentId to avoid 'screenshots' matching as componentId
  // Screenshots are project-scoped and non-sensitive — serve without auth
  // so <img src="..."> tags work without JS-based auth header injection
  router.get('/v1/foundry/:projectId/screenshots/:filename',
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const filename = req.params['filename'] as string;

      // SECURITY: this route is unauthenticated. BOTH path segments must be
      // validated — an unvalidated projectId allows traversal out of the temp
      // screenshot dir (e.g. `..%2f..%2f...`) → arbitrary file read.
      if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Invalid projectId'));
        return;
      }
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Invalid filename'));
        return;
      }

      const filepath = join(screenshotDir(projectId), filename);
      try {
        const data = await readFile(filepath);
        res.set('Content-Type', 'image/png');
        res.send(data);
      } catch {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Screenshot not found'));
      }
    }
  );

  // GET /v1/foundry/test-page/:projectId/:componentId — browser test runner page
  // Serves a self-contained HTML page that loads cortex/app library, auth, and test code.
  // Playwright just navigates here and reads window.__testResults.
  // CSP is removed for this route — AI-generated test code may use eval/new Function and
  // this is an internal test page behind auth, not a public-facing page.
  router.get('/v1/foundry/test-page/:projectId/:componentId',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      // Relaxed CSP for test pages -- AI-generated code may need eval()
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'");
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');

      const compRec = await storage.getMemory(ownerGhii(req), `foundry.${projectId}.component.${componentId}`);
      const compVal = (compRec?.value as Record<string, unknown>) ?? {};
      const compType = (compVal.type as string) || 'unknown';
      const registeredAs = compVal.registeredAs as string || componentId;
      const testCode = (compVal.testCode as string) || '';

      if (!testCode) {
        res.status(400).send('No test code for this component');
        return;
      }

      // Build cortex/app script tags — nonce required for CSP
      const nonce = res.locals.cspNonce as string;
      const scripts: string[] = [];
      if (compType === 'cortex' && registeredAs) {
        // Load ALL project cortex dependencies BEFORE the component under test.
        // Component cortexes depend on data cortex + platform UI cortexes.
        const allComps = await storage.listMemory(ownerGhii(req), { prefix: `foundry.${projectId}.component.`, visibility: 'owner' });
        const platformCortexes = ['aimeat-ui-nav', 'aimeat-ui-layout', 'aimeat-ui-viewers', 'aimeat-ui-forms', 'aimeat-ui-dialogs', 'aimeat-charts'];
        for (const pc of platformCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc}/libs/${pc}.js"></script>`);
        }
        const projectCortexes: Array<{ name: string; subtype: string }> = [];
        for (const rec of allComps) {
          const val = rec.value as Record<string, unknown>;
          if (val.type === 'cortex' && val.registeredAs && val.registeredAs !== registeredAs) {
            projectCortexes.push({ name: val.registeredAs as string, subtype: (val.subtype as string) || '' });
          }
        }
        projectCortexes.sort((a, b) => (a.subtype === 'data' ? -1 : b.subtype === 'data' ? 1 : 0));
        for (const pc of projectCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc.name}/libs/${pc.name}.js"></script>`);
        }
        scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${registeredAs}/libs/${registeredAs}.js"></script>`);
      }
      // App tests need the same cortex libraries the app uses
      if (compType === 'app') {
        const platformCortexes = ['aimeat-ui-nav', 'aimeat-ui-layout', 'aimeat-ui-viewers', 'aimeat-ui-forms', 'aimeat-ui-dialogs', 'aimeat-charts'];
        for (const pc of platformCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc}/libs/${pc}.js"></script>`);
        }
        const allComps = await storage.listMemory(ownerGhii(req), { prefix: `foundry.${projectId}.component.`, visibility: 'owner' });
        const cortexes: Array<{ name: string; subtype: string }> = [];
        for (const rec of allComps) {
          const val = rec.value as Record<string, unknown>;
          if (val.type === 'cortex' && val.registeredAs) {
            cortexes.push({ name: val.registeredAs as string, subtype: (val.subtype as string) || '' });
          }
        }
        cortexes.sort((a, b) => {
          const order = { data: 0, component: 1, feature: 1, 'app-domain': 2 };
          return (order[a.subtype as keyof typeof order] ?? 1) - (order[b.subtype as keyof typeof order] ?? 1);
        });
        for (const c of cortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${c.name}/libs/${c.name}.js"></script>`);
        }
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Test: ${registeredAs}</title></head>
<body>
<h1>Testing: ${registeredAs} (${compType})</h1>
<pre id="log"></pre>
<div id="result"></div>

<script nonce="${nonce}" src="/v1/libs/aimeat-auth.js"></script>
<script nonce="${nonce}">
// Inject test session into the real auth library
// Uses the same session.fetch() pattern as the real createSession() in aimeat-auth.js:
//   const resp = await fetch(url, { ...opts, headers }); return resp.json();
(function() {
  var jwt = ${JSON.stringify(token)};
  var parseJwt = function(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch(e) { return null; } };
  var payload = parseJwt(jwt);
  var session = {
    jwt: jwt,
    owner: payload && payload.owner || null,
    gaii: payload && payload.sub || null,
    ghii: (payload && payload.owner || '') + '@' + (payload && payload.node || ''),
    publicKey: null,
    nodeUrl: window.location.origin,
    roles: payload && payload.roles || [],
    get valid() { return true; },
    async fetch(path, opts) {
      if (!opts) opts = {};
      var url = window.location.origin + path;
      var headers = Object.assign({}, opts.headers || {}, {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + jwt
      });
      var resp = await fetch(url, Object.assign({}, opts, { headers: headers }));
      return resp.json();
    },
    async refresh() { return this; }
  };
  // Override getSession synchronously — before aimeat-data.js loads
  var origGetSession = AIMEAT.auth.getSession.bind(AIMEAT.auth);
  AIMEAT.auth.getSession = function() { return session || origGetSession(); };
})();
</script>
<script nonce="${nonce}" src="/v1/libs/aimeat-data.js"></script>

${scripts.join('\n')}

<script nonce="${nonce}">
// Ensure AIMEAT namespace aliases exist — cortex IIFEs register under different paths
(function() {
  if (!window.AIMEAT) window.AIMEAT = {};
  if (!window.AIMEAT.ui) window.AIMEAT.ui = {};
  var aliases = {
    'aimeat-ui-forms': 'forms', 'aimeat-ui-nav': 'nav', 'aimeat-ui-layout': 'layout',
    'aimeat-ui-viewers': 'viewers', 'aimeat-ui-dialogs': 'dialogs',
  };
  for (var full in aliases) {
    var short = aliases[full];
    if (AIMEAT[full] && !AIMEAT.ui[short]) AIMEAT.ui[short] = AIMEAT[full];
    if (AIMEAT.ui[short] && !AIMEAT[full]) AIMEAT[full] = AIMEAT.ui[short];
  }
})();
</script>

<script nonce="${nonce}">
// Test runner
window.__testResults = null;
window.__testRunning = true;
(async function() {
  try {
    ${testCode}
  } catch (e) {
    if (!window.__testResults) {
      window.__testResults = { passed: false, errors: ['Test threw: ' + e.message] };
    }
  } finally {
    window.__testRunning = false;
    if (!window.__testResults) {
      window.__testResults = { passed: false, errors: ['Test did not complete'] };
    }
    // Show results in DOM
    var el = document.getElementById('result');
    if (el && window.__testResults) {
      el.textContent = JSON.stringify(window.__testResults, null, 2);
      el.style.color = window.__testResults.passed ? 'green' : 'red';
    }
  }
})();
</script>
</body></html>`;

      res.set('Content-Type', 'text/html');
      res.send(html);
    }
  );
}
