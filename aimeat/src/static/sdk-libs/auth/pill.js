/**
 * @file auth/pill.js
 * @description aimeat-auth login pill (SDK-libs migration Phase 3). mountPill() renders the
 *   login/logout pill (with the in-pill theme toggle, the H-2 permissions gear for external-app
 *   grants, and the compact account-button + popover that is the mobile-safe default on app origins)
 *   into a container, wires logout / manage-grant / theme / compact-popover, and re-renders on the
 *   'login'/'logout'/'session-updated' events. On an app origin with no session it kicks the silent
 *   SSO bridge itself. Extracted from mountLoginButton in auth-lib-part2.ts; receives `auth` so it
 *   never touches module state directly (reads via auth.getSession()).
 * @structure mountPill(auth, selector, opts) → render() + event wiring.
 * @usage import { mountPill } from './pill.js';  (auth.mountLoginButton delegates here)
 * @version-history
 *   v1.4.0 — 2026-08-29 — The gold is gone. The pill is an ink-framed row that reads the page's own
 *     tokens (--text, --bg, --accent, --sun, --success, with fallbacks for a page that defines none),
 *     so it is ink on paper in the shell, light on a dark page, and follows every palette. All of it
 *     is class-styled from theme.js (ensureAuthPillStyles); the markup carries no inline styles.
 *   v1.3.0 — 2026-08-13 — The pill speaks the reader's language on its own. It draws the language
 *     switch, so it always knows which language was chosen, yet its own labels fell back to English
 *     literals unless the host passed opts.i18n — which only the SPA did, so a Spanish CADENCE
 *     showed an English "Logout". Labels now come from pill-strings.js under whatever the caller
 *     passes, and the pill re-renders on 'aimeat-lang-change' so they follow its own switch.
 *   v1.2.0 — 2026-08-07 — The host's onLogout fires from the auth lib's 'logout' event (after the
 *     session is gone) instead of synchronously after the un-awaited logout() — the race that left
 *     hosts rendering a signed-in header next to a "Sign In" button.
 *   v1.1.0 — 2026-07-25 — The in-pill controls become the platform control cluster (segmented
 *     language switch + segmented ☀|☾ mode switch + palette swatch picker, styled by cluster.js),
 *     with outside-click/Escape closers for the cluster popovers.
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2.ts (SDK-libs migration Phase 3).
 */
import { isAppOrigin, restoreSessionFromAppOrigin } from './session.js';
import { showLoginModal } from './modal.js';
import { escHtml, modeSwitchHtml, wireModeSwitch, ensureAuthPillStyles, pillInitials } from './theme.js';
import { readLocales, langSwitchHtml, wireLangSwitch, aimeatReadLang } from './locale.js';
import { pillStrings } from './pill-strings.js';
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

  // Languages the APP says it has: opts.locales, else <meta name="aimeat-locales" content="en fi">.
  // Empty when the app declares none or only one, and then no language control renders at all.
  const locales = readLocales(opts);
  // The pill's own labels follow the reader's language. The caller's strings always win, so the SPA
  // (which passes the node's full dictionary) is unaffected; an app that passes nothing stops
  // getting an English "Logout" under a Spanish page. Recomputed per render, because the pill's own
  // switch can change the language while the page is open.
  let i = Object.assign({}, pillStrings(aimeatReadLang(locales.length ? locales : ['en'])), opts.i18n);
  // Compact pill (account button + popover on ≤600px) is the mobile-safe DEFAULT on app origins.
  const useCompact = opts.compact !== undefined ? !!opts.compact : isAppOrigin();

  function render() {
    i = Object.assign({}, pillStrings(aimeatReadLang(locales.length ? locales : ['en'])), opts.i18n);
    // Prefer the live session (carries the H-2 _app/_own grant metadata) over the persisted copy.
    const stored = auth.getSession() || load('session');
    if (stored) {
      // The pill is class-styled (ensureAuthPillStyles) and reads the page's own tokens, so it is
      // ink on paper here, light on a dark page, and whatever a palette says elsewhere.
      var pillHtml = '<div class="aimeat-auth-pill">'
        + '<span class="aimeat-auth-dot" aria-hidden="true"></span>'
        + '<span class="aimeat-auth-label">' + escHtml(i.loggedIn || 'logged in') + '</span>'
        + '<span class="aimeat-auth-ghii">' + escHtml(stored.displayName || stored.ghii || stored.owner) + '</span>'
        + (stored.federated ? '<span class="aimeat-auth-fed">\u{1F310} ' + escHtml(i.federated || 'Federated') + '</span>' : '')
        // Permissions gear — only for an EXTERNAL app (a grant the user gave, not their own app).
        + ((stored._appOrigin && stored._app && !stored._own)
          ? '<button id="aimeat-grant-gear" class="aimeat-auth-gear" title="' + escHtml(i.manageAccess || 'Manage permissions') + '" '
            + 'aria-label="' + escHtml(i.manageAccess || 'Manage permissions') + '">⚙️</button>'
          : '')
        // The control cluster — language, light/dark mode, palette — inside the pill so every
        // embedding app inherits the SAME three controls for free.
        + '<span class="aimeat-ctl">' + langSwitchHtml(i, locales) + modeSwitchHtml(i) + paletteControlHtml(i) + '</span>'
        + '<button id="aimeat-logout-btn" class="aimeat-auth-logout">' + escHtml(i.logoutBtn || 'Logout') + '</button>'
        + '</div>';
      ensureAuthPillStyles();
      // Compact mode (default ON on app origins): wrap the full pill behind a small "account" button.
      if (useCompact) {
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
      // Just ask for the logout — the render + opts.onLogout notification hang off the auth lib's
      // 'logout' event (wired once, below), which fires AFTER the session state is actually gone.
      document.getElementById('aimeat-logout-btn').addEventListener('click', () => { auth.logout(); });
      var gearBtn = document.getElementById('aimeat-grant-gear');
      if (gearBtn) gearBtn.addEventListener('click', () => {
        // A revoke routes through auth.logout() → the 'logout' event handles render + onLogout.
        auth.manageGrant().then(() => { render(); }).catch(() => {});
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
      ensureAuthPillStyles();
      container.innerHTML = ''
        // Keep the whole cluster (language + mode + palette) reachable even when signed out.
        + '<span class="aimeat-auth-out">'
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
  // The pill's own switch fires this, and so does an app that sets the language itself. Re-render so
  // the pill's labels follow the language it just changed rather than staying in the old one.
  window.addEventListener('aimeat-lang-change', render);
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
  // Logout is the ONE place that also notifies the host: the event fires after the session is
  // already cleared, so every subscriber that then reads getSession()/hasSession sees the truth.
  // Calling opts.onLogout from the button handler instead raced the async logout() and left hosts
  // (the SPA header's bell + "Me" menu) rendering a signed-in state next to a "Sign In" button.
  // Routing it through the event also covers the paths the button never touches: a grant revoke
  // via manageGrant(), and the stale-cache drop below.
  auth.on('logout', () => { render(); if (opts.onLogout) opts.onLogout(); });
  auth.on('session-updated', render); // live display-name (etc.) edits
  // Seamless SSO: on an app origin with no session yet, attempt the silent bridge ourselves. Always
  // re-confirm via the bridge on load (the cached session is only a UI cache); drop a stale cache.
  if (isAppOrigin() && !auth.getSession()) {
    restoreSessionFromAppOrigin(false).then((s) => {
      if (!s && load('session')) { remove('session'); emit('logout'); }
    }).catch(() => {});
  }
}
