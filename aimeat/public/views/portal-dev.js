/**
 * @file portal-dev.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Portal Dev view module — developer onboarding wizard (select
 *   platform → variant → connection type → share app). Composes the panels and
 *   upload sub-modules (extracted to satisfy max-file-lines).
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
 *   v2.0.0 — 2026-08-29 — The showroom face (design canvas "AIMEAT Dev and Terms Pages"): the
 *     headline with the sun behind it, the node address as a mono chip, the repositories as
 *     doors, the live figures on the ink strip the front page uses, the signed-out note as a
 *     dashed box with a sign-in door, the two panels as cards (the one hot slab copies the MCP
 *     command), the platform picker with the chosen one on the sun, and steps 2 to 4 folded into
 *     rows until the step before them is answered. The animated background and its selector are
 *     gone with portal-dev.background.js; the shared vocabulary comes from landing-showroom.css.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useViewCSS } from '/components/useViewCSS.js';
import { StatusDot } from '/components/StatusDot.js';
import { CopyButton } from '/components/CopyButton.js';
import { html, NODE_URL, dt } from './portal-dev.shared.js';
import { CapTabs } from './portal-dev.panels.js';
import { UploadSection } from './portal-dev.upload.js';
import { swallowed } from '/js/swallowed.js';
import { useSession } from '/js/use-session.js';
import { showLoginModal } from '/js/services/auth.js';
import { t } from '/js/i18n.js';

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

/* One live figure on the ink strip. `value` is undefined until the fetch resolves, and the figure
   shows a quiet placeholder instead of 0 — a zero here reads as "nothing runs on this node". */
function Fig({ value, label }) {
  const loading = value === undefined || value === null;
  return html`
    <div class="dv-fig">
      <b class=${loading ? 'is-loading' : ''}>${loading ? '·' : value}</b>
      <span>${label}</span>
    </div>
  `;
}

/* A copy control drawn as a door (the underlined word), for the prompts that are not the one hot
   slab on the page. */
function CopyDoor({ text }) {
  return html`<${CopyButton} text=${text} className="dv-copy-door" />`;
}

/* A later step, folded into one row until the step before it is answered. `open` renders the
   children under the row; `done` shows the answer the row already holds. */
function Fold({ num, label, open, done, children }) {
  return html`
    <div class=${`dv-fold ${open ? 'is-open' : ''}`}>
      <div class="dv-fold-row"><span class="dv-num">${num}</span><span>${label}</span>${done ? html`<span class="dv-fold-done">${done}</span>` : ''}</div>
      ${open ? html`<div class="dv-fold-body">${children}</div>` : ''}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */
export default function PortalDevView({ locale }) {
  const [platforms, setPlatforms] = useState([]);
  // null until the first fetch resolves — the strip renders a placeholder rather than a hard 0,
  // because "0 agents" on the developer page reads as a dead node.
  const [totals, setTotals] = useState(null);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const session = useSession();

  useViewCSS('/css/views/landing-showroom.css');
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
    document.title = dt('title', locale) + ' — AIMEAT';
  }, [locale]);

  const handleSelectPlatform = useCallback((p) => {
    setSelectedPlatform(p);
    setSelectedVariant(null);
    if (p.variants.length === 1) setSelectedVariant(p.variants[0]);
  }, []);

  const agentsLabel = totals?.agents_online
    ? `${dt('stats.agents', locale)} · ${totals.agents_online} ${dt('stats.online', locale)}`
    : dt('stats.agents', locale);
  const manyVariants = !!selectedPlatform && selectedPlatform.variants.length > 1;

  return html`
    <div class="dv-container">

      <section class="dv-hero">
        <div class="dv-hero-row">
          <span class="dv-crumb">${dt('crumb', locale)} /</span>
          <span class="dv-chip"><${StatusDot} status="online" />${NODE_URL}</span>
        </div>
        <h1 class="ld-sh-title">${dt('title', locale)}</h1>
        <p class="ld-sh-sub">${dt('subtitle', locale)}</p>
        <!-- Source repos: the protocol/node and the local agent fleet, both on GitHub -->
        <div class="ld-sh-doors">
          <a class="ld-sh-door" href="https://github.com/miikkij/aimeat-protocol" target="_blank" rel="noopener">${GH_MARK}${dt('repos.protocol', locale)} →</a>
          <a class="ld-sh-door" href="https://github.com/miikkij/crewaimeat" target="_blank" rel="noopener">${GH_MARK}${dt('repos.crew', locale)} →</a>
        </div>
      </section>

      <!-- Live figures: what this node actually holds right now -->
      <section class="dv-live">
        <span class="dv-live-label">${dt('stats.title', locale)}</span>
        <div class="dv-strip">
          <${Fig} value=${totals?.agents} label=${agentsLabel} />
          <${Fig} value=${totals?.apps} label=${dt('stats.apps', locale)} />
          <${Fig} value=${totals?.organisms} label=${dt('stats.organisms', locale)} />
          <${Fig} value=${totals?.knowledge_packages} label=${dt('stats.knowledge', locale)} />
        </div>
      </section>

      <!-- Signed in or not. The signed-out box carries the door to the sign-in dialog. -->
      ${isLoggedIn
        ? html`<div class="ld-sh-box dv-mode"><p><strong>${dt('mode.loggedIn', locale)} ${session?.ghii || session?.owner || ''}.</strong> ${dt('mode.loggedInDesc', locale)}</p></div>`
        : html`<div class="ld-sh-box dv-mode">
            <p><strong>${dt('mode.anonymous', locale)}.</strong> ${dt('mode.anonymousDesc', locale)} ${dt('mode.anonymousNote', locale)}</p>
            <button class="ld-sh-door dv-mode-door" type="button" onClick=${() => showLoginModal({ tab: 'login' })}>${dt('mode.signUp', locale)} →</button>
          </div>`
      }

      <section class="dv-cards">
        <!-- Quick start. MCP first: for every client that speaks it, this one line is the whole
             on-ramp and the wizard below is unnecessary. The browse prompt stays for clients that
             cannot do MCP but can read a URL. -->
        <div class="dv-card dv-card--hot">
          <h3>${dt('quickStart.title', locale)}</h3>
          <p>${dt('quickStart.mcpDesc', locale)}</p>
          <div class="dv-cmd">
            <code>${MCP_ADD_COMMAND}</code>
            <${CopyButton} text=${MCP_ADD_COMMAND} className="ld-sh-btn ld-sh-btn--hot" label=${t('common.copy')} />
          </div>
          <p class="dv-note">${dt('quickStart.mcpNote', locale)}</p>
          <p>${dt('quickStart.desc', locale)}</p>
          <div class="dv-cmd">
            <code>${BROWSE_PROMPT}</code>
            <${CopyDoor} text=${BROWSE_PROMPT} />
          </div>
          <p class="dv-note">${dt('quickStart.note', locale)} ${dt('quickStart.fallback', locale)}</p>
        </div>

        <!-- Stay in sync: the connection alone does not survive between sessions. The one-line
             standing instruction is the other half of the setup (the documented failure mode is
             the AI silently drifting off the node); the profile MCP page builds the full block
             prefilled with the user's own organisms. -->
        <div class="dv-card">
          <h3>${dt('staySync.title', locale)}</h3>
          <p>${dt('staySync.lead', locale)}</p>
          <div class="dv-cmd dv-cmd--tall">
            <code>${STAY_SYNC_LINE}</code>
            <${CopyDoor} text=${STAY_SYNC_LINE} />
          </div>
          <p class="dv-note">${dt('staySync.prefilledNote', locale)}${' '}
            <a class="ld-sh-door" href="/v1/profile?tab=mcp">${dt('staySync.prefilledLink', locale)}</a></p>
        </div>
      </section>

      <!-- Step 1: Platform -->
      <section class="dv-step">
        <div class="dv-step-header">
          <span class="dv-num">1</span>
          <h2 class="dv-step-label">${dt('step1.label', locale)}</h2>
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
      </section>

      <!-- Steps 2 to 4, folded until the step before them is answered -->
      <section class="dv-folds">
        <${Fold} num="2" label=${dt('step2.label', locale)} open=${manyVariants}
          done=${selectedPlatform && !manyVariants && selectedVariant ? selectedVariant.name : ''}>
          ${manyVariants && html`
            <div class="dv-variants">
              ${selectedPlatform.variants.map(v => html`
                <button class=${`dv-variant-btn ${selectedVariant?.id === v.id ? 'selected' : ''}`}
                        type="button" onClick=${() => setSelectedVariant(v)} key=${v.id}>
                  ${v.name}
                </button>
              `)}
            </div>
            ${selectedVariant?.notes && html`<div class="dv-variant-note">${dt('platformNotes.' + selectedVariant.notes, locale)}</div>`}
          `}
        <//>
        <${Fold} num="3" label=${dt('step3.label', locale)} open=${!!selectedVariant}>
          ${selectedVariant && html`<${CapTabs} variant=${selectedVariant} platform=${selectedPlatform} locale=${locale} isLoggedIn=${isLoggedIn} session=${session} />`}
        <//>
        <${Fold} num="4" label=${dt('step4.label', locale)} open=${!!selectedVariant}>
          ${selectedVariant && html`<${UploadSection} locale=${locale} />`}
        <//>
      </section>
    </div>
  `;
}
