/**
 * @file portfolio.js
 * @description Portfolio view — builder (select content, generate AI prompt,
 *   upload HTML) and public viewer (sandboxed iframe render).
 * @version-history
 *   v1.6.0 — 2026-07-13 — Split for max-file-lines: builder + prompt builder +
 *     shared helpers extracted to ./portfolio/{builder,prompt,shared}.js; this
 *     file keeps the public viewer and the mode-routing default export.
 *   v1.5.0 — 2026-07-03 — Portfolio origin surfaces: builder shows the standalone
 *     URL (<username>.portfolio.<apex>) + an aimeat-badge toggle (showBadge, saved
 *     to portfolio.config); viewer toolbar links to the standalone page. Both come
 *     from the server (standalone_url on /v1/portfolio/config and data/:username).
 *   v1.4.0 — 2026-07-03 — Viewer bridge: the trusted parent posts login state
 *     ('aimeat-portfolio-auth') into the sandboxed portfolio and serves a narrow
 *     fetch RPC ('aimeat-portfolio-fetch' → '...-fetch-result') that reads the
 *     portfolio owner's records with the VISITOR's session — enabling the new
 *     'members' memory visibility (logged-in-only content, never in the HTML).
 *     Requests are allowlisted to data.owner_gaiis; the visitor's JWT never
 *     enters the iframe. Prompt documents the protocol + members entries.
 *   v1.3.2 — 2026-07-03 — Builder prompt fixes for the sandboxed viewer reality:
 *     memory fetch URLs now use the anonymous public route /v1/memory/:gaii/:key
 *     (old /v1/memory/:key always 401s without auth) and only for public-visibility
 *     records; forbid credentialed fetch() (Origin:null + wildcard CORS rejects it);
 *     auth-gate pattern defaults to logged-out placeholder + listens for an
 *     'aimeat-portfolio-auth' postMessage instead of window.AIMEAT (unreachable
 *     from the opaque-origin sandbox).
 *   v1.3.1 — 2026-07-03 — Stamp the SPA's CSP nonce onto <script> tags before setting
 *     srcdoc (viewer + builder preview): about:srcdoc inherits the parent document's
 *     CSP (script-src 'self' 'nonce-…'), so the portfolio's nonce-less inline script
 *     never executed. The sandbox (opaque origin, no allow-same-origin) remains the
 *     security boundary — same trust level as the app-launch 'unsafe-inline' CSP.
 *   v1.3.0 — 2026-07-03 — Public viewer renders full-bleed: portfolio iframe fills the
 *     viewport below the nav (no more 900px column), slim toolbar with back link + owner
 *     name + a native Fullscreen button; drop the dead contentDocument autosize hack
 *     (opaque-origin sandbox always threw). Campsite: btn btn-* → btn-*.
 *   v1.2.0 — 2026-06-10 — Workflow round: ①②③ flow banner explains the AI-chat round-trip;
 *     group summaries show selected/total + select-all checkbox; Generate disabled with a hint
 *     when nothing is selected; "Custom" type and custom auth-gate open describe-textareas that
 *     feed the prompt; prompt output shows a character count; step 5 shows the publish URL,
 *     gains a sandboxed preview (same allow-scripts srcdoc sandbox as the public viewer) and an
 *     Unpublish in the published banner; bottom button says Profile (where it actually goes).
 *   v1.1.0 — 2026-06-02 — Migrate bespoke prompt-copy button to canonical CopyButton component
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { NODE_URL, tr, stampCspNonce, getSession } from './portfolio/shared.js';
import { PortfolioBuilder } from './portfolio/builder.js';


/* ── Viewer Component ── */
function PortfolioViewer({ username, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState(null);
  const frameRef = useRef(null);

  // ── Portfolio bridge ──
  // The sandboxed portfolio (opaque origin) cannot see the visitor's session.
  // This trusted parent brokers two things over postMessage:
  //   1. 'aimeat-portfolio-auth' {loggedIn} — posted on frame load + auth change,
  //      so HTML-baked [data-auth-required] sections can toggle (convenience).
  //   2. 'aimeat-portfolio-fetch' {gaii, key, id} → 'aimeat-portfolio-fetch-result'
  //      {id, ok, gaii, key, value} — the parent fetches the record with the
  //      VISITOR's JWT (which never enters the iframe) via the public read route,
  //      so 'members'-visibility records reach logged-in viewers only. Requests
  //      are allowlisted to the portfolio owner's identities (data.owner_gaiis)
  //      so portfolio JS cannot spend the visitor's token on anything else.
  const postAuthState = (win) => {
    // '*' targetOrigin: an opaque-origin frame is not addressable any other way;
    // the payload is just a boolean.
    win?.postMessage({ type: 'aimeat-portfolio-auth', loggedIn: !!getSession() }, '*');
  };

  useEffect(() => {
    if (!data?.has_html) return undefined;
    const ownerGaiis = Array.isArray(data.owner_gaiis) ? data.owner_gaiis : [];

    const onAuthChange = () => postAuthState(frameRef.current?.contentWindow);

    const onMessage = async (e) => {
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win) return; // only our portfolio frame
      const d = e.data;
      if (!d || d.type !== 'aimeat-portfolio-fetch') return;
      const reply = (ok, value) => win.postMessage({
        type: 'aimeat-portfolio-fetch-result',
        id: d.id ?? null, ok, gaii: d.gaii ?? null, key: d.key ?? null, value,
      }, '*');
      if (typeof d.gaii !== 'string' || typeof d.key !== 'string' || !ownerGaiis.includes(d.gaii)) {
        reply(false, null);
        return;
      }
      const s = getSession();
      try {
        const resp = await fetch(`/v1/memory/${encodeURIComponent(d.gaii)}/${encodeURIComponent(d.key)}`,
          s ? { headers: { Authorization: 'Bearer ' + s.jwt } } : undefined);
        const j = await resp.json().catch(() => null);
        const ok = !!(resp.ok && j && j.ok !== false);
        reply(ok, ok ? (j.data?.value ?? null) : null);
      } catch {
        reply(false, null);
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('aimeat-auth-change', onAuthChange);
    // aimeat-auth-change fires from the login pill's onLogout BEFORE the async
    // auth.logout() has cleared the session, so getSession() still reads the old
    // state at that moment. The auth lib's own 'login'/'logout' events fire only
    // AFTER the state change — subscribe to those too so the frame flips reliably.
    const authApi = window.AIMEAT?.auth;
    if (authApi?.on) {
      authApi.on('login', onAuthChange);
      authApi.on('logout', onAuthChange);
    }
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('aimeat-auth-change', onAuthChange);
      if (authApi?.off) {
        authApi.off('login', onAuthChange);
        authApi.off('logout', onAuthChange);
      }
    };
  }, [data]);

  useEffect(() => {
    fetch(`${NODE_URL}/v1/portfolio/data/${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(result => {
        if (result.ok === false) {
          setErrMsg(result.error?.message || 'Not found');
        } else {
          setData(result.data);
        }
        setLoading(false);
      })
      .catch(() => {
        setErrMsg('Network error');
        setLoading(false);
      });
  }, [username]);

  if (loading) return html`<div class="portfolio-container"><div class="view-loading">Loading portfolio...</div></div>`;

  if (errMsg || !data) {
    return html`
      <div class="portfolio-container">
        <div class="portfolio-not-found">
          <h2>${t('portfolio.viewer.notFound')}</h2>
          <p>${t('portfolio.viewer.notFoundDesc')}</p>
          <button class="btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
            ${t('portfolio.viewer.backToPortal')}
          </button>
        </div>
      </div>
    `;
  }

  // If portfolio HTML exists, render it full-bleed in a sandboxed iframe:
  // the frame fills the viewport below the nav + toolbar, the portfolio
  // scrolls inside it. The toolbar offers native fullscreen for a truly
  // chrome-free view (Esc exits).
  if (data.has_html && data.portfolio_html) {
    return html`
      <div class="portfolio-viewer-full">
        <div class="portfolio-viewer-bar">
          <button class="btn-ghost btn-sm" onClick=${() => navigate('/v1/portal')}>
            ← ${t('portfolio.viewer.backToPortal')}
          </button>
          <span class="portfolio-viewer-owner">${escHtml(data.display_name || username)}'s portfolio</span>
          ${data.standalone_url && html`
            <a class="btn-ghost btn-sm" href=${data.standalone_url} target="_blank" rel="noopener">
              ${tr('portfolio.viewer.standalone', 'Own address')} ↗
            </a>
          `}
          <button class="btn-ghost btn-sm portfolio-viewer-fs"
            title=${tr('portfolio.viewer.fullscreen', 'Fullscreen')}
            onClick=${() => frameRef.current?.requestFullscreen?.()}>
            ⛶ ${tr('portfolio.viewer.fullscreen', 'Fullscreen')}
          </button>
        </div>
        <iframe ref=${frameRef} class="portfolio-viewer-frame portfolio-viewer-frame-full"
          srcdoc=${stampCspNonce(data.portfolio_html)} sandbox="allow-scripts"
          onLoad=${(e) => postAuthState(e.target.contentWindow)}></iframe>
      </div>
    `;
  }

  // No portfolio HTML — show basic profile info
  return html`
    <div class="portfolio-container">
      <div class="portfolio-not-found">
        <h2>${escHtml(data.display_name || username)}</h2>
        <p>${data.bio ? escHtml(data.bio) : t('portfolio.viewer.notFoundDesc')}</p>
        <button class="btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
          ${t('portfolio.viewer.backToPortal')}
        </button>
      </div>
    </div>
  `;
}


/* ── Main Export ── */
export default function Portfolio({ navigate }) {
  const [session, setSession] = useState(null);

  useEffect(() => {
    const s = getSession();
    if (s) setSession(s);
    const handler = () => setSession(getSession());
    window.addEventListener('aimeat-auth-change', handler);
    return () => window.removeEventListener('aimeat-auth-change', handler);
  }, []);

  // Determine mode from URL
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const match = path.match(/^\/v1\/portfolio\/(.+)$/);
  const username = match ? decodeURIComponent(match[1]) : null;

  // /v1/portfolio/:username → viewer mode
  if (username) {
    return html`<${PortfolioViewer} username=${username} navigate=${navigate} />`;
  }

  // /v1/portfolio → builder mode (requires auth)
  return html`<${PortfolioBuilder} session=${session} navigate=${navigate} />`;
}
