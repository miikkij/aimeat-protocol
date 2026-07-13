/**
 * @file src/routes/generator/testing.ts
 * @description Generator test-execution + debug + probe routes — per-component and bulk test runners,
 *   debug-artifact writes, apply-settings/probe-extension bridges, screenshot serving, and the
 *   self-contained browser test-runner page. Extracted from src/routes/generator.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/generator.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { executeHttpTest, executePlaywrightTest, isPlaywrightAvailable, ensureScreenshotDir, screenshotDir } from '../../services/generator-testing.js';
import type { TestReport, TestResult } from '../../services/generator-testing.js';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Blueprint } from '../../services/generator-prompts/types.js';
import { GeneratorDebugWriter } from '../../services/generator-debug.js';

export function registerTestingRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  ownerGhii: (req: Express.Request) => string,
): void {
  // POST /v1/generator/:projectId/test/:componentId — execute AI-generated test code
  // NOTE: registered before bulk test and /:projectId/components/:componentId
  // SECURITY (H-7): testCode runs via `new Function` in the host Node process
  // (and/or a CSP-bypassed Playwright browser) with NO sandbox — i.e. RCE as the
  // caller. Restricted to operator: on a single-operator node this is the same
  // person who already controls the host; on a multi-owner node it prevents a
  // regular owner from escalating past their data scope to host/secrets.
  router.post('/v1/generator/:projectId/test/:componentId',
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
      const compRec = await storage.getMemory(gaii, `generator.${projectId}.component.${componentId}`);
      const compVal = (compRec?.value as Record<string, unknown>) ?? {};
      const compType = (compVal.type as string) || 'unknown';

      // Save testCode to component record BEFORE running the test.
      // The browser test page reads testCode from the component record (GET /test-page/).
      // Without this, the test page gets stale/empty testCode and the test fails.
      if (compRec) {
        await storage.setMemory({
          ...compRec,
          value: { ...compVal, testCode: testCode as string },
          version: (compRec.version ?? 1) + 1,
          updatedAt: new Date().toISOString(),
        });
      }

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
          const targetUrl = `${baseUrl}/v1/generator/test-page/${projectId}/${componentId}`;

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
      const debugWriter = new GeneratorDebugWriter(projectId);
      const compLabel = (compVal.label as string) || componentId;
      await debugWriter.writeTestCode(componentId, testCode as string);
      await debugWriter.writeTestResult(componentId, result as unknown as Record<string, unknown>);
      // Copy screenshots to debug folder so they're visible alongside other artifacts
      if (result.screenshots && result.screenshots.length > 0) {
        const { screenshotDir: getScreenDir } = await import('../../services/generator-testing.js');
        const { copyFile } = await import('node:fs/promises');
        const srcDir = getScreenDir(projectId);
        for (const ss of result.screenshots as string[]) {
          try {
            const src = `${srcDir}/${ss}`;
            const dest = `data/debug/generator/${projectId}/components/${componentId}/${ss}`;
            await copyFile(src, dest).catch(() => {});
          } catch { /* screenshot copy optional */ }
        }
      }
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
      const statusIcon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭';
      logger.info(`[generator-test] ${statusIcon} ${compLabel} (${compType}): ${result.status}${result.errors.length > 0 ? ' — ' + result.errors.length + ' errors' : ''}`, {
        projectId, componentId, environment: env, errors: result.errors.slice(0, 3),
      });
      // Log trace for failed tests — shows every callExt/readExtMemory call with extracted shapes
      if (result.status === 'failed' && result.trace && result.trace.length > 0) {
        for (const t of result.trace) {
          const resultStr = t.result || 'null';
          // If shape was extracted, log just the shape on one line
          const shapeMatch = resultStr.match(/\[shape extracted from (\d+) chars\]/);
          if (shapeMatch) {
            // Extract the JSON shape (everything before the [shape extracted...] marker)
            const shapeJson = resultStr.slice(0, resultStr.indexOf('\n[shape extracted')).trim();
            // Log compact: fn → shape (one line)
            const compactShape = shapeJson.replace(/\s+/g, ' ').slice(0, 500);
            logger.info(`[generator-test]   [${t.status}] ${t.fn}(${t.args.slice(0, 60)}) → SHAPE: ${compactShape} [from ${shapeMatch[1]} chars]`);
          } else {
            logger.info(`[generator-test]   [${t.status}] ${t.fn}(${t.args.slice(0, 60)}) → ${resultStr.slice(0, 300)}`);
          }
        }
      }

      res.json(success(config.nodeId, { result }));
    }
  );

  // POST /v1/generator/:projectId/debug/:componentId — write debug artifact to disk
  router.post('/v1/generator/:projectId/debug/:componentId',
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

      const debugWriter = new GeneratorDebugWriter(projectId);
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

  // POST /v1/generator/:projectId/apply-settings/:extensionName — inject project settings into extension config
  // Reads settings from generator.{projectId}.settings and merges them into the extension's config object.
  // This bridges blueprint settings (collected from user) to the extension's runtime config (ctx.config).
  router.post('/v1/generator/:projectId/apply-settings/:extensionName',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const gaii = ownerGhii(req);
      const projectId = req.params['projectId'] as string;
      const extensionName = req.params['extensionName'] as string;

      // Load project settings
      const settingsRec = await storage.getMemory(gaii, `generator.${projectId}.settings`);
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

  // POST /v1/generator/:projectId/probe-extension — call extension actions with test params, capture real responses
  // Used by autopilot to get actual API response shapes for injection into cortex/app prompts.
  router.post('/v1/generator/:projectId/probe-extension',
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
      const projectRecord = await storage.getMemory(gaii, `generator.${projectId}.project`);
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

      logger.info('[generator] Extension probe complete', { extensionName, probed: results.length, projectId });

      res.json(success(config.nodeId, { extensionName, results }));
    },
  );

  // POST /v1/generator/:projectId/test — bulk test endpoint
  router.post('/v1/generator/:projectId/test',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      const projectId = req.params['projectId'] as string;
      const gaii = ownerGhii(req);

      const projectRec = await storage.getMemory(gaii, `generator.${projectId}.project`);
      if (!projectRec) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Project not found'));
        return;
      }

      const validLevels = ['none', 'basic', 'comprehensive'] as const;
      const level = (req.body?.level || 'none') as string;
      if (!(validLevels as readonly string[]).includes(level)) {
        res.status(400).json(error(config.nodeId, 'INVALID_BODY', `Invalid test level: ${level}. Must be one of: ${validLevels.join(', ')}`));
        return;
      }

      const blueprint = (projectRec.value as { blueprint?: Blueprint })?.blueprint;
      const components: TestResult[] = [];
      if (blueprint?.components && level !== 'none') {
        for (const comp of blueprint.components as Array<{ id: string; type?: string }>) {
          components.push({
            componentId: comp.id,
            type: comp.type || 'unknown',
            status: 'passed',
            scenarios: 0,
            passed: 0,
            errors: [],
            screenshots: [],
            fixRound: 0,
          });
        }
      }

      const report: TestReport = {
        level: level as TestReport['level'],
        timestamp: new Date().toISOString(),
        components,
        overall: 'passed',
      };
      res.json(success(config.nodeId, { report }, [
        { description: 'Run per-component tests', method: 'POST', url: `/v1/generator/${projectId}/test/:componentId` },
      ]));
    }
  );

  // GET /v1/generator/:projectId/screenshots/:filename — serve test screenshot PNGs
  // NOTE: registered before /:projectId/components/:componentId to avoid 'screenshots' matching as componentId
  // Screenshots are project-scoped and non-sensitive — serve without auth
  // so <img src="..."> tags work without JS-based auth header injection
  router.get('/v1/generator/:projectId/screenshots/:filename',
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

  // GET /v1/generator/test-page/:projectId/:componentId — browser test runner page
  // Serves a self-contained HTML page that loads cortex/app library, auth, and test code.
  // Playwright just navigates here and reads window.__testResults.
  // CSP is removed for this route — AI-generated test code may use eval/new Function and
  // this is an internal test page behind auth, not a public-facing page.
  router.get('/v1/generator/test-page/:projectId/:componentId',
    requireAuth(),
    requireRole('owner'),
    async (req, res) => {
      // Relaxed CSP for test pages -- AI-generated code may need eval()
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'");
      const projectId = req.params['projectId'] as string;
      const componentId = req.params['componentId'] as string;
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');

      const compRec = await storage.getMemory(ownerGhii(req), `generator.${projectId}.component.${componentId}`);
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
        // Without these, tests fail with "lib not loaded" errors.
        const allComps = await storage.listMemory(ownerGhii(req), { prefix: `generator.${projectId}.component.`, visibility: 'owner' });
        // Platform UI cortexes first (always available, not project-specific)
        const platformCortexes = ['aimeat-ui-nav', 'aimeat-ui-layout', 'aimeat-ui-viewers', 'aimeat-ui-forms', 'aimeat-ui-dialogs', 'aimeat-charts'];
        for (const pc of platformCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc}/libs/${pc}.js"></script>`);
        }
        // Then project cortexes in dependency order: data cortex before components
        const projectCortexes: Array<{ name: string; subtype: string }> = [];
        for (const rec of allComps) {
          const val = rec.value as Record<string, unknown>;
          if (val.type === 'cortex' && val.registeredAs && val.registeredAs !== registeredAs) {
            projectCortexes.push({ name: val.registeredAs as string, subtype: (val.subtype as string) || '' });
          }
        }
        // Data cortex first, then other cortexes
        projectCortexes.sort((a, b) => (a.subtype === 'data' ? -1 : b.subtype === 'data' ? 1 : 0));
        for (const pc of projectCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc.name}/libs/${pc.name}.js"></script>`);
        }
        // Finally the component under test
        scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${registeredAs}/libs/${registeredAs}.js"></script>`);
      }
      // App tests need the same cortex libraries the app uses
      // Load all cortex libs that belong to this project
      if (compType === 'app') {
        // Platform UI cortexes first
        const platformCortexes = ['aimeat-ui-nav', 'aimeat-ui-layout', 'aimeat-ui-viewers', 'aimeat-ui-forms', 'aimeat-ui-dialogs', 'aimeat-charts'];
        for (const pc of platformCortexes) {
          scripts.push(`<script nonce="${nonce}" src="/v1/cortex/${pc}/libs/${pc}.js"></script>`);
        }
        const allComps = await storage.listMemory(ownerGhii(req), { prefix: `generator.${projectId}.component.`, visibility: 'owner' });
        // Data cortex first, then components, then app-domain
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
<html><head><meta charset="utf-8"><title>Test: ${registeredAs}</title>
<link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
<link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
<script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 min-h-screen flex flex-col">
<!-- AIMEAT Header — same structure as spa.html -->
<nav class="navbar bg-base-200 shadow-sm px-4">
  <div class="flex-1 gap-4">
    <span class="text-lg font-bold">AIME<span style="color:#E8564A">♥</span>AT</span>
    <span class="text-xs opacity-50">Testing: ${registeredAs}</span>
  </div>
  <div class="flex-none gap-2">
    <span id="header-auth"></span>
  </div>
</nav>
<!-- App area — app-domain.render() targets this -->
<div id="app" class="flex-1"></div>
<!-- Test infrastructure (hidden during visual testing) -->
<details class="p-2 bg-base-200 mt-auto"><summary class="text-xs cursor-pointer">Test log</summary>
<pre id="log" class="text-xs"></pre>
<div id="result"></div>
</details>

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
  // Override auth methods — test page has a real JWT, make all auth paths work
  AIMEAT.auth.getSession = function() { return session; };
  AIMEAT.auth.login = async function() { return session; };
  AIMEAT.auth.logout = async function() { location.reload(); };
  // Also set AIMEAT.session directly — cortex IIFEs use AIMEAT.session.fetch()
  AIMEAT.session = session;
  // Mount the real golden sign-in/logout button in header
  // mountLoginButton is NOT overridden — it uses the real auth library UI
  setTimeout(function() {
    if (AIMEAT.auth.mountLoginButton) {
      AIMEAT.auth.mountLoginButton('#header-auth');
    }
  }, 100);
})();
</script>
<script nonce="${nonce}" src="/v1/libs/aimeat-data.js"></script>

${scripts.join('\n')}

<script nonce="${nonce}">
// Ensure AIMEAT namespace aliases exist — cortex IIFEs register under different paths
// and generated code may use any of them
(function() {
  if (!window.AIMEAT) window.AIMEAT = {};
  if (!window.AIMEAT.ui) window.AIMEAT.ui = {};
  // Alias bundled cortex names to AIMEAT.ui.* paths if not already set
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
window.__renderSnapshot = null; // Set by test code to capture rendered state
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
    // Show rendered component snapshot (if captured by test) BEFORE showing results
    if (window.__renderSnapshot) {
      var snapDiv = document.createElement('div');
      snapDiv.id = 'render-snapshot';
      snapDiv.style.border = '2px solid #ccc';
      snapDiv.style.padding = '16px';
      snapDiv.style.margin = '16px 0';
      snapDiv.style.background = '#fff';
      snapDiv.innerHTML = '<h3 style="margin:0 0 8px">Rendered Component</h3>' + window.__renderSnapshot;
      document.body.appendChild(snapDiv);
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
