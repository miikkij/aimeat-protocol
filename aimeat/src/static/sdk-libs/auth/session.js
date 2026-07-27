/**
 * @file auth/session.js
 * @description aimeat-auth stateful core (SDK-libs migration Phase 3). Holds the mutable module state
 *   (currentSession / refreshTimer / ownerRefreshInFlight / in-flight guards) so every reassignment
 *   stays in ONE module — no cross-module setter plumbing. Contains: api/authApi; the session object
 *   factory + persistence + refresh scheduling; the H-2 app-origin seamless SSO (silent same-site
 *   bridge, scope-drift self-heal, apex logout, PKCE consent popup); and the full AIMEAT.auth public
 *   API. The UI methods delegate out — mountLoginButton → pill.js, showLoginModal → modal.js (circular
 *   imports, resolved at call time). Merges the session code from auth-lib-part1/2/3.ts.
 * @structure state · api/authApi · persistSession/restoreSessionFromCookie · isAppOrigin/appScopeDrift/
 *   silentAppToken/apexLogout/PKCE consent/_buildAppSession/restoreSessionFromAppOrigin ·
 *   scheduleAutoRefresh/createSession · refreshOnFocus · the `auth` object.
 * @usage import { auth, api, isAppOrigin, restoreSessionFromAppOrigin } from './session.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Merged from src/routes/libs/auth-lib-part1/2/3.ts (SDK-libs migration Phase 3).
 */
import { importEd25519Key, storeKey, loadKey, deleteKey, migrateKeysToIndexedDB, sign, save, load, remove, parseJwt, isExpired } from './crypto.js';
import { NODE_URL, APEX_URL, NODE_ID, appDeclaredScopes } from './config.js';
import { emit, on, off } from './events.js';
import { mountPill } from './pill.js';
import { showLoginModal } from './modal.js';

// ── Module state (every reassignment lives in this file) ──
/** @type {any} */ let currentSession = null;
/** @type {any} */ let refreshTimer = null;
/** @type {any} */ let ownerRefreshInFlight = null; // shared promise so concurrent owner refreshes don't each rotate
/** @type {any} */ let _appOriginLoginInFlight = null;
/** @type {any} */ let focusRefreshInFlight = null;

// ── API helpers ──

export async function api(path, opts = {}) {
  const url = NODE_URL + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const resp = await fetch(url, { ...opts, headers });
  const data = await resp.json();
  if (!data.ok) {
    // Preserve the machine-readable code + details on the thrown Error so callers can branch
    // (e.g. EMAIL_NOT_VERIFIED → open the email-completion flow) instead of matching on text.
    const err = /** @type {Error & { code?: string, details?: unknown }} */ (new Error(data.error?.message || 'API error'));
    err.code = data.error?.code;
    err.details = data.error?.details;
    throw err;
  }
  return data;
}

export async function authApi(path, jwt, opts = {}) {
  return api(path, { ...opts, headers: { ...opts.headers, 'Authorization': 'Bearer ' + jwt } });
}

// ── Session persistence ──

// Persist non-secret session metadata (+ short-lived access token) to localStorage.
// The long-lived refresh token is an httpOnly cookie and is never readable here.
export function persistSession(session) {
  save('session', {
    owner: session.owner, gaii: session.gaii, ghii: session.ghii,
    jwt: session.jwt, publicKey: session.publicKey, roles: session.roles,
    displayName: session.displayName || '',
    federated: session.federated || false,
    homeNode: session.homeNode || '',
    homeUrl: session.homeUrl || '',
    // H-2 app-origin grant session metadata (drives the consent gear on the login pill).
    _appOrigin: session._appOrigin || false,
    _app: session._app || null,
    _own: session._own || false,
  });
}

// Restore a session purely from the httpOnly refresh cookie, with NO local metadata. Makes the app
// boot "logged in" when a cookie exists but localStorage is empty. Returns null when no usable cookie.
export async function restoreSessionFromCookie() {
  try {
    const data = await api('/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-AIMEAT-Refresh': '1' },
    });
    const token = data && data.data && data.data.token;
    if (!token) return null;
    const payload = parseJwt(token) || {};
    const ownerName = payload.owner || payload.sub;
    if (!ownerName) return null;
    const session = createSession({
      owner: ownerName,
      ghii: String(ownerName).indexOf('@') >= 0 ? ownerName : (ownerName + '@' + NODE_ID),
      gaii: null,
      jwt: token,
      roles: payload.roles || [],
      displayName: '',
    });
    persistSession(session);
    currentSession = session;
    scheduleAutoRefresh(session);
    emit('login', session);
    return session;
  } catch {
    return null;
  }
}

// ── App-origin seamless SSO (H-2) ──
// When this SDK runs on an APP ORIGIN (a *.apps.<domain> host, different from the node/apex), the
// host-only session cookie can't be read directly. The same-site silent bridge (a hidden iframe to
// the apex, where the cookie IS first-party) mints a SCOPED, revocable grant token and posts it back.
export function isAppOrigin() {
  try { return location.origin !== new URL(APEX_URL).origin; } catch { return false; }
}

// Scopes the app DECLARES that this app-origin session's token does NOT carry — the self-heal signal.
function appScopeDrift(session) {
  if (!session || !session._appOrigin || !session.jwt) return [];
  var have = (parseJwt(session.jwt) || {}).scopes || [];
  return appDeclaredScopes().split(' ').filter(function (s) { return s && have.indexOf(s) < 0; });
}

function silentAppToken() {
  return new Promise(function (resolve) {
    var apexOrigin;
    try { apexOrigin = new URL(APEX_URL).origin; } catch { resolve(null); return; }
    if (location.origin === apexOrigin) { resolve(null); return; }
    var settled = false, iframe = null, timer = null;
    function finish(v) {
      if (settled) return; settled = true;
      window.removeEventListener('message', onMsg);
      if (timer) clearTimeout(timer);
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve(v);
    }
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_login') return;
      // Return the FULL result (token on success, or { error:'consent_required', app, scope }) so the
      // caller can launch the visible consent popup). null only when the bridge produced nothing.
      finish(d.result || null);
    }
    window.addEventListener('message', onMsg);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apexOrigin + '/app-silent.html?scope=' + encodeURIComponent(appDeclaredScopes());
    (document.body || document.documentElement).appendChild(iframe);
    timer = setTimeout(function () { finish(null); }, 8000);
  });
}

// End the shared apex session from an APP ORIGIN (frames the same-site apex bridge in ?mode=logout).
export function apexLogout() {
  return new Promise(function (resolve) {
    var apexOrigin;
    try { apexOrigin = new URL(APEX_URL).origin; } catch { resolve(false); return; }
    if (location.origin === apexOrigin) { resolve(false); return; }
    var settled = false, iframe = null, timer = null;
    function finish(v) {
      if (settled) return; settled = true;
      window.removeEventListener('message', onMsg);
      if (timer) clearTimeout(timer);
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve(v);
    }
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_logout') return;
      finish(!!(d.result && d.result.ok));
    }
    window.addEventListener('message', onMsg);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = apexOrigin + '/app-silent.html?mode=logout';
    (document.body || document.documentElement).appendChild(iframe);
    timer = setTimeout(function () { finish(false); }, 8000);
  });
}

// ── App-grant consent popup (H-2, PKCE code flow) ──
function _b64url(buf) {
  var bytes = new Uint8Array(buf), s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function _pkce() {
  var verifier = _b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  if (crypto.subtle && crypto.subtle.digest) {
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier: verifier, challenge: _b64url(digest), method: 'S256' };
  }
  // Non-secure context (http on a non-localhost host): crypto.subtle is unavailable. Fall back to
  // PKCE "plain". Acceptable — such transport is already non-confidential; real app origins are https.
  return { verifier: verifier, challenge: verifier, method: 'plain' };
}
export async function requestConsentPopup(app, scopeStr, manage) {
  var apexOrigin;
  try { apexOrigin = new URL(APEX_URL).origin; } catch { return null; }
  var p = await _pkce();
  var state = _b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  var redirectUri = location.origin + '/'; // app origin; never navigated in web_message mode (origin binding only)
  var scope = scopeStr || appDeclaredScopes();
  // manage=1 → the consent page always shows the management screen (the gear).
  var url = apexOrigin + '/v1/app-grants/authorize?response_type=code&response_mode=web_message'
    + (manage ? '&manage=1' : '')
    + '&app=' + encodeURIComponent(app)
    + '&scope=' + encodeURIComponent(scope)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&code_challenge=' + encodeURIComponent(p.challenge)
    + '&code_challenge_method=' + encodeURIComponent(p.method)
    + '&state=' + encodeURIComponent(state);
  var w = 460, h = 660;
  var left = (window.screen && window.screen.width ? (window.screen.width - w) / 2 : 0);
  var top = (window.screen && window.screen.height ? (window.screen.height - h) / 2 : 0);
  var popup = window.open(url, 'aimeat_consent', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
  if (!popup) {
    // Popup blocked (no user activation / aggressive blocker). Fail LOUDLY so the app can react.
    try { console.warn('[aimeat-auth] consent popup blocked — app-origin sign-in needs a real user click (user activation). Synthetic/automated clicks cannot open the consent window.'); } catch { /* no console */ }
    emit('popup-blocked', { app: app });
    return null;
  }
  var msg = await new Promise(function (resolve) {
    var done = false, iv = null;
    function onMsg(e) {
      if (e.origin !== apexOrigin) return;
      var d = e.data || {};
      if (d.type !== 'aimeat_app_grant' || d.state !== state) return;
      done = true; cleanup(); resolve(d);
    }
    function cleanup() { window.removeEventListener('message', onMsg); if (iv) clearInterval(iv); }
    window.addEventListener('message', onMsg);
    iv = setInterval(function () { if (popup.closed && !done) { cleanup(); resolve(null); } }, 500);
  });
  if (msg && msg.revoked) return { revoked: true };       // user revoked from the consent screen
  if (!msg || !msg.code) return null;                     // denied / closed
  try {
    var resp = await fetch(apexOrigin + '/v1/app-grants/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: msg.code, code_verifier: p.verifier, redirect_uri: redirectUri }),
    });
    var j = await resp.json();
    return (j && j.ok && j.data && j.data.access_token) ? j.data : null;
  } catch { return null; }
}

// Build + install an app-origin session from a freshly issued grant access token.
export function _buildAppSession(accessToken, appId, own, displayName) {
  var payload = parseJwt(accessToken) || {};
  var ownerName = payload.owner || payload.sub;
  if (!ownerName) return null;
  var session = createSession({
    owner: ownerName,
    ghii: String(ownerName).indexOf('@') >= 0 ? ownerName : (ownerName + '@' + NODE_ID),
    gaii: null, jwt: accessToken, roles: payload.roles || [], displayName: displayName || '',
  });
  session._appOrigin = true;
  session._app = appId || null;
  session._own = !!own;
  persistSession(session);
  currentSession = session;
  scheduleAutoRefresh(session);
  emit('login', session);
  return session;
}

// Shared in-flight promise so concurrent callers reuse a single silent bridge instead of two iframes.
export function restoreSessionFromAppOrigin(interactive) {
  if (currentSession) return Promise.resolve(currentSession);
  if (_appOriginLoginInFlight) return _appOriginLoginInFlight;
  _appOriginLoginInFlight = (async function () {
    var r = await silentAppToken();
    var grant = (r && r.ok && r.access_token) ? r : null;
    var appId = (r && r.app) || null;
    var own = !!(r && r.own);
    // consent_required → not granted yet; login_required → not logged into the apex; invalid_scope
    // → the app declares a scope the STORED grant lacks, which is what publishing a new
    // <meta name="aimeat-scopes"> does. All three take the same visible popup, on a user gesture.
    // invalid_scope was missing, and its absence locked an owner out of their OWN app: Sign In did
    // nothing at all and the only escape was republishing without the scope. An upgrade must ASK.
    if (!grant && interactive && r && r.app
      && (r.error === 'consent_required' || r.error === 'login_required' || r.error === 'invalid_scope')) {
      appId = r.app;
      grant = await requestConsentPopup(r.app, r.scope);
      // login_required hits OWN apps too — the token exchange reports own/app itself, so trust it.
      own = !!(grant && grant.own);
      if (grant && grant.app) appId = grant.app;
    }
    if (!grant || !grant.access_token) return null;
    return _buildAppSession(grant.access_token, appId, own, grant.display_name);
  })();
  _appOriginLoginInFlight.finally(function () { _appOriginLoginInFlight = null; });
  return _appOriginLoginInFlight;
}

export function scheduleAutoRefresh(session) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!session?.jwt) return;
  try {
    const payload = JSON.parse(atob(session.jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return;
    // Refresh 5 minutes before expiry (or immediately if less than 5 min left)
    const msUntilExpiry = (payload.exp * 1000) - Date.now();
    const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 10_000); // min 10s
    refreshTimer = setTimeout(async () => {
      try {
        await session.refresh();
        emit('refreshed', session);
        scheduleAutoRefresh(session); // Schedule next refresh
      } catch (e) {
        console.warn('[aimeat-auth] Auto-refresh failed:', e.message);
        emit('expired', { reason: 'refresh_failed', error: e.message });
      }
    }, refreshIn);
  } catch { /* invalid JWT, skip scheduling */ }
}

export function createSession(data) {
  const jwtPayload = data.jwt ? parseJwt(data.jwt) : null;
  // owner MUST be a string (or null): downstream code calls owner.split (identicon avatar). Coerce here.
  let ownerVal = data.owner;
  if (ownerVal != null && typeof ownerVal !== 'string') {
    ownerVal = (typeof ownerVal === 'object' && typeof ownerVal.name === 'string') ? ownerVal.name : String(ownerVal);
  }
  // ghii MUST be a string (or null): downstream calls ghii.split('@'). Some writers persisted the whole
  // ghii object; extract the string at the one funnel every path goes through.
  let ghiiVal = data.ghii;
  if (ghiiVal != null && typeof ghiiVal !== 'string') {
    ghiiVal = (typeof ghiiVal === 'object' && typeof ghiiVal.ghii === 'string') ? ghiiVal.ghii : String(ghiiVal);
  }
  const session = /** @type {Record<string, any>} */ ({
    ghii: ghiiVal || null,
    owner: ownerVal,
    gaii: data.gaii || null,
    identity: data.gaii || ghiiVal || null,
    jwt: data.jwt,
    roles: jwtPayload?.roles || data.roles || [],
    displayName: data.displayName || '',
    // SECURITY: Private keys are non-extractable CryptoKeys in IndexedDB, NOT here. _cryptoKey = in-memory ref only.
    _cryptoKey: data._cryptoKey || null,
    publicKey: data.publicKey,
    nodeUrl: NODE_URL,
    federated: data.federated || false,
    homeNode: data.homeNode || '',
    homeUrl: data.homeUrl || '',

    // Authenticated fetch wrapper — returns parsed JSON without throwing on error so callers
    // (e.g. AIMEAT.data.get) can inspect res.ok / res.error themselves.
    async fetch(path, opts = {}) {
      if (isExpired(session.jwt)) {
        await session.refresh();
      }
      const url = NODE_URL + path;
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.jwt, ...(opts.headers || {}) };
      const resp = await fetch(url, { ...opts, headers });
      // Scope-drift self-heal (H-2): a 403 on an app-origin session whose token is missing scopes the
      // app now DECLARES → one silent bridge re-run upgrades the owner's own app in place; else emit
      // 'scopes-stale'. One attempt per session — never a retry loop.
      if (resp.status === 403 && session._appOrigin && !session._scopeHealTried) {
        var missing = appScopeDrift(session);
        if (missing.length) {
          session._scopeHealTried = true;
          var t = await silentAppToken();
          if (t && t.ok && t.access_token && !appScopeDrift({ _appOrigin: true, jwt: t.access_token })) {
            session.jwt = t.access_token;
            persistSession(session);
            scheduleAutoRefresh(session);
            var retry = await fetch(url, { ...opts, headers: { ...headers, 'Authorization': 'Bearer ' + session.jwt } });
            return retry.json();
          }
          emit('scopes-stale', { app: session._app || null, missing: missing });
        }
      }
      return resp.json();
    },

    // Notify the signed-in owner (header bell + browser push if subscribed).
    async notify(title, opts = {}) {
      return session.fetch('/v1/notifications', {
        method: 'POST',
        body: JSON.stringify({ title, body: opts.body, link: opts.link, type: opts.type }),
      });
    },

    // Get a fresh access token. Owner sessions use the httpOnly refresh cookie; agent sessions
    // re-sign with their IndexedDB key. Concurrent owner refreshes share one in-flight request.
    async refresh() {
      // App-origin sessions re-mint via the silent bridge (the apex cookie isn't reachable here).
      if (session._appOrigin) {
        var t = await silentAppToken();
        if (!t || !t.access_token) throw new Error('App session expired — the owner is not logged in on the node.');
        session.jwt = t.access_token;
        session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
        persistSession(session);
        scheduleAutoRefresh(session);
        return session;
      }
      // Federated sessions can't self-refresh yet — user must re-login.
      if (session.federated) {
        throw new Error('Federated session expired. Please log in again.');
      }

      if (session.gaii) {
        // Agent session — legacy key-signing refresh.
        const key = session._cryptoKey || await loadKey('agent_key');
        if (!key) throw new Error('Cannot refresh — no signing key found in IndexedDB');
        const timestamp = new Date().toISOString();
        const signature = await sign(key, session.gaii + timestamp);
        const d2 = await api('/v1/auth/token', {
          method: 'POST',
          body: JSON.stringify({ gaii: session.gaii, timestamp, signature }),
        });
        session.jwt = d2.data.token;
        session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
        persistSession(session);
        scheduleAutoRefresh(session);
        return session;
      }

      // Owner session — httpOnly refresh-cookie rotation (single-flight).
      if (ownerRefreshInFlight) return ownerRefreshInFlight;
      ownerRefreshInFlight = (async () => {
        const resp = await fetch(NODE_URL + '/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-AIMEAT-Refresh': '1' },
        });
        let data2 = null;
        try { data2 = await resp.json(); } catch { /* no body */ }
        if (!resp.ok || !data2 || data2.ok === false) {
          throw new Error(data2?.error?.message || 'Session refresh failed');
        }
        session.jwt = data2.data.token;
        session.roles = (parseJwt(session.jwt) || {}).roles || session.roles || [];
        // The refreshed token is AUTHORITATIVE for identity. If it is for a different owner than the
        // persisted session, adopt the owner + GHII from the token (else a stale identity shows).
        var freshClaims = parseJwt(session.jwt) || {};
        if (freshClaims.owner && freshClaims.owner !== session.owner) {
          session.owner = freshClaims.owner;
          if (freshClaims.node) session.ghii = freshClaims.owner + '@' + freshClaims.node;
          session.identity = session.gaii || session.ghii || null;
        }
        // Adopt the fresh display name the server returns so the pill stays current without a re-login.
        if (typeof data2.data.display_name === 'string') session.displayName = data2.data.display_name;
        persistSession(session);
        scheduleAutoRefresh(session);
        return session;
      })();
      try { return await ownerRefreshInFlight; }
      finally { ownerRefreshInFlight = null; }
    },

    // Check if session is valid
    get valid() { return session.jwt && !isExpired(session.jwt); },
  });
  return session;
}

// ── Refresh on focus / visibility ──
// The auto-refresh setTimeout fires 5 min before expiry, but timers do NOT fire while the machine is
// asleep or the tab is frozen. Re-check the token whenever the tab regains visibility/focus.
export function refreshOnFocus() {
  const session = currentSession;
  if (!session || !session.jwt || session.federated) return;
  const payload = parseJwt(session.jwt);
  if (!payload || !payload.exp) return;
  const msUntilExpiry = (payload.exp * 1000) - Date.now();
  if (msUntilExpiry > 5 * 60 * 1000) return; // still comfortably valid
  if (focusRefreshInFlight) return; // focus + visibilitychange can both fire — de-dupe
  const wasExpired = msUntilExpiry <= 0;
  focusRefreshInFlight = session.refresh()
    .then(() => { emit('refreshed', session); })
    .catch((e) => {
      console.warn('[aimeat-auth] Focus refresh failed:', e.message);
      // Only declare the session dead if the token had actually expired.
      if (wasExpired) emit('expired', { reason: 'refresh_failed', error: e.message });
    })
    .finally(() => { focusRefreshInFlight = null; });
}

// ── Public API ──

export const auth = {
  nodeUrl: NODE_URL,
  nodeId: NODE_ID,

  /**
   * Register a new human identity (GHII) and get an authenticated session.
   * @returns {Promise<object>} Session object with .fetch(), .refresh(), .jwt, .ghii
   */
  async register(username, displayName, opts = {}) {
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

    // With a password, establish a cookie-backed session via the login endpoint.
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
   * @returns {Promise<object|null>} Session or null if no stored credentials
   */
  async login(username) {
    // On an app origin the host-only cookie is unreachable; use the same-site silent bridge (H-2).
    // Non-interactive (no popup) — login() is commonly called on boot, not from a user gesture.
    if (isAppOrigin()) return await restoreSessionFromAppOrigin(false);
    const stored = load('session');
    // No local metadata — but an httpOnly refresh cookie may exist. Restore from the cookie alone.
    if (!stored) return await restoreSessionFromCookie();
    if (username && stored.owner !== username) return null;

    // SECURITY: Run one-time migration from localStorage to IndexedDB
    await migrateKeysToIndexedDB();

    // Migrate old agent sessions to owner sessions.
    if (stored.gaii) {
      stored.gaii = null;
    }

    const cryptoKey = stored.gaii ? await loadKey('agent_key') : await loadKey('owner_key');
    const session = createSession({ ...stored, _cryptoKey: cryptoKey });

    // Owner-local sessions ALWAYS refresh on boot (the httpOnly cookie is the source of truth).
    const isOwnerLocal = !session.federated && !session.gaii;
    if (isOwnerLocal || isExpired(session.jwt)) {
      try {
        await session.refresh();
      } catch {
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
   * @returns {Promise<object>} Session object
   */
  async loginWithPassword(username, password) {
    // Owner sessions refresh via the httpOnly cookie, so no signing key is needed. credentials:'include'
    // lets the server set the refresh cookie.
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

    // First sign-in of a provisioned-code account issues durable credentials in the response.
    // Expose them once on the returned session (NOT persisted) so the entry surface can show them.
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
   * Patch mutable, non-secret session metadata in place (e.g. displayName after a profile edit),
   * persist it, and notify the login pill so it re-renders live — no page reload.
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
    } catch { /* best effort — still clear local state below */ }
    // On an app origin, end the apex session too so EXIT sticks across the whole family.
    if (isAppOrigin()) { try { await apexLogout(); } catch { /* best effort */ } }
    currentSession = null;
    remove('session');
    remove('owner_key');
    // SECURITY: Delete CryptoKeys from IndexedDB
    await deleteKey('agent_key');
    await deleteKey('owner_key');
    emit('logout');
  },

  /**
   * Re-open the consent screen for the current app (H-2 in-app grant management).
   */
  async manageGrant() {
    const s = currentSession || load('session');
    if (!s || !s._app) return null;
    const res = await requestConsentPopup(s._app, appDeclaredScopes(), true);
    if (res && res.revoked) { await auth.logout(); return { revoked: true }; }
    if (res && res.access_token) return _buildAppSession(res.access_token, res.app || s._app, res.own != null ? !!res.own : s._own);
    return null;
  },

  /** True when running inside a published app on its isolated origin (not the apex). */
  isAppOrigin() { return isAppOrigin(); },

  /** Open the sign-in modal (password + Google if configured). */
  showLoginModal(opts) { showLoginModal(opts || {}, function () {}); },

  /** Check if there are stored credentials */
  get hasSession() { return !!load('session'); },

  /** Get stored GHII without authenticating */
  get storedGhii() { const s = load('session'); return s?.ghii || null; },

  /** Register an event listener */
  on(event, fn) { on(event, fn); },

  /** Remove an event listener */
  off(event, fn) { off(event, fn); },

  /** Check if running inside a sandboxed iframe (no localStorage access) */
  get inSandbox() {
    try { localStorage.getItem('_test'); return false; } catch { return true; }
  },

  /**
   * Request auth credentials from the parent window via postMessage (sandboxed-iframe fallback).
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

        const effectiveNodeUrl = parentNodeUrl || NODE_URL;

        const session = /** @type {Record<string, any>} */ ({
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
        });

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

  // Capability flag so an embedding app can feature-detect the compact login pill.
  compactPill: true,

  /**
   * Mount a login/register button that handles the full flow. Delegates the render to pill.js.
   * @param {string|Element|object} selector - CSS selector, DOM element, OR (options-first) the opts.
   * @param {object} [opts] - { onLogin, onLogout, buttonText, compact }.
   */
  mountLoginButton(selector, opts = {}) {
    return mountPill(auth, selector, opts);
  },
};
