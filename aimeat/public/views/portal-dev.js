/**
 * @file portal-dev.js
 * @description Portal Dev view module — developer onboarding wizard (select
 *   platform → variant → connection type → share app). Composes background,
 *   panels, and upload sub-modules (extracted to satisfy max-file-lines).
 * @version-history
 *   v1.1.0 — 2026-06-02 — Component unification (#11): node-badge dot uses
 *     canonical <StatusDot status="online" /> instead of bespoke .dv-dot
 *     (which had a hardcoded #22c55e — now tokenized via the component).
 *   v1.1.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.2.0 — 2026-07-13 — Split into sibling modules (shared/background/panels/
 *     upload) to satisfy max-file-lines; render output unchanged.
 *   v1.3.0 — 2026-07-14 — Add a source-repos row at the top: GitHub links to
 *     aimeat-protocol + crewaimeat, each with the GitHub Octocat mark.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useViewCSS } from '/components/useViewCSS.js';
import { StatusDot } from '/components/StatusDot.js';
import { html, NODE_URL, dt, CopyBtn } from './portal-dev.shared.js';
import { BackgroundLayer, BgSelector } from './portal-dev.background.js';
import { CapTabs } from './portal-dev.panels.js';
import { UploadSection, CommunityApps } from './portal-dev.upload.js';

// The familiar GitHub "Octocat" mark. fill=currentColor so it inherits the link's themed color.
const GH_MARK = html`<svg class="gh-mark" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`;

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */
export default function PortalDevView({ locale }) {
  const [platforms, setPlatforms] = useState([]);
  const [stats, setStats] = useState({ agents: 0, chatSessions: 0, actions: 0, boards: 0 });
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [activeBg, setActiveBg] = useState(3);
  const [session, setSession] = useState(null);

  useViewCSS('/css/views/portal-dev.css');

  const isLoggedIn = !!session;

  // Auth
  useEffect(() => {
    const auth = window.AIMEAT?.auth;
    if (!auth) return;
    const checkSession = () => {
      const s = typeof auth.getSession === 'function' ? auth.getSession() : null;
      setSession(s && s.jwt ? s : null);
    };
    checkSession();
    window.addEventListener('aimeat-auth-change', checkSession);
    return () => window.removeEventListener('aimeat-auth-change', checkSession);
  }, []);

  // Load platforms + stats
  useEffect(() => {
    fetch('/v1/portal/platforms')
      .then(r => r.json())
      .then(d => { if (d.ok) setPlatforms(d.data.platforms); })
      .catch(() => {});

    fetch('/v1/stats')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.data) {
          setStats({
            agents: d.data.agents || 0,
            chatSessions: d.data.chatSessions || d.data.chat_sessions || 0,
            actions: d.data.actions || d.data.services || 0,
            boards: d.data.boards || 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.title = dt('title', locale) + ' \u2014 AIMEAT';
  }, [locale]);

  const handleSelectPlatform = useCallback((p) => {
    setSelectedPlatform(p);
    setSelectedVariant(null);
    if (p.variants.length === 1) setSelectedVariant(p.variants[0]);
  }, []);

  return html`
    <${BackgroundLayer} activeBg=${activeBg} />
    <${BgSelector} activeBg=${activeBg} onChange=${setActiveBg} />

    <div class="dv-container">
      <h1>\ud83d\udc96 ${dt('title', locale)}</h1>
      <p class="dv-subtitle">${dt('subtitle', locale)}</p>
      <div class="dv-node-badge"><${StatusDot} status="online" /> ${NODE_URL}</div>

      <!-- Source repos: the protocol/node and the local agent fleet, both on GitHub -->
      <div class="dv-repos">
        <a class="dv-repo-link" href="https://github.com/miikkij/aimeat-protocol" target="_blank" rel="noopener">${GH_MARK}${dt('repos.protocol', locale)}</a>
        <a class="dv-repo-link" href="https://github.com/miikkij/crewaimeat" target="_blank" rel="noopener">${GH_MARK}${dt('repos.crew', locale)}</a>
      </div>

      <!-- Stats -->
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-card-value accent">${stats.agents}</div><div class="stat-card-label">${dt('stats.agents', locale)}</div></div>
        <div class="stat-card"><div class="stat-card-value accent">${stats.chatSessions}</div><div class="stat-card-label">${dt('stats.chatSessions', locale)}</div></div>
        <div class="stat-card"><div class="stat-card-value accent">${stats.actions}</div><div class="stat-card-label">${dt('stats.services', locale)}</div></div>
        <div class="stat-card"><div class="stat-card-value accent">${stats.boards}</div><div class="stat-card-label">${dt('stats.boards', locale)}</div></div>
      </div>

      <!-- Mode notice -->
      ${isLoggedIn
        ? html`<div class="dv-mode-notice dv-mode-notice-user"><div class="dv-notice-icon">\u2705</div><div><strong>${dt('mode.loggedIn', locale)} ${session?.ghii || session?.owner || ''}</strong><br/><span style="color:var(--muted);font-size:.85rem">${dt('mode.loggedInDesc', locale)}</span></div></div>`
        : html`<div class="dv-mode-notice dv-mode-notice-anon"><div class="dv-notice-icon">\ud83d\udc64</div><div><strong>${dt('mode.anonymous', locale)}</strong> \u2014 ${dt('mode.anonymousDesc', locale)}<br/><span style="color:var(--muted);font-size:.85rem">${dt('mode.anonymousNote', locale)} <strong>${dt('mode.signUp', locale)}</strong> ${dt('mode.signUpNote', locale)}</span></div></div>`
      }

      <!-- Quick Start -->
      <div class="dv-panel" style="border-color:var(--love1,#E8564A);background:var(--bg-card)">
        <h3 style="margin-bottom:.5rem">\ud83d\ude80 ${dt('quickStart.title', locale)}</h3>
        <p style="margin-bottom:.5rem">${dt('quickStart.desc', locale)}</p>
        <div class="dv-prompt-output" style="margin-bottom:0">
          <${CopyBtn} text=${'Read this URL and follow the instructions to connect to this AIMEAT node: ' + NODE_URL + '/?format=json'} locale=${locale} />
          <div class="dv-prompt-text" style="max-height:none;font-size:.85rem">Read this URL and follow the instructions to connect to this AIMEAT node: ${NODE_URL}/?format=json</div>
        </div>
        <p style="margin-top:.75rem;font-size:.8rem;color:var(--muted)">${dt('quickStart.note', locale)}<br/>${dt('quickStart.fallback', locale)}</p>
      </div>

      <!-- Step 1: Platform -->
      <div class="dv-step">
        <div class="dv-step-header">
          <div class=${`dv-step-num ${selectedPlatform ? 'done' : ''}`}>${selectedPlatform ? '\u2713' : '1'}</div>
          <div class="dv-step-label">${dt('step1.label', locale)}</div>
        </div>
        <div class="dv-platforms">
          ${platforms.map(p => html`
            <div class=${`dv-platform-card ${selectedPlatform?.id === p.id ? 'selected' : ''}`}
                 onClick=${() => handleSelectPlatform(p)} key=${p.id}>
              <div class="dv-platform-name">${p.name}</div>
              <div class="dv-platform-vendor">${p.vendor}</div>
            </div>
          `)}
        </div>
      </div>

      <!-- Step 2: Variant -->
      ${selectedPlatform && selectedPlatform.variants.length > 1 && html`
        <div class="dv-step">
          <div class="dv-step-header">
            <div class=${`dv-step-num ${selectedVariant ? 'done' : ''}`}>${selectedVariant ? '\u2713' : '2'}</div>
            <div class="dv-step-label">${dt('step2.label', locale)}</div>
          </div>
          <div class="dv-variants">
            ${selectedPlatform.variants.map(v => html`
              <button class=${`dv-variant-btn ${selectedVariant?.id === v.id ? 'selected' : ''}`}
                      type="button" onClick=${() => setSelectedVariant(v)} key=${v.id}>
                ${v.name}
              </button>
            `)}
          </div>
          ${selectedVariant?.notes && html`<div class="dv-variant-note">${dt('platformNotes.' + selectedVariant.notes, locale)}</div>`}
        </div>
      `}

      <!-- Step 3: Connection type -->
      ${selectedVariant && html`
        <div class="dv-step">
          <div class="dv-step-header">
            <div class="dv-step-num">3</div>
            <div class="dv-step-label">${dt('step3.label', locale)}</div>
          </div>
          <${CapTabs} variant=${selectedVariant} platform=${selectedPlatform} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />
        </div>
      `}

      <!-- Step 4: Share -->
      ${selectedVariant && html`
        <div class="dv-step">
          <div class="dv-step-header">
            <div class="dv-step-num">4</div>
            <div class="dv-step-label">${dt('step4.label', locale)}</div>
          </div>
          <${UploadSection} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />
        </div>
      `}

      <!-- Community Apps -->
      <${CommunityApps} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />
    </div>
  `;
}
