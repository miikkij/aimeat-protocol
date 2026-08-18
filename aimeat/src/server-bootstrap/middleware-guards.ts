/**
 * @file src/server-bootstrap/middleware-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installs early request guards during server bootstrap: maintenance-mode gating
 *   (503 + a styled HTML page for browsers), node-type guards for relay/mirror nodes, and a
 *   first-run redirect that serves the setup wizard when no owners exist yet.
 *
 * @structure
 *   - setupGuards(app, config, storage, maintenanceCache, invalidateHasOwnersCache): wires the guards
 *   - rejectForRelay / mirrorReadOnly: node-type handlers returned for selective mounting
 *   - maintenancePageHtml(nodeId, message): renders the auto-refreshing maintenance page
 *
 * @version-history
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
      req.method === 'OPTIONS'
    ) { next(); return; }

    const msg = mc.message || 'This node is temporarily offline for maintenance.';

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

function maintenancePageHtml(nodeId: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="30"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>Maintenance — ${esc(nodeId)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1025;color:#f0e6ff;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;padding:20px;overflow:hidden}

/* ── Warm ambient gradient base ── */
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(168,85,247,.12) 0%,transparent 50%),radial-gradient(ellipse at 70% 80%,rgba(236,72,153,.1) 0%,transparent 50%),radial-gradient(ellipse at 50% 50%,rgba(139,92,246,.06) 0%,transparent 70%);z-index:0}

/* ── PS-style flowing waves — warm and bright ── */
.waves{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.wave{position:absolute;width:200%;height:200%;border-radius:42%;animation:drift linear infinite}
.wave:nth-child(1){background:linear-gradient(135deg,#c084fc,#f472b6,#fb923c);top:-60%;left:-50%;animation-duration:25s;opacity:.07}
.wave:nth-child(2){background:linear-gradient(225deg,#a78bfa,#f9a8d4,#fdba74);top:-65%;left:-55%;animation-duration:30s;animation-delay:-5s;opacity:.06}
.wave:nth-child(3){background:linear-gradient(315deg,#e879f9,#fb7185,#c084fc);top:-70%;left:-45%;animation-duration:35s;animation-delay:-10s;opacity:.05}
.wave:nth-child(4){background:linear-gradient(45deg,#f0abfc,#fda4af,#d8b4fe);top:-55%;left:-60%;animation-duration:40s;animation-delay:-15s;opacity:.04}
@keyframes drift{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

/* ── Floating hearts + particles ── */
.particles{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.particle{position:absolute;opacity:0;animation:float linear infinite}
.particle.dot{border-radius:50%}
.particle.heart::before{content:'\\2665';font-size:inherit;color:inherit}
.particle:nth-child(1){font-size:14px;color:rgba(244,114,182,.5);left:8%;animation-duration:14s;animation-delay:0s}
.particle:nth-child(2){width:3px;height:3px;background:#c084fc;left:20%;animation-duration:16s;animation-delay:-2s}
.particle:nth-child(3){font-size:10px;color:rgba(192,132,252,.4);left:35%;animation-duration:12s;animation-delay:-5s}
.particle:nth-child(4){width:2px;height:2px;background:#f9a8d4;left:48%;animation-duration:18s;animation-delay:-3s}
.particle:nth-child(5){font-size:16px;color:rgba(251,113,133,.4);left:62%;animation-duration:15s;animation-delay:-7s}
.particle:nth-child(6){width:3px;height:3px;background:#fda4af;left:75%;animation-duration:13s;animation-delay:-1s}
.particle:nth-child(7){font-size:12px;color:rgba(216,180,254,.4);left:88%;animation-duration:17s;animation-delay:-9s}
.particle:nth-child(8){width:2px;height:2px;background:#f0abfc;left:50%;animation-duration:20s;animation-delay:-11s}
.particle:nth-child(9){font-size:8px;color:rgba(249,168,212,.35);left:15%;animation-duration:19s;animation-delay:-6s}
.particle:nth-child(10){width:4px;height:4px;background:rgba(244,114,182,.3);left:42%;animation-duration:11s;animation-delay:-4s}
@keyframes float{0%{transform:translateY(100vh) scale(0);opacity:0}10%{opacity:.7}90%{opacity:.7}100%{transform:translateY(-10vh) scale(1);opacity:0}}

/* ── Card ── */
.card{position:relative;z-index:1;background:rgba(30,20,45,.65);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid rgba(192,132,252,.2);border-radius:28px;padding:56px 48px;max-width:520px;width:100%;text-align:center;box-shadow:0 0 100px rgba(168,85,247,.1),0 0 40px rgba(236,72,153,.06),0 4px 32px rgba(0,0,0,.2);animation:cardIn .8s cubic-bezier(.16,1,.3,1)}
@keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}

/* ── Heart-beat loader ── */
.loader{position:relative;width:80px;height:80px;margin:0 auto 28px}
.heart-icon{font-size:40px;line-height:80px;animation:heartbeat 1.6s ease-in-out infinite;filter:drop-shadow(0 0 12px rgba(244,114,182,.4))}
@keyframes heartbeat{0%,100%{transform:scale(1)}14%{transform:scale(1.15)}28%{transform:scale(1)}42%{transform:scale(1.1)}56%{transform:scale(1)}}
.loader-ring{position:absolute;inset:0;border-radius:50%;border:2px solid transparent}
.loader-ring:nth-child(1){border-top-color:rgba(192,132,252,.5);animation:spin 3s linear infinite}
.loader-ring:nth-child(2){inset:4px;border-right-color:rgba(244,114,182,.4);animation:spin 4s linear infinite reverse}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Brand ── */
.brand{font-size:.85rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;margin-bottom:6px;color:rgba(216,180,254,.6)}
h1{font-size:1.6rem;font-weight:700;margin-bottom:14px;background:linear-gradient(135deg,#f0abfc,#f9a8d4,#fda4af);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.01em}
.msg{color:#c4b5d4;font-size:1rem;margin-bottom:28px;line-height:1.7}
.reason{background:rgba(192,132,252,.08);border:1px solid rgba(192,132,252,.18);border-radius:12px;padding:14px 20px;color:#d8b4fe;font-size:.9rem;margin-bottom:28px;letter-spacing:.01em}
.node-id{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 16px;margin-bottom:20px}
.node-id code{color:#a78bfa;font-family:'SF Mono',Consolas,monospace;font-size:.75rem}
.status-dot{width:7px;height:7px;border-radius:50%;background:#f472b6;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(244,114,182,.5)}50%{opacity:.6;box-shadow:0 0 0 8px rgba(244,114,182,0)}}
.footer{color:rgba(167,139,250,.4);font-size:.7rem;margin-top:8px;letter-spacing:.04em;text-transform:uppercase}

/* ── Progress bar — warm gradient ── */
.progress{width:100%;height:3px;background:rgba(255,255,255,.06);border-radius:2px;margin-top:24px;overflow:hidden}
.progress-bar{height:100%;width:100%;background:linear-gradient(90deg,#c084fc,#f472b6,#fb923c,#c084fc);background-size:300% 100%;border-radius:2px;animation:shimmer 2.5s linear infinite}
@keyframes shimmer{from{background-position:300% 0}to{background-position:0 0}}

/* ── Tagline ── */
.tagline{position:relative;z-index:1;margin-top:24px;font-size:.75rem;color:rgba(216,180,254,.3);letter-spacing:.08em}
</style></head><body>

<!-- PS-style flowing waves -->
<div class="waves">
<div class="wave"></div>
<div class="wave"></div>
<div class="wave"></div>
<div class="wave"></div>
</div>

<!-- Floating hearts + particles -->
<div class="particles">
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
</div>

<div class="card">
  <!-- Heart-beat loader with orbiting rings -->
  <div class="loader">
    <div class="loader-ring"></div>
    <div class="loader-ring"></div>
    <div class="heart-icon">&#x2665;</div>
  </div>

  <p class="brand">AIME AT</p>
  <h1>We'll Be Right Back</h1>
  <p class="msg">Making things even better for you.<br>This won't take long.</p>
  ${message ? `<div class="reason">${esc(message)}</div>` : ''}

  <div class="node-id">
    <span class="status-dot"></span>
    <code>${esc(nodeId)}</code>
  </div>

  <div class="progress"><div class="progress-bar"></div></div>
  <p class="footer">Auto-refreshes every 30 seconds</p>
</div>

<p class="tagline">AI Memory Exchange &amp; Action Transfer</p>
</body></html>`;
}
