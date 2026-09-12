/**
 * @file src/server-bootstrap/middleware-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installs early request guards during server bootstrap: maintenance-mode gating
 *   (503 + the house maintenance page for browsers), node-type guards for relay/mirror nodes, and a
 *   first-run redirect that serves the setup wizard when no owners exist yet.
 *
 * @structure
 *   - setupGuards(app, config, storage, maintenanceCache, invalidateHasOwnersCache): wires the guards
 *   - rejectForRelay / mirrorReadOnly: node-type handlers returned for selective mounting
 *   - maintenancePageHtml(nodeId, message): renders the auto-refreshing maintenance page
 *
 * @version-history
 *   v1.1.0 — 2026-09-12 — The maintenance page in the house face (design canvas "AIMEAT Admin
 *     Maintenance"): the wordmark with its SVG heart, the ink headline, the operator's line, and
 *     the theme's own paper and coral instead of the purple glass, the gradient text, the drifting
 *     waves and the emoji hearts. The two font files it names pass the guard, or the one page a
 *     visitor gets is the one page not set in the house faces.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage, MaintenanceState } from '../storage/interface.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Resolve the server-bootstrap directory for path resolution.
 */
function resolveServerDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  return dirname(__filename);
}

/**
 * Set up maintenance mode guard, node-type guards (relay/mirror),
 * and first-run wizard redirect.
 */
export function setupGuards(
  app: express.Express,
  config: AimeatConfig,
  storage: Storage,
  maintenanceCache: { get: () => MaintenanceState },
  invalidateHasOwnersCache: () => void,
): { rejectForRelay: express.RequestHandler; mirrorReadOnly: express.RequestHandler; invalidateHasOwnersCache: () => void } {
  const __dirname = resolveServerDir();

  // ── Maintenance mode guard ──
  // Returns 503 for non-essential paths when maintenance is enabled.
  // Operators always pass. Essential paths (health, admin, spec, well-known) always pass.
  app.use((req, res, next) => {
    const mc = maintenanceCache.get();
    if (!mc.enabled) { next(); return; }

    // Operators always bypass
    if (req.auth?.roles?.includes('operator')) { next(); return; }

    // Essential paths always bypass
    const p = req.path;
    if (
      p === '/' ||
      p === '/v1/health' ||
      p.startsWith('/v1/admin') ||
      p.startsWith('/v1/spec') ||
      p.startsWith('/.well-known') ||
      p.startsWith('/v1/federation/peer/introduce') ||
      p.startsWith('/v1/federation/directory') ||
      p.startsWith('/favicon') ||
      // The operator's dashboard is allowed above, and this is what it is MADE of: stylesheets,
      // modules, served libs, strings, the build stamp and the header's own config. None of it is
      // data — and without it the one page that can bring the node back loads blank, which turns a
      // maintenance stop into a maintenance lock-in. The maintenance page below reads the same
      // /lib/ for the house faces. Measured on 2026-09-12 in a sandbox: with the node down, the
      // dashboard's auth lib answered 503 and the browser refused to run it.
      p.startsWith('/css/') || p.startsWith('/js/') || p.startsWith('/components/') ||
      p.startsWith('/views/') || p.startsWith('/lib/') || p.startsWith('/locales/') ||
      p.startsWith('/assets/') || p.startsWith('/v1/libs/') ||
      p === '/v1/site/header-nav' || p === '/v1/build' ||
      // And the way IN: a token that expires mid-stop must be renewable, and an operator who is
      // signed out must be able to sign back in, or the stop locks the person who called it out
      // of the only screen that ends it. Both doors keep their own rate limit and tarpit, and
      // everything a token could then reach is still refused below.
      p.startsWith('/v1/auth/') || p === '/v1/ghii/login' ||
      req.method === 'OPTIONS'
    ) { next(); return; }

    // The operator's own line when there is one; this is what the page and the JSON body carry,
    // and the maintenance page's preview shows the same default back to them.
    const msg = mc.message || 'Back shortly.';

    // Serve HTML for browsers, JSON for API clients
    if (req.accepts(['html', 'json']) === 'html') {
      res.status(503).type('text/html').send(maintenancePageHtml(config.nodeId, msg));
      return;
    }

    res.status(503).json({
      ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
      timestamp: new Date().toISOString(),
      error: { code: 'MAINTENANCE_MODE', message: msg },
    });
  });

  // ── Node-type guards ──
  // Relay nodes: stateless routers — no agent hosting, memory, work, boards
  const rejectForRelay: express.RequestHandler = (_req, res, next) => {
    if (config.nodeType === 'relay') {
      res.status(503).json({
        ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
        timestamp: new Date().toISOString(),
        error: { code: 'NODE_TYPE_UNSUPPORTED', message: 'Relay nodes do not host agents or data. Use a Full node.' },
      });
      return;
    }
    next();
  };

  // Mirror nodes: read-only replicas — block all write operations
  const mirrorReadOnly: express.RequestHandler = (req, res, next) => {
    if (config.nodeType === 'mirror' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      // Allow federation replication inbound (mirror receives data from peers)
      if (req.path.startsWith('/v1/federation/replicate') || req.path.startsWith('/v1/federation/catalogue-sync')) {
        next();
        return;
      }
      res.status(503).json({
        ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
        timestamp: new Date().toISOString(),
        error: { code: 'MIRROR_READ_ONLY', message: 'Mirror nodes are read-only. Direct writes to a Full node.' },
      });
      return;
    }
    next();
  };

  // First-run detection: redirect to wizard if no owners exist
  let hasOwners: boolean | null = null;
  const originalInvalidate = invalidateHasOwnersCache;
  const wrappedInvalidate = () => { hasOwners = true; originalInvalidate(); };
  app.use(async (req, res, next) => {
    // Skip for API routes (any /vN/ version — not just /v1/), static assets, and the
    // wizard page itself. Without matching /v2/ (and beyond) the first-run gate wrongly
    // served the wizard HTML for /v2/mcp/* and other versioned API routes.
    if (/^\/v\d+\//.test(req.path) || req.path.includes('.') || req.path === '/wizard.html') {
      next();
      return;
    }
    // Cache the check
    if (hasOwners === null) {
      const owners = await storage.listOwners();
      hasOwners = owners.length > 0;
    }
    if (!hasOwners) {
      // Serve wizard inline (resolvePublicFile pattern)
      const wizardCandidates = [
        join(process.cwd(), 'public', 'wizard.html'),
        join(__dirname, '..', '..', 'public', 'wizard.html'),
        join(__dirname, '..', '..', '..', 'public', 'wizard.html'),
      ];
      const wizardPath = wizardCandidates.find(p => existsSync(p));
      if (wizardPath) {
        let html = readFileSync(wizardPath, 'utf-8');
        const nonce = res.locals.cspNonce as string || '';
        if (nonce) {
          html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
          html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
        }
        res.type('text/html').send(html);
      } else {
        res.redirect(302, '/v1/setup/status');
      }
      return;
    }
    next();
  });

  return { rejectForRelay, mirrorReadOnly, invalidateHasOwnersCache: wrappedInvalidate };
}

/**
 * The page a visitor gets while the node is down: the wordmark, one ink headline, the line the
 * operator wrote, and nothing else. Drawn in the house face with the theme's own values written
 * out, because this page is served before anything a stylesheet could reach. It refreshes itself
 * every 30 seconds, so the person who left it open sees the node come back on its own.
 */
function maintenancePageHtml(nodeId: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="30"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/lib/aimeat-fonts.css">
<title>Down for work — ${esc(nodeId)}</title>
<style>
:root{--text:#1A1A2E;--bg:#FAFAF8;--dim:#6B7280;--accent:#E8564A;--sun:#FFB52E;
--headline:'Fjalla One','Arial Narrow',sans-serif;--body:'Archivo',system-ui,-apple-system,sans-serif;
--wordmark:'Archivo Black','Archivo',system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--text:#EDEEF2;--bg:#14151A;--dim:#A4A9B6;--accent:#FF6F62}}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--body);min-height:100vh;display:flex;flex-direction:column}
.bar{display:flex;align-items:center;gap:14px;padding:18px 28px;border-bottom:3px solid var(--text)}
.mark{display:inline-flex;align-items:center;font-family:var(--wordmark);font-size:1.3rem;letter-spacing:-.01em}
.mark svg{width:.78em;height:.78em;margin:0 -.04em;fill:var(--accent)}
.mark .at{color:var(--accent)}
.crumb{font-family:var(--mono);font-size:.72rem;color:var(--dim)}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 28px 56px}
h1{font-family:var(--headline);font-weight:400;font-size:clamp(2.6rem,7vw,4.2rem);line-height:1;letter-spacing:.01em;text-transform:uppercase;margin-bottom:22px}
.msg{font-size:1.15rem;font-weight:600;line-height:1.5;max-width:34ch}
.sub{margin-top:22px;font-size:.95rem;line-height:1.6;color:var(--dim);max-width:46ch}
.rule{width:64px;height:4px;background:var(--sun);margin:26px auto 0}
footer{display:flex;justify-content:center;gap:22px;flex-wrap:wrap;padding:14px 28px 22px;font-family:var(--mono);font-size:.72rem;color:var(--dim)}
</style></head><body>
<div class="bar">
  <span class="mark">AIME<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-5.1-8-10.4A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 3.6C20 15.9 12 21 12 21z"/></svg><span class="at">AT</span></span>
  <span class="crumb">${esc(nodeId)}</span>
</div>
<main>
  <h1>Down for work</h1>
  <p class="msg">${esc(message)}</p>
  <p class="sub">Your data is untouched and you are still signed in. This page checks every 30 seconds and comes back on its own.</p>
  <div class="rule"></div>
</main>
<footer><span>503 Service Unavailable</span><span>${esc(nodeId)}</span></footer>
</body></html>`;
}
