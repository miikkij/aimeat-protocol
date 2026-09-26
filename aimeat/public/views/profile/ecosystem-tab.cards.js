/**
 * @file public/views/profile/ecosystem-tab.cards.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Presentational sub-cards of an expanded GEAI card — <EcoDataEntry> ("Data this app
 *   wrote" row), <EcoSetupGuide> (the app's own bilingual Markdown setup guide), <EcoAskInClaude>
 *   (the separate MCP "Ask in Claude" section), and <EcoTechDetails> (the collapsed "Technical
 *   details" disclosure: principal, grants, subscriptions, binding). Extracted from ecosystem-tab.js
 *   to satisfy max-file-lines.
 * @version-history
 *   v1.17.0 -- 2026-09-26 -- An app's setup guide is the Markdown reader's small cut (Markdown `small`), a unification: Jouni's decision "Small reader".
 *   v1.16.0 -- 2026-09-26 -- A sample prompt is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.15.0 -- 2026-09-26 -- A sample prompt is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.14.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.13.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.12.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 -- 2026-09-26 -- A control that opens a panel below it is the Tab's fold tone (.poster-tab--fold, is-on while open), and the parameters section that is one row until opened is the FoldSection; their own toggles, carets and arrows go (a unification: Jouni's decision Tabs and filters, and the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- The ecosystem card's help lines are the Hint (.poster-hint); their own sizes go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- A node's agents, the CORS chain, the ecosystem's identifiers and its pairing code are inline code (.code-inline); their own mono looks go (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v1.7.0 -- 2026-09-25 -- The binding (your side, the app's origin, the key's fingerprint) is the Facts (css/components/facts.css), a unification: the look most tabs use; its note follows under it.
 *   v1.6.0 -- 2026-09-25 -- A data entry's row, which opens its value in place, is the folded row (og-fold og-fold--event, the arrow for the caret), a unification: the look most tabs use.
 *   v1.5.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.4.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.3.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2v: compose section top rules from poster.css.
 *   v1.0.0 — 2026-07-13 — Extracted from ecosystem-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Copy control unified: the bespoke .copy-prompt-btn is the shared .btn-primary, whose
 *       .copied state now lives in theme.css. Copy labels come from the shared common.* keys.
 *   v1.2.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import { JsonValue } from '/components/JsonView.js';
import { Markdown } from '/components/Markdown.js';
import { getAutomationRecipe } from '/js/services/ecosystem.js';
import { listOrganisms, currentGhii } from '/js/services/organisms.js';
import { keyFp, OUTBOUND_EVENTS, resolveOrganismName } from './ecosystem-tab.helpers.js';
import { swallowed } from '/js/swallowed.js';
import { Hint } from '/components/Hint.js';

/**
 * One "Data this app wrote" entry: collapsed row (key + visibility chip + timeAgo) that expands to
 * the FULL value rendered HUMAN-READABLY via the shared <JsonValue> — a key/value tree for JSON
 * (the same structured renderer the agent Tasks view uses), safe Markdown for non-JSON strings.
 */
export function EcoDataEntry({ entry }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="pf-eco-data-entry">
      <button class="og-fold og-fold--event pf-eco-data-row" onClick=${() => setOpen(o => !o)}
        aria-expanded=${open} title=${open ? t('profile.ecosystem.dataCollapse') : t('profile.ecosystem.dataExpand')}>
        <b class="pf-eco-data-key">${entry.key}</b>
        <span class=${`poster-chip ${entry.visibility === 'public' ? 'poster-chip--sun' : ''}`}>${entry.visibility}</span>
        <span class="pf-eco-data-time poster-time">${entry.updated_at ? timeAgo(entry.updated_at) : ''}</span>
        <span class="og-fold-arrow">${open ? '↓' : '→'}</span>
      </button>
      ${open && html`
        <div class="pf-eco-data-body">
          <${JsonValue} value=${entry.value} />
        </div>`}
    </div>`;
}

/**
 * The app's OWN **setup guide** ("Näin asennat tämän"), rendered at the TOP of an expanded GEAI card
 * (replacing the old hardcoded playbook). The guidance comes FROM the app, carried in its manifest as
 * `setup: { fi, en }` (bilingual Markdown) and returned on the connected-app record. We pick the
 * active UI locale's guide (getLocale()), falling back en → fi, and render it through the shared safe
 * <Markdown> renderer (Preact vnodes, never innerHTML — no XSS surface).
 *
 * When the app has no `setup` (it onboarded before this field existed, or simply omitted one) we show
 * a short honest note telling the owner to re-connect the app to load its guide.
 */
export function EcoSetupGuide({ app }) {
  const setup = app.setup;
  const locale = getLocale();
  // Prefer the active locale; fall back to English, then Finnish — whatever the app actually shipped.
  const guide = setup && (setup[locale] || setup.en || setup.fi);

  return html`
    <div class="pf-eco-section poster-row--thing pf-eco-setup-guide">
      <div class="pf-eco-section-title">${t('profile.ecosystem.setupGuideTitle')}</div>
      ${guide
        ? html`<div class="pf-eco-setup-guide-md"><${Markdown} text=${guide} small /></div>`
        : html`<p class="poster-hint">${t('profile.ecosystem.setupGuideMissing')}</p>`}
    </div>`;
}

/**
 * The separate **"Ask in Claude"** section ("Kysy tuloksista Claudessa"). This is a DISTINCT
 * capability from the automated pipeline: you query and evaluate the produced analysis YOURSELF over
 * MCP from any AI chat (Claude / Grok / ChatGPT) — it is NOT part of the automated agent pipeline and
 * NOT a substitute for the agent. Pulled out of the old setup playbook into its own card so the two
 * read as two different things.
 *
 * The sample prompt targets the recipe's chosen ORGANISM by its resolved human NAME (the reachable
 * home for the agent's report that an owner / member CAN read over MCP) — never a guessed raw memory
 * key. When no organism is set we show a "pick an organism first" hint instead of a broken prompt.
 *
 * Lazy-loads the recipe + the owner's organisms on first render, refreshes on aimeat-live-update.
 */
export function EcoAskInClaude({ app }) {
  const [recipe, setRecipe] = useState(null);
  const [orgs, setOrgs] = useState([]);

  const load = async () => {
    const ownerName = (currentGhii().split('@')[0]) || '';
    const [recipeResp, orgResp] = await Promise.all([
      getAutomationRecipe(app.app).catch(err => { swallowed('ecosystem-tab.cards: ownerName', err); return null; }),
      (ownerName ? listOrganisms({ member: ownerName }) : Promise.resolve(null)).catch(err => { swallowed('ecosystem-tab.cards: ownerName', err); return null; }),
    ]);
    setRecipe(recipeResp);
    setOrgs(orgResp?.data?.organisms || []);
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    loadRef.current();
    return onLiveUpdate(['ecosystem-apps', 'apps'], () => loadRef.current());
  }, [app.app]);

  const organismName = resolveOrganismName(recipe && recipe.organism, orgs);
  const samplePrompt = organismName
    ? t('profile.ecosystem.mcpSamplePromptOrg', { organism: organismName })
    : '';

  return html`
    <div class="pf-eco-section poster-row--thing pf-eco-ask">
      <div class="pf-eco-section-title">${t('profile.ecosystem.askClaudeTitle')}</div>
      <div class="pf-eco-mcp poster-row--thing">
        <div class="pf-eco-mcp-head">
          <span class="pf-eco-mcp-icon">💬</span>
          <strong class="pf-eco-mcp-title">${t('profile.ecosystem.mcpTitle')}</strong>
        </div>
        <p class="poster-hint">${t('profile.ecosystem.mcpSub')}</p>
        <p class="poster-hint">${t('profile.ecosystem.mcpConnect')}</p>
        <div class="pf-eco-mcp-sample">
          ${organismName
            ? html`
              <div class="poster-label">${t('profile.ecosystem.mcpSampleLabel')}</div>
              <div class="pf-eco-mcp-sample-row">
                <code class="code-block pf-eco-mcp-sample-prompt">${samplePrompt}</code>
                <${CopyButton} className="poster-slab" text=${samplePrompt} />
              </div>
              <${Hint}>${t('profile.ecosystem.mcpAccessNote')}<//>`
            : html`<p class="poster-hint">${t('profile.ecosystem.mcpNoOrganism')}</p>`}
        </div>
      </div>
    </div>`;
}

/**
 * The collapsed **"Technical details" ("Tekniset tiedot")** disclosure at the very bottom of an
 * expanded GEAI card. Default CLOSED, with a subtly distinct faint background so it reads as
 * optional under-the-hood info, not something a non-technical user must touch.
 *
 * It holds the plumbing relocated out of the human/value-first area:
 *   • the GEAI principal string (`eco:…`),
 *   • the raw grants / scopes (incl. the `*` wildcard) — with a plain "access" one-liner above,
 *   • the outbound event subscriptions (the memory.write select + Tilaa, still fully functional),
 *   • the binding (AIMEAT side / app / key fingerprint + its explanation).
 *
 * All the existing functionality (subscribe / unsubscribe) is preserved here verbatim — only
 * relocated. The toggle is independent per card and resets when the card is collapsed/re-expanded.
 */
export function EcoTechDetails({ app, appSubs, onUnsubscribe, onSubscribe, setSubForm }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="pf-eco-tech poster-box">
      <button type="button" class=${`poster-tab poster-tab--fold pf-eco-tech-toggle ${open ? 'is-on' : ''}`} aria-expanded=${open} onClick=${() => setOpen(o => !o)}>
        🔧 ${t('profile.ecosystem.techDetailsTitle')}
      </button>
      ${open && html`
        <div class="pf-eco-tech-body">
          <${Hint}>${t('profile.ecosystem.techDetailsHint')}<//>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title sub-heading">${t('profile.ecosystem.principalTitle')}</div>
            <code class="code-inline">${app.geai}</code>
          </div>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title sub-heading">${t('profile.ecosystem.grants')}</div>
            <p class="poster-hint pf-eco-tech-access">${t('profile.ecosystem.accessPlain')}</p>
            <div class="poster-chips">
              ${(app.scopes || []).map(s => html`<span class="poster-chip" key=${s}>${s}</span>`)}
            </div>
            ${/* The areas this app may write used to be listed HERE, three disclosures deep. A
                  statement of what an outside app puts into your store is the opposite of a
                  technical detail, so it is now its own section on the card, above the list of what
                  it actually wrote — claim first, then evidence. See ecosystem-tab.js. */ ''}
          </div>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title sub-heading">${t('profile.ecosystem.subscriptions')}</div>
            <p class="poster-hint pf-eco-sub-direction">${t('profile.ecosystem.subscriptionsDirection')}</p>
            ${appSubs.length === 0
              ? html`<div class="poster-quiet">${t('profile.ecosystem.noSubs')}</div>`
              : appSubs.map(s => html`
                <div class="pf-eco-sub-row" key=${s.event + (s.createdAt || '')}>
                  <span class="code-inline">${s.event}</span>
                  ${s.match && html`<span class="pf-eco-dim">${JSON.stringify(s.match)}</span>`}
                  <button class="poster-action poster-action--small" onClick=${() => onUnsubscribe(app.app, s.event)}>${t('profile.ecosystem.removeSub')}</button>
                </div>`)}
            ${app.status !== 'revoked' && html`
              <div class="pf-eco-sub-add">
                <select class="select-field" onChange=${e => setSubForm(f => ({ ...f, [app.app]: { event: e.target.value } }))}>
                  ${OUTBOUND_EVENTS.map(ev => html`<option value=${ev} key=${ev}>${ev}</option>`)}
                </select>
                <button class="poster-action poster-action--small" onClick=${() => onSubscribe(app.app)}>${t('profile.ecosystem.addSub')}</button>
              </div>`}
          </div>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title sub-heading">${t('profile.ecosystem.binding')}</div>
            <div class="facts">
              <div class="facts-k poster-label">${t('profile.ecosystem.aimeatSide')}</div><div class="facts-v"><span class="code-inline">${app.owner}</span></div>
              <div class="facts-k poster-label">${t('profile.ecosystem.appOrigin')}</div><div class="facts-v"><span class="code-inline">${app.app}</span></div>
              <div class="facts-k poster-label">${t('profile.ecosystem.keyFp')}</div><div class="facts-v"><span class="code-inline">${keyFp(app.public_key)}</span></div>
            </div>
            <p class="poster-hint">${t('profile.ecosystem.bindingNote')}</p>
          </div>
        </div>`}
    </div>`;
}
