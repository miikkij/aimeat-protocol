/**
 * @file src/routes/portal-human.ts
 * @description Builds the human-facing "try it now" portal landing page as a self-contained HTML
 *   string (Finnish-first, mobile-first). Carries strict double-escaping rules for JS embedded in HTML.
 *
 * @structure
 *   - humanPortalHtml(config, t, locale, stats): renders the full localized landing page,
 *     assembled from ./portal-human/ modules (CSS: styles-a/b/c; browser script: page-script; esc: escape)
 *   - humanPortalRouter(config, storage): anonymous memory save endpoints (try-memory, welcome)
 *   - top-of-file comment documents the two-level template-literal escaping contract (do not remove)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-13 — Extracted CSS, browser script, and esc/jesc into ./portal-human/ (max-file-lines)
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Locale, TFunction } from '../i18n.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { esc } from './portal-human/escape.js';
import { PORTAL_CSS_A } from './portal-human/styles-a.js';
import { PORTAL_CSS_B } from './portal-human/styles-b.js';
import { PORTAL_CSS_C } from './portal-human/styles-c.js';
import { renderPortalScript } from './portal-human/page-script.js';

/* ──────────────────────────────────────────────────────────
   Human-facing portal page — "try it now" experience
   Finnish-first, mobile-first, no jargon
   ──────────────────────────────────────────────────────────

   ⚠️  ESCAPING RULES — DO NOT REMOVE THIS COMMENT  ⚠️

   This file builds JS code inside HTML template literals.
   There are TWO levels of escaping at play:

   Level 1: TypeScript template literal (backticks)
     - \' is consumed by TS → outputs just '
     - \n is consumed by TS → outputs a real newline

   Level 2: Browser JS string (single quotes in rendered HTML)
     - The rendered JS uses '...' strings that the browser parses

   CORRECT patterns inside template literal JS strings:
     \\n   → renders as \n  (JS newline escape in browser)   ✅
     \\\\'  → renders as \'  (escaped quote in browser)       ✅
     <scr' + 'ipt>  → avoids closing the HTML script block   ✅
     <\\/script>      → avoids closing the HTML script block  ✅

   WRONG patterns (will cause SyntaxError in browser):
     \n   → renders as real newline → breaks JS string        ❌
     \\'   → renders as ' → terminates JS string prematurely  ❌
     </script> → closes the HTML script block early           ❌

   When adding text with apostrophes (e.g. "everyone's",
   "who's", "others' content"), always use \\\\' so the
   rendered output contains \' which the browser treats
   as an escaped quote inside the JS string.

   ────────────────────────────────────────────────────────── */

export function humanPortalHtml(
  config: AimeatConfig,
  t: TFunction,
  locale: Locale,
  _stats: { agents: number; chatSessions: number; actions: number; boards: number },
): string {
  const otherLocaleLabel = locale === 'fi' ? 'EN' : 'FI';
  const currentLocaleLabel = locale === 'fi' ? 'FI' : 'EN';

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="aimeat-node" content="${esc(config.baseUrl)}">
<title>${esc(t('hero.title'))} — AIME AT</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
${PORTAL_CSS_A}${PORTAL_CSS_B}${PORTAL_CSS_C}</style>
</head>
<body>

<!-- Background -->
<div class="bg-canvas" id="bgCanvas">
  <div class="nebula" style="width:400px;height:400px;background:radial-gradient(circle,rgba(255,105,180,0.3),transparent);top:5%;left:10%;"></div>
  <div class="nebula" style="width:350px;height:350px;background:radial-gradient(circle,rgba(99,102,241,0.25),transparent);top:40%;right:5%;animation-delay:-8s;"></div>
  <div class="nebula" style="width:300px;height:300px;background:radial-gradient(circle,rgba(196,69,105,0.2),transparent);bottom:10%;left:30%;animation-delay:-14s;"></div>
</div>

<!-- Top Navigation -->
<nav class="topnav">
  <a href="/v1/portal" class="topnav-brand">
    <span class="heart">\u{1F496}</span> AIME AT
  </a>
  <div class="topnav-center">
    <a href="?lang=fi" class="lang-btn ${locale === 'fi' ? 'active' : ''}">${locale === 'fi' ? currentLocaleLabel : otherLocaleLabel}</a>
    <a href="?lang=en" class="lang-btn ${locale === 'en' ? 'active' : ''}">${locale === 'en' ? currentLocaleLabel : otherLocaleLabel}</a>
  </div>
  <div class="topnav-right">
    <a href="?view=dev${locale !== 'fi' ? '&lang=' + locale : ''}">${esc(t('nav.devView'))}</a>
  </div>
</nav>

<!-- Main Content -->
<div class="main">

  <!-- Hero -->
  <section class="hero">
    <h1 class="hero-title">${esc(t('hero.title'))}</h1>
    <p class="hero-subtitle">${esc(t('hero.subtitle'))}</p>
  </section>

  <!-- Anonymous note -->
  <div class="anon-banner">
    ${esc(t('hero.anonNote'))}
  </div>

  <!-- Welcome messages (board.welcome) -->
  <div class="welcome-section">
    <div class="welcome-title">\u{1F44B} ${esc(t('welcome.title'))}</div>
    <div class="welcome-list" id="welcomeList">
      <div class="welcome-msg" id="welcomeEmpty"><span class="welcome-msg-text">${esc(t('welcome.emptyBoard'))}</span></div>
    </div>
    <div class="welcome-form">
      <input type="text" class="welcome-input" id="welcomeInput" placeholder="${esc(t('welcome.placeholder'))}" maxlength="280">
      <button class="welcome-send-btn" id="welcomeSendBtn" type="button">${esc(t('welcome.sendBtn'))}</button>
    </div>
    <div class="welcome-sent" id="welcomeSent">\u2714 ${esc(t('welcome.sent'))}</div>
  </div>

  <!-- GROUP 1: Minulle ja muille -->
  <div class="group-section" id="group-forme" data-group="forme">
    <div class="group-header" id="group-forme-header">
      <div class="group-icon">\u{1F31F}</div>
      <div class="group-text">
        <div class="group-title">${esc(t('groups.forMe'))}</div>
        <div class="group-desc">${esc(t('groups.forMeDesc'))}</div>
      </div>
      <div class="group-arrow">\u25BC</div>
    </div>
    <div class="group-body">
      <p style="font-size:.9rem;color:var(--text);line-height:1.5;margin-bottom:1rem">
        ${esc(t('cards.apps.desc'))}
      </p>
      <p style="font-size:.82rem;color:var(--text-dim);font-style:italic;margin-bottom:1rem">
        ${esc(t('cards.apps.anyAiWorks'))}
      </p>

      <div class="mega-prompt-area">
        <textarea class="mega-prompt-box" id="megaPromptForMe" readonly></textarea>
        <div class="mega-prompt-actions">
          <button class="mega-copy-btn" id="copyMegaForMe" type="button">\u{1F4CB} ${esc(t('groups.forMeCopy'))}</button>
        </div>
        <div class="mega-steps">${esc(t('groups.forMeSteps'))}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:.5rem;font-style:italic">${esc(t('cards.apps.promptLangNote'))}</div>
      </div>

      <!-- App catalog link -->
      <a href="/app-catalog.html" class="group-catalog-link">
        \u{1F4E6} ${esc(t('catalog.openBtn'))}
      </a>
      <div style="font-size:.82rem;color:var(--text-dim);margin-top:.5rem">${esc(t('catalog.desc'))}</div>

      <!-- Return flow -->
      <div style="margin-top:1.5rem;padding:1.25rem;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:12px">
        <div style="font-weight:700;font-size:1rem;margin-bottom:.75rem">${esc(t('cards.apps.returnTitle'))}</div>
        <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:.75rem">${esc(t('cards.apps.returnMotivation'))}</div>
        <ol style="font-size:.85rem;color:var(--text-muted);margin:0 0 1rem 1.25rem;padding:0">
          <li style="margin-bottom:.25rem">${esc(t('cards.apps.returnStep1'))}</li>
          <li style="margin-bottom:.25rem">${esc(t('cards.apps.returnStep2'))}</li>
          <li>${esc(t('cards.apps.returnStep3'))}</li>
        </ol>
        <button class="mega-copy-btn" id="return-app-btn" data-auth-text="${esc(t('cards.apps.returnBtnAuth'))}" style="font-size:.85rem;padding:.5rem 1.25rem">${esc(t('cards.apps.returnBtnAnon'))}</button>
      </div>
    </div>
  </div>

  <!-- GROUP 2: Minun AI Agenteilleni -->
  <div class="group-section" id="group-agents" data-group="agents">
    <div class="group-header" id="group-agents-header">
      <div class="group-icon">\u{1F916}</div>
      <div class="group-text">
        <div class="group-title">${esc(t('groups.forAgents'))}</div>
        <div class="group-desc">${esc(t('groups.forAgentsDesc'))}</div>
      </div>
      <div class="group-arrow">\u25BC</div>
    </div>
    <div class="group-body">
      <div class="mega-prompt-area">
        <textarea class="mega-prompt-box" id="megaPromptAgents" readonly></textarea>
        <div class="mega-prompt-actions">
          <button class="mega-copy-btn" id="copyMegaAgents" type="button">\u{1F4CB} ${esc(t('groups.forAgentsCopy'))}</button>
        </div>
        <div class="mega-steps">${esc(t('groups.forMeSteps'))}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:.5rem;font-style:italic">${esc(t('cards.apps.promptLangNote'))}</div>
      </div>
    </div>
  </div>

  <!-- GROUP 3: Palveluiden tekijöille -->
  <div class="group-section" id="group-builders" data-group="builders">
    <div class="group-header" id="group-builders-header">
      <div class="group-icon">\u{1F3D7}\u{FE0F}</div>
      <div class="group-text">
        <div class="group-title">${esc(t('groups.forBuilders'))}</div>
        <div class="group-desc">${esc(t('groups.forBuildersDesc'))}</div>
      </div>
      <div class="group-arrow">\u25BC</div>
    </div>
    <div class="group-body">
      <p style="font-size:.9rem;color:var(--text);line-height:1.5;margin-bottom:1rem">
        ${esc(t('cards.services.desc'))}
      </p>
      <div class="group-register-box">
        <div class="group-register-title">${esc(t('cards.services.registerTitle'))}</div>
        <div class="group-register-desc">${esc(t('cards.services.registerDesc'))}</div>
        <button class="group-register-btn" id="builders-register-btn">${esc(t('groups.forBuildersRegister'))}</button>
      </div>
    </div>
  </div>

  <!-- Morsels economy -->
  <div class="morsels-footer">
    <span class="heart-icon">\u{1F496}</span> ${esc(t('morsels.economy'))}
  </div>

</div><!-- .main -->

<script src="${config.baseUrl}/v1/libs/aimeat-auth.js"></script>
<script>
${renderPortalScript(config, t, locale)}
</script>
</body>
</html>`;
}

/* ──────────────────────────────────────────────────────────
   Router — anonymous memory save endpoints
   ────────────────────────────────────────────────────────── */

export function humanPortalRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.post('/v1/portal/try-memory', requireAuth(), async (req, res) => {
    const text = req.body?.text;
    if (!text || typeof text !== 'string' || text.length > 280) {
      res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Text required (max 280 chars)'));
      return;
    }

    const gaii = req.auth!.sub;
    const boardKey = 'board.public';

    // Read existing board
    const existing = await storage.getMemory(gaii, boardKey);
    const val = existing?.value as Record<string, unknown> | undefined;
    let messages: { msg: string; t: string }[] = [];
    if (val?.messages && Array.isArray(val.messages)) {
      messages = val.messages as { msg: string; t: string }[];
    }

    // Append new message, keep last 20
    messages.push({ msg: text, t: new Date().toISOString() });
    if (messages.length > 20) messages = messages.slice(-20);

    // Write back
    await storage.setMemory({
      key: boardKey,
      ownerGaii: gaii,
      value: { messages },
      visibility: 'public',
      tags: ['board'],
      ttlHours: 72,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { posted: true, count: messages.length }));
  });

  router.post('/v1/portal/welcome', requireAuth(), async (req, res) => {
    const text = req.body?.text;
    if (!text || typeof text !== 'string' || text.length > 280) {
      res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Text required (max 280 chars)'));
      return;
    }

    const gaii = req.auth!.sub;
    const boardKey = 'board.welcome';

    // Read existing welcome board
    const existing = await storage.getMemory(gaii, boardKey);
    const val = existing?.value as Record<string, unknown> | undefined;
    let messages: { msg: string; t: string }[] = [];
    if (val?.messages && Array.isArray(val.messages)) {
      messages = val.messages as { msg: string; t: string }[];
    }

    // Append new message, keep last 20
    messages.push({ msg: text, t: new Date().toISOString() });
    if (messages.length > 20) messages = messages.slice(-20);

    // Write back
    await storage.setMemory({
      key: boardKey,
      ownerGaii: gaii,
      value: { messages },
      visibility: 'public',
      tags: ['board', 'welcome'],
      ttlHours: 72,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { posted: true, count: messages.length }));
  });

  return router;
}
