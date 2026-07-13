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
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useViewCSS } from '/components/useViewCSS.js';
import { StatusDot } from '/components/StatusDot.js';
import { html, NODE_URL, dt, CopyBtn } from './portal-dev.shared.js';
import { BackgroundLayer, BgSelector } from './portal-dev.background.js';
import { CapTabs } from './portal-dev.panels.js';
import { UploadSection, CommunityApps } from './portal-dev.upload.js';

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
