/**
 * @file public/views/profile/ecosystem-tab.cards.js
 * @description Presentational sub-cards of an expanded GEAI card — <EcoDataEntry> ("Data this app
 *   wrote" row), <EcoSetupGuide> (the app's own bilingual Markdown setup guide), <EcoAskInClaude>
 *   (the separate MCP "Ask in Claude" section), and <EcoTechDetails> (the collapsed "Technical
 *   details" disclosure: principal, grants, subscriptions, binding). Extracted from ecosystem-tab.js
 *   to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from ecosystem-tab.js (max-file-lines)
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

/**
 * One "Data this app wrote" entry: collapsed row (key + visibility chip + timeAgo) that expands to
 * the FULL value rendered HUMAN-READABLY via the shared <JsonValue> — a key/value tree for JSON
 * (the same structured renderer the agent Tasks view uses), safe Markdown for non-JSON strings.
 */
export function EcoDataEntry({ entry }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="pf-eco-data-entry">
      <button class="pf-eco-data-row" onClick=${() => setOpen(o => !o)}
        aria-expanded=${open} title=${open ? t('profile.ecosystem.dataCollapse') : t('profile.ecosystem.dataExpand')}>
        <span class="pf-eco-caret">${open ? '▼' : '▶'}</span>
        <span class="pf-eco-mono pf-eco-data-key">${entry.key}</span>
        <span class="pf-eco-chip pf-eco-data-vis">${entry.visibility}</span>
        <span class="pf-eco-dim pf-eco-data-time">${entry.updated_at ? timeAgo(entry.updated_at) : ''}</span>
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
    <div class="pf-eco-section pf-eco-setup-guide">
      <div class="pf-eco-section-title">${t('profile.ecosystem.setupGuideTitle')}</div>
      ${guide
        ? html`<div class="pf-eco-setup-guide-md"><${Markdown} text=${guide} /></div>`
        : html`<p class="pf-eco-dim pf-eco-setup-guide-missing">${t('profile.ecosystem.setupGuideMissing')}</p>`}
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
      getAutomationRecipe(app.app).catch(() => null),
      (ownerName ? listOrganisms({ member: ownerName }) : Promise.resolve(null)).catch(() => null),
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
    <div class="pf-eco-section pf-eco-ask">
      <div class="pf-eco-section-title">${t('profile.ecosystem.askClaudeTitle')}</div>
      <div class="pf-eco-mcp">
        <div class="pf-eco-mcp-head">
          <span class="pf-eco-mcp-icon">💬</span>
          <strong class="pf-eco-mcp-title">${t('profile.ecosystem.mcpTitle')}</strong>
        </div>
        <p class="pf-eco-dim pf-eco-mcp-sub">${t('profile.ecosystem.mcpSub')}</p>
        <p class="pf-eco-dim pf-eco-mcp-connect">${t('profile.ecosystem.mcpConnect')}</p>
        <div class="pf-eco-mcp-sample">
          ${organismName
            ? html`
              <div class="pf-eco-mcp-sample-label">${t('profile.ecosystem.mcpSampleLabel')}</div>
              <div class="pf-eco-mcp-sample-row">
                <code class="pf-eco-mcp-sample-prompt">${samplePrompt}</code>
                <${CopyButton} className="copy-prompt-btn" text=${samplePrompt} />
              </div>
              <p class="pf-eco-dim pf-eco-mcp-sample-note">${t('profile.ecosystem.mcpAccessNote')}</p>`
            : html`<p class="pf-eco-dim pf-eco-mcp-no-organism">${t('profile.ecosystem.mcpNoOrganism')}</p>`}
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
    <div class="pf-eco-tech">
      <button class="pf-eco-tech-toggle" aria-expanded=${open} onClick=${() => setOpen(o => !o)}>
        <span class="pf-eco-caret">${open ? '▼' : '▶'}</span>
        <span class="pf-eco-tech-icon">🔧</span>
        <span class="pf-eco-tech-toggle-label">${t('profile.ecosystem.techDetailsTitle')}</span>
      </button>
      ${open && html`
        <div class="pf-eco-tech-body">
          <p class="pf-eco-dim pf-eco-tech-hint">${t('profile.ecosystem.techDetailsHint')}</p>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title">${t('profile.ecosystem.principalTitle')}</div>
            <code class="pf-eco-mono pf-eco-tech-principal">${app.geai}</code>
          </div>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title">${t('profile.ecosystem.grants')}</div>
            <p class="pf-eco-dim pf-eco-tech-access">${t('profile.ecosystem.accessPlain')}</p>
            <div class="pf-eco-chips">
              ${(app.scopes || []).map(s => html`<span class="pf-eco-chip" key=${s}>${s}</span>`)}
            </div>
            ${(app.data_areas || []).length > 0 && html`
              <div class="pf-eco-areas">
                ${app.data_areas.map((g, i) => html`
                  <div class="pf-eco-area" key=${i}>${g.area}: <span class="pf-eco-mono">${g.pattern}</span> (${(g.rights || []).join(', ')})</div>`)}
              </div>`}
          </div>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title">${t('profile.ecosystem.subscriptions')}</div>
            <p class="pf-eco-dim pf-eco-sub-direction">${t('profile.ecosystem.subscriptionsDirection')}</p>
            ${appSubs.length === 0
              ? html`<div class="pf-eco-dim">${t('profile.ecosystem.noSubs')}</div>`
              : appSubs.map(s => html`
                <div class="pf-eco-sub-row" key=${s.event + (s.createdAt || '')}>
                  <span class="pf-eco-mono">${s.event}</span>
                  ${s.match && html`<span class="pf-eco-dim">${JSON.stringify(s.match)}</span>`}
                  <button class="btn-ghost btn-sm" onClick=${() => onUnsubscribe(app.app, s.event)}>${t('profile.ecosystem.removeSub')}</button>
                </div>`)}
            ${app.status !== 'revoked' && html`
              <div class="pf-eco-sub-add">
                <select class="pf-eco-select" onChange=${e => setSubForm(f => ({ ...f, [app.app]: { event: e.target.value } }))}>
                  ${OUTBOUND_EVENTS.map(ev => html`<option value=${ev} key=${ev}>${ev}</option>`)}
                </select>
                <button class="btn-outline btn-sm" onClick=${() => onSubscribe(app.app)}>${t('profile.ecosystem.addSub')}</button>
              </div>`}
          </div>

          <div class="pf-eco-tech-section">
            <div class="pf-eco-tech-section-title">${t('profile.ecosystem.binding')}</div>
            <div class="pf-eco-binding">
              <div>${t('profile.ecosystem.aimeatSide')}: <span class="pf-eco-mono">${app.owner}</span></div>
              <div>${t('profile.ecosystem.appOrigin')}: <span class="pf-eco-mono">${app.app}</span></div>
              <div>${t('profile.ecosystem.keyFp')}: <span class="pf-eco-mono">${keyFp(app.public_key)}</span></div>
              <p class="pf-eco-dim">${t('profile.ecosystem.bindingNote')}</p>
            </div>
          </div>
        </div>`}
    </div>`;
}
