/**
 * @file portal-dev.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.5.0 — 2026-07-28 — Community app list dropped: it offered Download for apps their authors
 *     never made forkable, and the landing wall already shows the same apps.
 *   v1.4.0 — 2026-07-28 — Live counters read /v1/public/node-totals (agents + online, apps,
 *     organisms, knowledge packages) instead of /v1/stats fields that do not exist, which had
 *     every card rendering 0 on a node with 114 agents. New <StatCard> renders a placeholder
 *     until the fetch resolves rather than a hard zero.
 *   v1.6.0 — 2026-08-07 — "Keep your AI in sync" panel: the copyable standing-instruction line
 *     (CLAUDE.md/AGENTS.md/custom instructions) + link to the prefilled per-organism block on
 *     the profile MCP page. Closes the documented gate where the connection worked but the AI
 *     silently drifted off the node between sessions (UX-remake v3, P9).
 *   v1.7.0 — 2026-08-08 — CopyBtn no longer takes a `locale` prop (it has no labels of its own any more).
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useViewCSS } from '/components/useViewCSS.js';
import { StatusDot } from '/components/StatusDot.js';
import { html, NODE_URL, dt, CopyBtn } from './portal-dev.shared.js';
import { BackgroundLayer, BgSelector } from './portal-dev.background.js';
import { CapTabs } from './portal-dev.panels.js';
import { UploadSection } from './portal-dev.upload.js';
import { swallowed } from '/js/swallowed.js';
import { useSession } from '/js/use-session.js';

// The familiar GitHub "Octocat" mark. fill=currentColor so it inherits the link's themed color.
const GH_MARK = html`<svg class="gh-mark" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`;

// The two on-ramps, in the order they should be tried. The MCP line is the whole setup for any
// client that speaks it; the browse prompt is the fallback for clients that can only read a URL.
const MCP_ADD_COMMAND = `claude mcp add aimeat --transport http ${NODE_URL}/v1/mcp`;
const BROWSE_PROMPT = `Read this URL and follow the instructions to connect to this AIMEAT node: ${NODE_URL}/?format=json`;
// The standing instruction that makes the connection survive between sessions. Kept in English
// on purpose: it is written for the AI, and it ends by telling the AI where the richer
// per-organism block lives (profile → MCP → step 5 serves it prefilled).
const STAY_SYNC_LINE = `I work on the AIMEAT node at ${NODE_URL} over MCP (connector "aimeat"). At the start of a task, read my context from it; write durable results back through the AIMEAT tools instead of keeping them only in this chat. If the AIMEAT tools are not available in this conversation, tell me plainly.`;

/* One live counter. `value` is undefined until the fetch resolves, and the card shows a
   quiet placeholder instead of 0 — a zero here reads as "nothing runs on this node". */
function StatCard({ value, label, sub }) {
  const loading = value === undefined || value === null;
  return html`
    <div class="stat-card">
      <div class=${`stat-card-value accent ${loading ? 'is-loading' : ''}`}>${loading ? '·' : value}</div>
      <div class="stat-card-label">${label}</div>
      ${sub ? html`<div class="stat-card-sub">${sub}</div>` : ''}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */
export default function PortalDevView({ locale }) {
  const [platforms, setPlatforms] = useState([]);
  // null until the first fetch resolves — the cards render a placeholder rather than a hard 0,
  // because "0 agents" on the developer page reads as a dead node.
  const [totals, setTotals] = useState(null);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [activeBg, setActiveBg] = useState(3);
  const session = useSession();

  useViewCSS('/css/views/portal-dev.css');

  const isLoggedIn = !!session;

  // Load platforms + stats
  useEffect(() => {
    fetch('/v1/portal/platforms')
      .then(r => r.json())
      .then(d => { if (d.ok) setPlatforms(d.data.platforms); })
      .catch(err => { swallowed('portal-dev: checkSession', err); });

    // Counters come from /v1/public/node-totals — the same source the landing wall uses.
    // /v1/stats does NOT expose `agents`/`chatSessions`/`actions`/`boards`; reading those
    // names made every card render 0 while the node actually had 114 agents (fixed 2026-07-28).
    fetch('/v1/public/node-totals')
      .then(r => r.json())
      .then(d => { if (d.ok !== false && d.data) setTotals(d.data); })
      .catch(err => { swallowed('portal-dev: node-totals', err); });
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
      <h1>${dt('title', locale)}</h1>
      <p class="dv-subtitle">${dt('subtitle', locale)}</p>
      <div class="dv-node-badge"><${StatusDot} status="online" /> ${NODE_URL}</div>

      <!-- Source repos: the protocol/node and the local agent fleet, both on GitHub -->
      <div class="dv-repos">
        <a class="dv-repo-link" href="https://github.com/miikkij/aimeat-protocol" target="_blank" rel="noopener">${GH_MARK}${dt('repos.protocol', locale)}</a>
        <a class="dv-repo-link" href="https://github.com/miikkij/crewaimeat" target="_blank" rel="noopener">${GH_MARK}${dt('repos.crew', locale)}</a>
      </div>

      <!-- Live counters: what this node actually holds right now -->
      <h2 class="section-title">${dt('stats.title', locale)}</h2>
      <div class="stat-grid">
        <${StatCard} value=${totals?.agents} label=${dt('stats.agents', locale)}
          sub=${totals?.agents_online ? `${totals.agents_online} ${dt('stats.online', locale)}` : ''} />
        <${StatCard} value=${totals?.apps} label=${dt('stats.apps', locale)} />
        <${StatCard} value=${totals?.organisms} label=${dt('stats.organisms', locale)} />
        <${StatCard} value=${totals?.knowledge_packages} label=${dt('stats.knowledge', locale)} />
      </div>

      <!-- Mode notice -->
      ${isLoggedIn
        ? html`<div class="dv-mode-notice dv-mode-notice-user"><div class="dv-notice-icon">\u2705</div><div><strong>${dt('mode.loggedIn', locale)} ${session?.ghii || session?.owner || ''}</strong><br/><span class="dv-notice-sub">${dt('mode.loggedInDesc', locale)}</span></div></div>`
        : html`<div class="dv-mode-notice dv-mode-notice-anon"><div class="dv-notice-icon">\ud83d\udc64</div><div><strong>${dt('mode.anonymous', locale)}</strong> \u2014 ${dt('mode.anonymousDesc', locale)}<br/><span class="dv-notice-sub">${dt('mode.anonymousNote', locale)} <strong>${dt('mode.signUp', locale)}</strong> ${dt('mode.signUpNote', locale)}</span></div></div>`
      }

      <!-- Quick start. MCP first: for every client that speaks it, this one line is the whole
           on-ramp and the four-step wizard below is unnecessary. The browse prompt stays for
           clients that cannot do MCP but can read a URL. -->
      <div class="dv-panel dv-panel--accent">
        <h3 class="dv-panel-title">${dt('quickStart.title', locale)}</h3>
        <p class="dv-panel-lead">${dt('quickStart.mcpDesc', locale)}</p>
        <div class="dv-code-row">
          <code class="dv-code">${MCP_ADD_COMMAND}</code>
          <${CopyBtn} text=${MCP_ADD_COMMAND} />
        </div>
        <p class="dv-hint">${dt('quickStart.mcpNote', locale)}</p>

        <p class="dv-panel-lead dv-mt">${dt('quickStart.desc', locale)}</p>
        <div class="dv-prompt-output dv-prompt-output--flush">
          <${CopyBtn} text=${BROWSE_PROMPT} />
          <div class="dv-prompt-text dv-prompt-text--single">${BROWSE_PROMPT}</div>
        </div>
        <p class="dv-note">${dt('quickStart.note', locale)}<br/>${dt('quickStart.fallback', locale)}</p>
      </div>

      <!-- Stay in sync: the connection alone does not survive between sessions. The one-line
           standing instruction is the other half of the setup (the documented failure mode is
           the AI silently drifting off the node); the profile MCP page builds the full block
           prefilled with the user's own organisms. -->
      <div class="dv-panel">
        <h3 class="dv-panel-title">${dt('staySync.title', locale)}</h3>
        <p class="dv-panel-lead">${dt('staySync.lead', locale)}</p>
        <div class="dv-prompt-output dv-prompt-output--flush">
          <${CopyBtn} text=${STAY_SYNC_LINE} />
          <div class="dv-prompt-text">${STAY_SYNC_LINE}</div>
        </div>
        <p class="dv-note">${dt('staySync.prefilledNote', locale)}${' '}
          <a class="dv-inline-link" href="/v1/profile?tab=mcp">${dt('staySync.prefilledLink', locale)}</a></p>
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
          <${UploadSection} locale=${locale} />
        </div>
      `}
    </div>
  `;
}
