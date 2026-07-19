/**
 * @file src/routes/libs/auth-lib-part2.ts
 * @description aimeat-auth.js browser library source, middle segment (event system, public auth API, login pill, theme toggle, modal i18n). Extracted from libs.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-07-19 — Compact login pill is now the DEFAULT on app origins (isAppOrigin()), not
 *     opt-in — every published app is mobile-safe out of the box. Apex SPA stays full; explicit
 *     compact:true/false still wins.
 *   v1.1.0 — 2026-07-18 — Opt-in compact login pill: mountLoginButton({ compact:true }) renders a
 *     small "account" button on ≤600px that opens the full pill as a popover; +compactPill flag.
 *   v1.0.0 — 2026-07-13 — Extracted from libs.ts (max-file-lines)
 */
export function aimeatAuthLibPart2(): string {
  return `
// ── Event system ──
const listeners = {};
function emit(event, data) { (listeners[event] || []).forEach(fn => fn(data)); }

// ── Public API ──

const auth = {
  nodeUrl: NODE_URL,
  nodeId: NODE_ID,

  /**
   * Register a new human identity (GHII) and get an authenticated session.
   * @param {string} username - Username (3-64 chars, lowercase alphanumeric + hyphens)
   * @param {string} displayName - Human-readable display name
   * @param {object} [opts] - Optional: bio, avatar, locale, password
   * @returns {Promise<object>} Session object with .fetch(), .refresh(), .jwt, .ghii
   */
  async register(username, displayName, opts = {}) {
    // Register GHII (creates owner + human profile)
    const regData = await api('/v1/ghii', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        username,
        display_name: displayName,
        bio: opts.bio,
        avatar: opts.avatar,
        locale: opts.locale,
        password: opts.password || undefined,
      }),
    });

    // With a password, establish a cookie-backed session via the login endpoint
    // (owner sessions refresh via the httpOnly cookie — no signing key needed).
    if (opts.password) {
      return this.loginWithPassword(username, opts.password);
    }

    // ── Legacy no-password path: key-signing token, no refresh cookie ──
    const ownerName = regData.data.owner.name;
    const ghii = regData.data.ghii.ghii;
    // Normal registration returns private_key/public_key; dev-mode reset returns owner_private_key/owner_public_key.
    const serverPrivateKey = regData.data.private_key || regData.data.owner_private_key;
    const serverPublicKey = regData.data.public_key || regData.data.owner_public_key || '';
    if (!serverPrivateKey) {
      throw new Error('Server did not return an owner signing key. Please try signing in again.');
    }

    // Dev-mode reset already returns an owner JWT. Fresh registration still needs to mint one.
    let ownerToken = regData.data.token || null;
    if (!ownerToken) {
      const ownerTimestamp = new Date().toISOString();
      const ownerMessage = ownerName + NODE_ID + ownerTimestamp;
      const ownerSig = await sign(serverPrivateKey, ownerMessage);
      const ownerTokenData = await api('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ownerTimestamp, signature: ownerSig }),
      });
      ownerToken = ownerTokenData.data.token;
    }

    // SECURITY: Import owner private key as non-extractable CryptoKey in IndexedDB
    const ownerCryptoKey = await importEd25519Key(serverPrivateKey);
    await storeKey('owner_key', ownerCryptoKey);

    // Owner session — agents are connected later via device auth
    const session = createSession({
      ghii, owner: ownerName, gaii: null,
      jwt: ownerToken,
      _cryptoKey: ownerCryptoKey, publicKey: serverPublicKey,
      displayName: regData.data.ghii.display_name || '',
    });

    // SECURITY: Only save metadata to localStorage (no private keys)
    save('session', {
      owner: ownerName, gaii: null, ghii,
      jwt: session.jwt, publicKey: serverPublicKey, roles: session.roles,
      displayName: session.displayName || '',
    });

    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  },

  /**
   * Login with stored credentials (auto-refreshes JWT if expired).
   * @param {string} [username] - Optional: login as specific user (default: last session)
   * @returns {Promise<object|null>} Session or null if no stored credentials
   */
  async login(username) {
    // On an app origin the host-only cookie is unreachable (cross-origin + CORS *); use the
    // same-site silent bridge so the owner's own app is logged in with no separate login (H-2).
    // Non-interactive (no popup) — login() is commonly called on boot, not from a user gesture; the
    // visible consent popup for a non-owned app is reserved for the Sign In button click.
    if (isAppOrigin()) return await restoreSessionFromAppOrigin(false);
    const stored = load('session');
    // No local metadata — but an httpOnly refresh cookie may exist (e.g. a browser an agent
    // authenticated with an owner access token). Restore the session from the cookie alone.
    if (!stored) return await restoreSessionFromCookie();
    if (username && stored.owner !== username) return null;

    // SECURITY: Run one-time migration from localStorage to IndexedDB
    await migrateKeysToIndexedDB();

    // Migrate old agent sessions to owner sessions:
    // If stored session has gaii (old agent-based login), convert to owner session
    if (stored.gaii) {
      stored.gaii = null;
    }

    // Load CryptoKey from IndexedDB — owner key for owner sessions, agent key for agent sessions
    const cryptoKey = stored.gaii ? await loadKey('agent_key') : await loadKey('owner_key');
    const session = createSession({ ...stored, _cryptoKey: cryptoKey });

    // Owner-local sessions ALWAYS refresh on boot: the httpOnly cookie is the source of
    // truth (the stored access token may be stale or predate the cookie system). Agent /
    // federated sessions refresh only when their token is actually expired (legacy path).
    const isOwnerLocal = !session.federated && !session.gaii;
    if (isOwnerLocal || isExpired(session.jwt)) {
      try {
        await session.refresh();
      } catch(e) {
        remove('session');
        emit('expired');
        return null;
      }
    }

    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  },

  /**
   * Login with username + password (works from any device).
   * Server verifies password, regenerates keys, returns fresh session.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<object>} Session object
   */
  async loginWithPassword(username, password) {
    // Owner sessions refresh via the httpOnly cookie, so no signing key is needed and
    // we never ask the server to mint/rotate one (that used to break other devices).
    // credentials:'include' lets the server set the refresh cookie.
    const data = await api('/v1/ghii/login', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });

    const d = data.data;

    // Federated logins may still return an owner key pair; store it if present (harmless).
    let ownerCryptoKey = null;
    if (d.owner_private_key) {
      ownerCryptoKey = await importEd25519Key(d.owner_private_key);
      await storeKey('owner_key', ownerCryptoKey);
    }

    // Owner session — human users authenticate as owners, not agents
    const session = createSession({
      ghii: d.ghii.ghii,
      owner: d.owner.name,
      gaii: null,
      jwt: d.token,
      _cryptoKey: ownerCryptoKey,
      publicKey: d.owner_public_key || '',
      displayName: d.ghii.display_name || '',
      federated: d.federated || false,
      homeNode: d.home_node || '',
      homeUrl: d.home_url || '',
    });

    // First sign-in of a provisioned-code ("key") account issues durable credentials (username + a
    // clean, dash-free password) in the response. Expose them once on the returned session (NOT
    // persisted) so the entry surface can show the user their real login. Absent on normal logins.
    if (d.key_credentials) session._keyCredentials = d.key_credentials;

    persistSession(session);

    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  },

  /** Get the current session (or null if not logged in) */
  getSession() {
    return currentSession;
  },

  /**
   * Patch mutable, non-secret session metadata in place (e.g. displayName after a profile
   * edit), persist it, and notify the login pill so it re-renders live — no page reload.
   * Ignored when there is no active session.
   */
  updateSessionMeta(patch) {
    if (!currentSession || !patch) return;
    Object.assign(currentSession, patch);
    persistSession(currentSession);
    emit('session-updated', currentSession);
  },

  /** Logout — clear stored credentials from localStorage and IndexedDB */
  async logout() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    ownerRefreshInFlight = null;
    // Revoke the session and clear the httpOnly refresh cookie server-side.
    try {
      await fetch(NODE_URL + '/v1/auth/revoke', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(currentSession?.jwt ? { 'Authorization': 'Bearer ' + currentSession.jwt } : {}),
        },
      });
    } catch (_) { /* best effort — still clear local state below */ }
    // On an app origin the session is a bridge of the shared apex session; clearing local state alone
    // would let the silent bridge re-log-in on the next load. End the apex session too so EXIT sticks
    // across the whole family (M-ROOM / LOOM / DROP), not just this one app.
    if (isAppOrigin()) { try { await apexLogout(); } catch (_) { /* best effort */ } }
    currentSession = null;
    remove('session');
    remove('owner_key');
    // SECURITY: Delete CryptoKeys from IndexedDB
    await deleteKey('agent_key');
    await deleteKey('owner_key');
    emit('logout');
  },

  /**
   * Re-open the consent screen for the current app (H-2 in-app grant management). Lets the user
   * review/adjust the permissions this app holds, or revoke it. Resolves to { revoked:true } if the
   * user revoked (the app is then logged out), the refreshed session if re-approved, else null.
   * Only meaningful on an app origin where a grant session exists.
   */
  async manageGrant() {
    const s = currentSession || load('session');
    if (!s || !s._app) return null;
    const res = await requestConsentPopup(s._app, (s.scopes || []).join(' '), true); // manage = always show the screen
    if (res && res.revoked) { await auth.logout(); return { revoked: true }; }
    if (res && res.access_token) return _buildAppSession(res.access_token, s._app, s._own);
    return null;
  },

  /** True when running inside a published app on its isolated origin (not the apex). */
  isAppOrigin() { return isAppOrigin(); },

  /**
   * Open the sign-in modal (password + Google if configured). For apex pages that must prompt login
   * outside mountLoginButton — e.g. the app-grant consent page when no one is logged in yet. Fires
   * the normal 'login' event on success (listen via auth.on('login', ...)).
   */
  showLoginModal(opts) { showLoginModal(opts || {}, function () {}); },

  /** Check if there are stored credentials */
  get hasSession() { return !!load('session'); },

  /** Get stored GHII without authenticating */
  get storedGhii() { const s = load('session'); return s?.ghii || null; },

  /** Register an event listener */
  on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  },

  /** Remove an event listener */
  off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
  },

  /** Check if running inside a sandboxed iframe (no localStorage access) */
  get inSandbox() {
    try { localStorage.getItem('_test'); return false; } catch(e) { return true; }
  },

  /**
   * Request auth credentials from the parent window via postMessage.
   * Use this when the app runs in a sandboxed iframe without localStorage access.
   * The parent (app-catalog) listens for { type: 'aimeat-request-auth' }
   * and responds with { type: 'aimeat-auth', jwt, nodeUrl }.
   * @param {number} [timeout=3000] - Max ms to wait for response
   * @returns {Promise<object|null>} Session-like object with .jwt and .fetch(), or null
   */
  requestParentAuth(timeout = 3000) {
    return new Promise((resolve) => {
      if (window === window.parent) { resolve(null); return; }

      let resolved = false;
      const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, timeout);

      function handler(e) {
        if (resolved) return;
        if (!e.data || e.data.type !== 'aimeat-auth') return;
        resolved = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);

        const jwt = e.data.jwt;
        const parentNodeUrl = e.data.nodeUrl;
        if (!jwt) { resolve(null); return; }

        // Override NODE_URL if parent provided one
        const effectiveNodeUrl = parentNodeUrl || NODE_URL;

        const session = {
          jwt,
          nodeUrl: effectiveNodeUrl,
          owner: null,
          gaii: null,
          ghii: null,
          identity: null,
          get valid() { return jwt && !isExpired(jwt); },
          async fetch(path, opts = {}) {
            const url = effectiveNodeUrl + path;
            const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt, ...(opts.headers || {}) };
            const resp = await fetch(url, { ...opts, headers });
            return resp.json();
          },
          async notify(title, opts = {}) {
            return session.fetch('/v1/notifications', {
              method: 'POST',
              body: JSON.stringify({ title, body: opts.body, link: opts.link, type: opts.type }),
            });
          },
        };

        // Parse JWT to extract identity info
        const payload = parseJwt(jwt);
        if (payload) {
          session.gaii = payload.sub || null;
          session.owner = payload.owner || null;
          session.identity = session.gaii || session.ghii || null;
        }

        currentSession = session;
        emit('login', session);
        resolve(session);
      }

      window.addEventListener('message', handler);
      window.parent.postMessage({ type: 'aimeat-request-auth' }, '*');
    });
  },

  // Capability flag so an embedding app can feature-detect the opt-in compact login pill
  // (AIMEAT.auth.compactPill) and adapt its own header — e.g. drop a bespoke hamburger once the
  // library can render the compact account button itself. Present only on libs that support it.
  compactPill: true,

  /**
   * Mount a login/register button that handles the full flow.
   * @param {string|Element|object} selector - CSS selector, a DOM element, OR (options-first) the
   *   opts object — calling mountLoginButton({ onLogin }) mounts into a created #aimeat-auth-bar so
   *   the natural options-first call Just Works.
   * @param {object} [opts] - Options: { onLogin, onLogout, buttonText, compact }. compact renders a
   *   small "account" button on narrow viewports (≤600px) that opens the full pill as a popover;
   *   it DEFAULTS to true on app origins (mobile-safe) and false on the apex, and an explicit
   *   compact:true/false always wins.
   */
  mountLoginButton(selector, opts = {}) {
    // Resolve the mount container. Tolerate three call shapes so a common misuse doesn't crash:
    //   mountLoginButton('#bar', opts)  — CSS selector (documented)
    //   mountLoginButton(el, opts)      — a DOM element passed directly
    //   mountLoginButton({ onLogin })   — options-first: mount into a default #aimeat-auth-bar
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
    // Compact pill (account button + popover on ≤600px) is the mobile-safe DEFAULT on app origins
    // (a fixed-width pill overflows a phone header); apex SPA stays full; explicit compact wins.
    const useCompact = opts.compact !== undefined ? !!opts.compact : isAppOrigin();

    function render() {
      // Prefer the live session (carries the H-2 _app/_own grant metadata for the gear) over the
      // persisted copy, but fall back to localStorage on first paint before login completes.
      const stored = currentSession || load('session');
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
            + '\\u{1F310} ' + escHtml(i.federated || 'Federated') + '</span>' : '')
          // Permissions gear — only for an EXTERNAL app (a grant the user gave, not their own app).
          // Click re-opens the consent screen to review/adjust the permissions or revoke.
          + ((stored._appOrigin && stored._app && !stored._own)
            ? '<button id="aimeat-grant-gear" title="' + escHtml(i.manageAccess || 'Manage permissions') + '" '
              + 'aria-label="' + escHtml(i.manageAccess || 'Manage permissions') + '" style="'
              + 'background:rgba(90,65,20,.18);color:#5a4114;border:1px solid rgba(120,85,20,.35);'
              + 'border-radius:6px;padding:3px 8px;cursor:pointer;font-size:13px;line-height:1">\\u2699\\uFE0F</button>'
            : '')
          // Light/dark toggle — lives inside the pill so embedding apps inherit it for free.
          + themeToggleHtml(i)
          + '<button id="aimeat-logout-btn" class="aimeat-auth-logout" style="'
          + 'background:radial-gradient(ellipse at 50% 30%,#ff6b6b 0%,#dc2626 35%,#991b1b 70%,#7f1d1d 100%);'
          + 'color:#ffd7d7;border:1px solid rgba(220,38,38,.6);border-top-color:rgba(255,130,130,.4);border-bottom-color:rgba(100,20,20,.8);'
          + 'border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.3px;'
          + 'box-shadow:0 1px 0 rgba(255,140,140,.25) inset,0 -1px 0 rgba(80,10,10,.4) inset,0 2px 6px rgba(153,27,27,.5);'
          + 'text-shadow:0 1px 1px rgba(0,0,0,.4)">' + escHtml(i.logoutBtn || 'Logout') + '</button>'
          + '</div>';
        // Compact mode (useCompact — default ON on app origins): wrap the full pill behind a small
        // "account" button that opens it as a popover on ≤600px; desktop/apex render it inline.
        if (useCompact) {
          ensureAuthPillStyles();
          var ini = pillInitials(stored.displayName || stored.ghii || stored.owner);
          container.innerHTML = '<div class="aimeat-auth-wrap">'
            + '<button class="aimeat-auth-compact" id="aimeat-auth-compact" aria-haspopup="true" aria-expanded="false" '
            + 'aria-label="' + escHtml(i.account || 'Account') + '">'
            + '<span class="cdot" aria-hidden="true"></span><span class="cini">' + escHtml(ini) + '</span>'
            + '<span class="ccar" aria-hidden="true">\\u25BE</span></button>'
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
        // Compact trigger toggles the popover. The document-level outside-click / Escape closers are
        // registered ONCE per mount (below, after render()) — not here — so re-renders don't stack them.
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
          // Keep the light/dark toggle reachable even when signed out.
          + '<span style="display:inline-flex;align-items:center;gap:10px">'
          + themeToggleHtml(i)
          + '<button id="aimeat-login-btn" class="aimeat-sign-btn">'
          + (opts.buttonText || i.signInBtn || '\\u2764\\ufe0f Sign In') + '</button>'
          + '</span>';
        document.getElementById('aimeat-login-btn').addEventListener('click', () => {
          // On an app origin, the Sign In click is the user gesture that opens the consent popup
          // for a non-owned app (interactive). On the apex it's the normal owner login modal.
          if (isAppOrigin()) { restoreSessionFromAppOrigin(true).then((s) => { if (s) render(); }).catch(() => {}); }
          else { showLoginModal(opts, render); }
        });
      }
      wireThemeToggle(container, i); // present in both signed-in and signed-out markup
    }
    render();
    // Close the compact popover on an outside click or Escape. Registered ONCE per mount (looks up
    // the current wrap at event time, so it survives re-renders without stacking listeners). No-op
    // unless useCompact rendered a wrap.
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
    // Re-render when the session changes out-of-band — e.g. the H-2 silent SSO on an app origin
    // logs in asynchronously AFTER this button first painted "Sign In". Only re-render (do NOT call
    // opts.onLogin here — the interactive modal path already does, and apps often set onLogin to
    // location.reload(), which would loop with the auto silent login).
    auth.on('login', render);
    auth.on('logout', render);
    auth.on('session-updated', render); // live display-name (etc.) edits
    // Seamless SSO: on an app origin (*.apps.<domain>) with no session yet, attempt the silent
    // bridge ourselves so the owner's own app is logged in even if it never calls auth.login()
    // explicitly. Best-effort + idempotent: if the bridge yields a session it fires 'login' (→ the
    // button re-renders). On an app origin the persisted session is only a UI CACHE: the grant token
    // is short-lived, the apex session may have ended (logout), or the grant may have been revoked. So
    // ALWAYS re-confirm via the silent bridge on load — even when a cached session exists. That is how
    // the _app/gear metadata refreshes, and how a stale "logged in" clears after the user logs out of
    // aimeat.io. If the bridge cannot re-establish a session, drop the stale cache (no phantom login).
    if (isAppOrigin() && !currentSession) {
      restoreSessionFromAppOrigin(false).then((s) => {
        if (!s && load('session')) { remove('session'); emit('logout'); }
      }).catch(() => {});
    }
  },
};

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Theme toggle (travels with the login pill) ───────────────────────────────────────────────
// The light/dark switch lives INSIDE the login pill so every app that embeds the pill gets the
// toggle for free — no per-app theming code. Self-contained: it reads/writes the same
// 'aimeat-theme' localStorage key + <html data-theme> attribute the SPA uses, and dispatches an
// 'aimeat-theme-change' window event so the SPA's theme system (and any chart subscribers) stay
// in sync. In a standalone app (no SPA theme module) the data-theme + theme.css alone repaint.
var AIMEAT_THEME_KEY = 'aimeat-theme';

function aimeatReadTheme() {
  try { var s = localStorage.getItem(AIMEAT_THEME_KEY); if (s === 'light' || s === 'dark') return s; } catch (e) {}
  var attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function aimeatApplyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(AIMEAT_THEME_KEY, t); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('aimeat-theme-change', { detail: { theme: t } })); } catch (e) {}
}

function themeToggleHtml(i) {
  var dark = aimeatReadTheme() === 'dark';
  var title = dark ? (i.themeToLight || 'Switch to light mode') : (i.themeToDark || 'Switch to dark mode');
  return '<button id="aimeat-theme-toggle" class="aimeat-theme-toggle" title="' + escHtml(title) + '" '
    + 'aria-label="' + escHtml(title) + '" style="display:inline-flex;align-items:center;justify-content:center;'
    + 'width:30px;height:30px;flex:0 0 auto;background:transparent;border:1px solid rgba(127,127,127,.4);'
    + 'border-radius:8px;cursor:pointer;font-size:15px;line-height:1;padding:0;color:currentColor">'
    + (dark ? '\\u2600' : '\\u263E') + '</button>';
}

function wireThemeToggle(container, i) {
  var btn = container.querySelector('#aimeat-theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var next = aimeatReadTheme() === 'dark' ? 'light' : 'dark';
    aimeatApplyTheme(next);
    var dark = next === 'dark';
    btn.textContent = dark ? '\\u2600' : '\\u263E';
    var title = dark ? (i.themeToLight || 'Switch to light mode') : (i.themeToDark || 'Switch to dark mode');
    btn.title = title; btn.setAttribute('aria-label', title);
  });
}

// ── Compact login pill (opt-in via mountLoginButton({ compact:true })) ───────────────────────
// On viewports ≤600px the full gold pill is replaced by a small gold "account" button (green dot +
// initials + caret); tapping it opens the full pill as an anchored popover carrying the name, theme
// toggle, permissions gear and logout. Styles are injected once; the show/hide is pure CSS media so
// it reflows on rotation. Only apps that pass compact:true get this — bespoke navs are untouched.
function ensureAuthPillStyles() {
  if (document.getElementById('aimeat-auth-pill-css')) return;
  var st = document.createElement('style');
  st.id = 'aimeat-auth-pill-css';
  st.textContent = [
    '.aimeat-auth-wrap{position:relative;display:inline-flex;align-items:center}',
    '.aimeat-auth-compact{display:none;align-items:center;gap:7px;padding:5px 11px 5px 9px;cursor:pointer;',
      'background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);',
      'border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);',
      'border-radius:10px;box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4);',
      'font-family:system-ui;font-size:13px;color:#2a1800;text-shadow:0 1px 0 rgba(245,230,163,.5)}',
    '.aimeat-auth-compact .cdot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;',
      'background:radial-gradient(circle at 35% 35%,#b0ffc8,#00c853 40%,#00802e 80%,#003d15);box-shadow:0 0 5px rgba(0,200,83,.6)}',
    '.aimeat-auth-compact .cini{font-weight:800;letter-spacing:.3px;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.aimeat-auth-compact .ccar{font-size:9px;opacity:.75;transition:transform .18s}',
    '.aimeat-auth-wrap.aimeat-open .aimeat-auth-compact .ccar{transform:rotate(180deg)}',
    '@media (max-width:600px){',
      '.aimeat-auth-compact{display:inline-flex}',
      '.aimeat-auth-wrap>.aimeat-auth-pill{position:absolute;top:calc(100% + 8px);right:0;z-index:1000;',
        'display:none!important;flex-wrap:wrap!important;justify-content:flex-start;row-gap:9px;',
        'min-width:210px;max-width:calc(100vw - 24px)}',
      '.aimeat-auth-wrap.aimeat-open>.aimeat-auth-pill{display:flex!important}',
    '}'
  ].join('');
  (document.head || document.documentElement).appendChild(st);
}

// Two-letter initials for the compact button, from a display name / GHII / owner (strips the
// @node and #owner suffixes so a GAII/GHII shows the person, not the node).
function pillInitials(s) {
  s = (s || '').trim();
  if (!s) return '\\u2022'; // bullet fallback
  s = s.split('@')[0].split('#')[0].trim();
  var parts = s.split(/\\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

// ── Sign-in modal language helpers ──
// The modal can be shown standalone (e.g. a custom portal page) where the
// canonical header — and its language switcher — is not present. So the modal
// owns its own EN/FI switcher and can (re)load translations itself, using the
// same 'aimeat-lang' localStorage key + cookie the header uses, so the choice
// stays in sync with the SPA.
var MODAL_LANG_KEY = 'aimeat-lang';

function currentModalLang() {
  try {
    var u = new URLSearchParams(location.search).get('lang');
    if (u === 'en' || u === 'fi') return u;
    var s = localStorage.getItem(MODAL_LANG_KEY);
    if (s === 'en' || s === 'fi') return s;
  } catch (e) {}
  return (navigator.language || 'en').slice(0, 2).toLowerCase() === 'fi' ? 'fi' : 'en';
}

function flattenModalI18n(obj, prefix, out) {
  out = out || {}; prefix = prefix || '';
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var key = prefix ? prefix + '.' + k : k;
    var v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenModalI18n(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Fetch en.json (base) + <lang>.json (overrides) from the node and return just
// the modal.* strings with the 'modal.' prefix stripped — the shape the modal
// (and every mountLoginButton caller) expects for opts.i18n.
async function loadModalI18n(lang) {
  var v = Date.now();
  var t = {};
  try {
    var enRes = await fetch(NODE_URL + '/locales/en.json?v=' + v);
    if (enRes.ok) t = flattenModalI18n(await enRes.json());
  } catch (e) {}
  if (lang !== 'en') {
    try {
      var locRes = await fetch(NODE_URL + '/locales/' + lang + '.json?v=' + v);
      if (locRes.ok) {
        var loc = flattenModalI18n(await locRes.json());
        for (var lk in loc) if (Object.prototype.hasOwnProperty.call(loc, lk)) t[lk] = loc[lk];
      }
    } catch (e) {}
  }
  var out = {};
  for (var k in t) {
    if (Object.prototype.hasOwnProperty.call(t, k) && k.indexOf('modal.') === 0) out[k.slice(6)] = t[k];
  }
  return out;
}

function showLoginModal(opts, renderBtn) {
  var i = opts.i18n || {};
  var lang = currentModalLang();
  // Remove existing modal
  const old = document.getElementById('aimeat-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'aimeat-modal';

  // Capture typed values so they survive a re-render (language change).
  function captureInputs() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    return { u: g('aimeat-username'), p: g('aimeat-password'), d: g('aimeat-displayname') };
  }
  function restoreInputs(vals) {
    var s = function (id, val) { var el = document.getElementById(id); if (el && val) el.value = val; };
    s('aimeat-username', vals.u); s('aimeat-password', vals.p); s('aimeat-displayname', vals.d);
  }

  // Switch language: persist the choice (same key/cookie as the header), reload
  // translations, and re-render the modal in place — no full page reload, so the
  // user stays in the modal.
  function switchLang(next) {
    if (next === lang) return;
    try {
      localStorage.setItem(MODAL_LANG_KEY, next);
      document.cookie = 'aimeat-lang=' + next + ';path=/;max-age=31536000;SameSite=Lax';
    } catch (e) {}
    var vals = captureInputs();
    loadModalI18n(next).then(function (fresh) {
      lang = next;
      if (fresh && Object.keys(fresh).length) i = fresh;
      render(false);
      restoreInputs(vals);
    });
  }

  function render(anim) {
    modal.innerHTML = buildModalInner(i, lang, anim);
    wireModal();
  }

  document.body.appendChild(modal);
  render(true);

  // The host page passed opts.i18n in whatever language it had loaded. When the
  // modal is shown standalone that can be the wrong language; correct it to the
  // stored/preferred language by loading fresh translations and re-rendering
  // (only if they actually differ, to avoid a needless flicker).
  loadModalI18n(lang).then(function (fresh) {
    if (!fresh || !Object.keys(fresh).length) return;
    if (fresh.signInBtn === i.signInBtn && fresh.descNew === i.descNew) return;
    var vals = captureInputs();
    i = fresh;
    render(false);
    restoreInputs(vals);
  });

  function buildModalInner(i, lang, anim) {
   return '<style>'
    + '.aimeat-inp{width:100%;padding:11px 14px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:DM Sans,system-ui,sans-serif;font-size:15px;color:#1A1A2E;background:#FAFAF8;box-sizing:border-box;transition:all .15s;outline:none}'
    + '.aimeat-inp:focus{border-color:#E8564A;box-shadow:0 0 0 3px rgba(232,86,74,.1)}'
    + '.aimeat-inp::placeholder{color:#9CA3AF}'
    + '.aimeat-go{flex:1;padding:12px;background:linear-gradient(135deg,#E8564A,#D4493F);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:15px;font-family:DM Sans,system-ui,sans-serif;box-shadow:0 2px 8px rgba(232,86,74,.25);transition:transform .15s,box-shadow .15s}'
    + '.aimeat-go:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(232,86,74,.35)}'
    + '.aimeat-label{display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6B7280}'
    + '.aimeat-cancel{padding:12px 20px;background:none;color:#1A1A2E;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;font-size:15px;font-weight:500;font-family:DM Sans,system-ui,sans-serif;transition:background .15s}'
    + '.aimeat-cancel:hover{background:#F3F4F6}'
    + '.aimeat-fi{width:20px;height:20px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;margin-top:1px}'
    + '.aimeat-langsw{position:absolute;top:24px;right:28px;display:flex;gap:5px}'
    + '.aimeat-lang{padding:4px 9px;border:1px solid #E5E7EB;background:#fff;color:#6B7280;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.4px;line-height:1;font-family:DM Sans,system-ui,sans-serif;transition:all .15s}'
    + '.aimeat-lang:hover{border-color:#E8564A;color:#E8564A}'
    + '.aimeat-lang.active{background:#E8564A;color:#fff;border-color:#E8564A;cursor:default}'
    + '@keyframes aimeatModalIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}'
    + '</style>'
    + '<div style="position:fixed;inset:0;background:rgba(26,26,46,.4);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:DM Sans,system-ui,sans-serif;padding:24px">'
    + '<div style="background:#FFFFFF;border-radius:16px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15),0 0 0 1px rgba(0,0,0,.05);' + (anim ? 'animation:aimeatModalIn .3s ease' : '') + '">'
    // Header
    + '<div style="padding:28px 32px 0;position:relative">'
    + '<div class="aimeat-langsw">'
    + '<button type="button" class="aimeat-lang' + (lang === 'en' ? ' active' : '') + '" data-lang="en">EN</button>'
    + '<button type="button" class="aimeat-lang' + (lang === 'fi' ? ' active' : '') + '" data-lang="fi">FI</button>'
    + '</div>'
    + '<h2 style="margin:0;font-size:22px;font-weight:800;display:flex;align-items:center;gap:8px;color:#1A1A2E">'
    + 'AIME <span style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#E8564A,#D4493F);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:14px">\\u2665</span> AT Sign In'
    + '</h2>'
    + '<p style="margin:8px 0 0;font-size:14px;color:#6B7280;line-height:1.5">' + escHtml(i.descNew || 'New? Pick a username and password to create an account.') + ' ' + escHtml(i.descReturning || 'Already have an account? Enter your username and password.') + '</p>'
    + '</div>'
    // Body
    + '<div id="aimeat-modal-body" style="padding:24px 32px">'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.usernameLabel || 'Username') + '</label>'
    + '<input id="aimeat-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '"></div>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.passwordLabel || 'Password') + '</label>'
    + '<input id="aimeat-password" type="password" class="aimeat-inp" placeholder="' + escHtml(i.passwordPlaceholder || 'Password (min 4 chars)') + '"></div>'
    + '<div style="margin-bottom:14px"><label class="aimeat-label">' + escHtml(i.displayNameLabel || 'Display Name') + ' <span style="font-weight:400;text-transform:none;letter-spacing:0">(' + escHtml(i.displayNameHint || 'optional, for new accounts') + ')</span></label>'
    + '<input id="aimeat-displayname" class="aimeat-inp" placeholder="' + escHtml(i.displayNamePlaceholder || 'Display Name') + '"></div>'
    + '<div style="display:flex;gap:10px;margin-top:20px">'
    + '<button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i.signInBtn || 'Sign In / Register') + '</button>'
    + '<button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
    + '</div>'
    + '<p id="aimeat-error" style="margin:8px 0 0;font-size:13px;color:#ef4444;display:none"></p>'
    // Social login — one button per enabled OIDC provider (Google / Casdoor / Entra), baked from config
    + (AUTH_PROVIDERS.length ? (
        '<div style="display:flex;align-items:center;gap:12px;margin:18px 0 14px;color:#9CA3AF;font-size:12px;font-weight:600;letter-spacing:.5px">'
        + '<span style="flex:1;height:1px;background:#E5E7EB"></span>' + escHtml(i.orLabel || 'OR') + '<span style="flex:1;height:1px;background:#E5E7EB"></span>'
        + '</div>'
        + AUTH_PROVIDERS.map(function (p) {
`;
}
