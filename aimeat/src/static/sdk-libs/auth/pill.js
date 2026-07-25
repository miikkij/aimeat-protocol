/**
 * @file auth/pill.js
 * @description aimeat-auth login pill (SDK-libs migration Phase 3). mountPill() renders the golden
 *   login/logout pill (with the in-pill theme toggle, the H-2 permissions gear for external-app
 *   grants, and the compact account-button + popover that is the mobile-safe default on app origins)
 *   into a container, wires logout / manage-grant / theme / compact-popover, and re-renders on the
 *   'login'/'logout'/'session-updated' events. On an app origin with no session it kicks the silent
 *   SSO bridge itself. Extracted from mountLoginButton in auth-lib-part2.ts; receives `auth` so it
 *   never touches module state directly (reads via auth.getSession()).
 * @structure mountPill(auth, selector, opts) → render() + event wiring.
 * @usage import { mountPill } from './pill.js';  (auth.mountLoginButton delegates here)
 * @version-history
 *   v1.1.0 — 2026-07-25 — The in-pill controls become the platform control cluster (segmented
 *     language switch + segmented ☀|☾ mode switch + palette swatch picker, styled by cluster.js),
 *     with outside-click/Escape closers for the cluster popovers.
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2.ts (SDK-libs migration Phase 3).
 */
import { isAppOrigin, restoreSessionFromAppOrigin } from './session.js';
import { showLoginModal } from './modal.js';
import { escHtml, modeSwitchHtml, wireModeSwitch, ensureAuthPillStyles, pillInitials } from './theme.js';
import { readLocales, langSwitchHtml, wireLangSwitch } from './locale.js';
import { paletteControlHtml, wirePaletteControl } from './palette.js';
import { ensureClusterStyles, clampPopover } from './cluster.js';
import { load, remove } from './crypto.js';
import { emit } from './events.js';

export function mountPill(auth, selector, opts = {}) {
  // Resolve the mount container. Tolerate three call shapes so a common misuse doesn't crash:
  //   mountLoginButton('#bar', opts) · mountLoginButton(el, opts) · mountLoginButton({ onLogin })
  let container;
  if (selector && typeof selector === 'object' && selector.nodeType === 1) {
    container = selector;                     // a DOM element
  } else if (selector && typeof selector === 'object') {
    opts = selector;                          // the object IS the options — options-first call
    container = document.getElementById('aimeat-auth-bar');
    if (!container) { container = document.createElement('div'); container.id = 'aimeat-auth-bar'; document.body.appendChild(container); }
  } else {
    container = document.querySelector(selector);
    if (!container) { console.error('AIMEAT: mountLoginButton container not found for selector:', selector, '— pass a CSS selector string, a DOM element, or an options object.'); return; }
  }

  const i = opts.i18n || {};
  // Languages the APP says it has: opts.locales, else <meta name="aimeat-locales" content="en fi">.
  // Empty when the app declares none or only one, and then no language control renders at all.
  const locales = readLocales(opts);
  // Compact pill (account button + popover on ≤600px) is the mobile-safe DEFAULT on app origins.
  const useCompact = opts.compact !== undefined ? !!opts.compact : isAppOrigin();

  function render() {
    // Prefer the live session (carries the H-2 _app/_own grant metadata) over the persisted copy.
    const stored = auth.getSession() || load('session');
    if (stored) {
      var pillHtml = '<div class="aimeat-auth-pill" style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;'
        + 'background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);'
        + 'border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);'
        + 'border-radius:10px;'
        + 'box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4),0 0 20px rgba(201,168,76,.15);'
        + 'font-family:system-ui;font-size:14px">'
        + '<span class="aimeat-auth-dot" style="display:inline-block;flex:0 0 auto;width:9px;height:9px;border-radius:50%;'
        + 'background:radial-gradient(circle at 35% 35%,#b0ffc8,#00c853 40%,#00802e 80%,#003d15);'
        + 'box-shadow:0 0 5px rgba(0,200,83,.7),0 0 12px rgba(0,200,83,.3),inset 0 -1px 2px rgba(0,0,0,.3)"></span>'
        + '<span class="aimeat-auth-label" style="display:inline-flex;align-items:center;font-size:12px;font-weight:600;letter-spacing:.5px;color:#a0ffb8;text-shadow:0 0 4px rgba(0,210,80,.6),0 0 10px rgba(0,180,70,.3)">'
        + escHtml(i.loggedIn || 'logged in') + '</span>'
        + '<span class="aimeat-auth-ghii" style="color:rgba(90,65,20,.7);font-weight:700;letter-spacing:.5px;font-size:13px;'
        + 'text-shadow:0 1px 0 rgba(245,230,163,.6),0 -1px 0 rgba(50,35,10,.3);'
        + '-webkit-text-stroke:.2px rgba(120,85,20,.3)">'
        + escHtml(stored.displayName || stored.ghii || stored.owner) + '</span>'
        + (stored.federated ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.5px;color:#7dd3fc;'
          + 'background:rgba(56,189,248,.15);padding:2px 6px;border-radius:4px;border:1px solid rgba(56,189,248,.3)">'
          + '\u{1F310} ' + escHtml(i.federated || 'Federated') + '</span>' : '')
        // Permissions gear — only for an EXTERNAL app (a grant the user gave, not their own app).
        + ((stored._appOrigin && stored._app && !stored._own)
          ? '<button id="aimeat-grant-gear" title="' + escHtml(i.manageAccess || 'Manage permissions') + '" '
            + 'aria-label="' + escHtml(i.manageAccess || 'Manage permissions') + '" style="'
            + 'background:rgba(90,65,20,.18);color:#5a4114;border:1px solid rgba(120,85,20,.35);'
            + 'border-radius:6px;padding:3px 8px;cursor:pointer;font-size:13px;line-height:1">⚙️</button>'
          : '')
        // The control cluster — language, light/dark mode, palette — inside the pill so every
        // embedding app inherits the SAME three controls for free.
        + '<span class="aimeat-ctl">' + langSwitchHtml(i, locales) + modeSwitchHtml(i) + paletteControlHtml(i) + '</span>'
        + '<button id="aimeat-logout-btn" class="aimeat-auth-logout" style="'
        + 'background:radial-gradient(ellipse at 50% 30%,#ff6b6b 0%,#dc2626 35%,#991b1b 70%,#7f1d1d 100%);'
        + 'color:#ffd7d7;border:1px solid rgba(220,38,38,.6);border-top-color:rgba(255,130,130,.4);border-bottom-color:rgba(100,20,20,.8);'
        + 'border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.3px;'
        + 'box-shadow:0 1px 0 rgba(255,140,140,.25) inset,0 -1px 0 rgba(80,10,10,.4) inset,0 2px 6px rgba(153,27,27,.5);'
        + 'text-shadow:0 1px 1px rgba(0,0,0,.4)">' + escHtml(i.logoutBtn || 'Logout') + '</button>'
        + '</div>';
      // Compact mode (default ON on app origins): wrap the full pill behind a small "account" button.
      if (useCompact) {
        ensureAuthPillStyles();
        var ini = pillInitials(stored.displayName || stored.ghii || stored.owner);
        container.innerHTML = '<div class="aimeat-auth-wrap">'
          + '<button class="aimeat-auth-compact" id="aimeat-auth-compact" aria-haspopup="true" aria-expanded="false" '
          + 'aria-label="' + escHtml(i.account || 'Account') + '">'
          + '<span class="cdot" aria-hidden="true"></span><span class="cini">' + escHtml(ini) + '</span>'
          + '<span class="ccar" aria-hidden="true">▾</span></button>'
          + pillHtml + '</div>';
      } else {
        container.innerHTML = pillHtml;
      }
      document.getElementById('aimeat-logout-btn').addEventListener('click', () => {
        auth.logout();
        render();
        if (opts.onLogout) opts.onLogout();
      });
      var gearBtn = document.getElementById('aimeat-grant-gear');
      if (gearBtn) gearBtn.addEventListener('click', () => {
        auth.manageGrant().then((res) => {
          render(); // reflect revoke (→ Sign In) or a re-grant
          if (res && res.revoked && opts.onLogout) opts.onLogout();
        }).catch(() => {});
      });
      // Compact trigger toggles the popover. The outside-click / Escape closers are registered ONCE
      // per mount (below, after render()) — not here — so re-renders don't stack them.
      var compactBtn = document.getElementById('aimeat-auth-compact');
      if (compactBtn) compactBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        var w = container.querySelector('.aimeat-auth-wrap');
        if (!w) return;
        var open = w.classList.toggle('aimeat-open');
        compactBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    } else {
      container.innerHTML = '<style>.aimeat-sign-btn{'
        + 'padding:8px 18px;'
        + 'background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);'
        + 'color:#2a1800;border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);'
        + 'border-radius:10px;cursor:pointer;font-weight:800;font-family:system-ui;font-size:14px;letter-spacing:.3px;'
        + 'box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4),0 0 20px rgba(201,168,76,.15);'
        + 'text-shadow:0 1px 0 rgba(245,230,163,.5);'
        + 'transition:transform .15s,box-shadow .15s}'
        + '.aimeat-sign-btn:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 5px 16px rgba(0,0,0,.5),0 0 30px rgba(201,168,76,.3)}'
        + '</style>'
        // Keep the whole cluster (language + mode + palette) reachable even when signed out.
        + '<span style="display:inline-flex;align-items:center;gap:10px">'
        + '<span class="aimeat-ctl">' + langSwitchHtml(i, locales) + modeSwitchHtml(i) + paletteControlHtml(i) + '</span>'
        + '<button id="aimeat-login-btn" class="aimeat-sign-btn">'
        + (opts.buttonText || i.signInBtn || '❤️ Sign In') + '</button>'
        + '</span>';
      document.getElementById('aimeat-login-btn').addEventListener('click', () => {
        // On an app origin, the Sign In click is the user gesture that opens the consent popup for a
        // non-owned app (interactive). On the apex it's the normal owner login modal.
        if (isAppOrigin()) { restoreSessionFromAppOrigin(true).then((s) => { if (s) render(); }).catch(() => {}); }
        else { showLoginModal(opts, render); }
      });
    }
    wireModeSwitch(container); // the cluster is present in both signed-in and signed-out markup
    wireLangSwitch(container, i, locales);
    wirePaletteControl(container, clampPopover);
  }
  ensureClusterStyles();
  render();
  // Close any open cluster popover (palette / language list) on an outside click or Escape.
  document.addEventListener('click', (ev) => {
    container.querySelectorAll('.aimeat-pop-wrap.aimeat-open').forEach((w) => {
      if (!w.contains(/** @type {Node} */ (ev.target))) {
        w.classList.remove('aimeat-open');
        var b = w.querySelector('.aimeat-pop-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
    });
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    container.querySelectorAll('.aimeat-pop-wrap.aimeat-open').forEach((w) => {
      w.classList.remove('aimeat-open');
      var b = w.querySelector('.aimeat-pop-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  });
  // Close the compact popover on an outside click or Escape (registered ONCE per mount).
  if (useCompact) {
    var closeCompact = () => {
      var w = container.querySelector('.aimeat-auth-wrap.aimeat-open');
      if (!w) return;
      w.classList.remove('aimeat-open');
      var cb = w.querySelector('.aimeat-auth-compact');
      if (cb) cb.setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('click', (ev) => {
      var w = container.querySelector('.aimeat-auth-wrap.aimeat-open');
      if (w && !w.contains(ev.target)) closeCompact();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeCompact(); });
  }
  // Re-render when the session changes out-of-band (e.g. the H-2 silent SSO logs in async). Only
  // re-render (do NOT call opts.onLogin — the interactive modal path already does).
  auth.on('login', render);
  auth.on('logout', render);
  auth.on('session-updated', render); // live display-name (etc.) edits
  // Seamless SSO: on an app origin with no session yet, attempt the silent bridge ourselves. Always
  // re-confirm via the bridge on load (the cached session is only a UI cache); drop a stale cache.
  if (isAppOrigin() && !auth.getSession()) {
    restoreSessionFromAppOrigin(false).then((s) => {
      if (!s && load('session')) { remove('session'); emit('logout'); }
    }).catch(() => {});
  }
}
