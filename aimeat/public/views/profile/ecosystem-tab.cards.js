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
 *   2026-09-22 -- Composed from the shared component set: a written-data entry and the technical
 *     details are Folds, the Ask-in-Claude card a box with the prompt in a code surface, the
 *     technical facts KeyValues; no own classes. The speech-bubble and wrench emoji and the triangle
 *     glyphs are gone.
 *   2026-09-13 -- V2v: compose section top rules from poster.css.
 *   v1.0.0 — 2026-07-13 — Extracted from ecosystem-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Copy control unified: the bespoke .copy-prompt-btn is the shared .btn-primary, whose
 *       .copied state now lives in theme.css. Copy labels come from the shared common.* keys.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { Fold, Stack, ListRow, KeyValue, Toolbar, Surface, Chip, Text, Action, CopyAction, Field } from '/components/poster-parts.js';
import { JsonValue } from '/components/JsonView.js';
import { Markdown } from '/components/Markdown.js';
import { getAutomationRecipe } from '/js/services/ecosystem.js';
import { listOrganisms, currentGhii } from '/js/services/organisms.js';
import { keyFp, OUTBOUND_EVENTS, resolveOrganismName } from './ecosystem-tab.helpers.js';
import { swallowed } from '/js/swallowed.js';

/**
 * One "Data this app wrote" entry: collapsed row (key + visibility chip + timeAgo) that expands to
 * the FULL value rendered HUMAN-READABLY via the shared <JsonValue> — a key/value tree for JSON
 * (the same structured renderer the agent Tasks view uses), safe Markdown for non-JSON strings.
 */
export function EcoDataEntry({ entry }) {
  const [open, setOpen] = useState(false);
  // The fold's row says the key, its visibility and when it was written; the body is the value.
  return html`
    <${Fold} title=${entry.key} sub=${[entry.visibility, entry.updated_at ? timeAgo(entry.updated_at) : ''].filter(Boolean).join(' · ')}
      open=${open} onToggle=${() => setOpen(o => !o)}>
      <${JsonValue} value=${entry.value} />
    <//>`;
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

  return html`<${Stack} density="compact">
    <${Text} kind="label">${t('profile.ecosystem.setupGuideTitle')}<//>
    ${guide
      ? html`<${Surface} kind="plain" density="flush"><${Markdown} text=${guide} /><//>`
      : html`<${Text} tone="muted">${t('profile.ecosystem.setupGuideMissing')}<//>`}
  <//>`;
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

  return html`<${Stack} density="compact">
    <${Text} kind="label">${t('profile.ecosystem.askClaudeTitle')}<//>
    <${Surface} kind="box"><${Stack} density="compact">
      <${Text}><strong>${t('profile.ecosystem.mcpTitle')}</strong><//>
      <${Text} tone="muted">${t('profile.ecosystem.mcpSub')}<//>
      <${Text} tone="muted">${t('profile.ecosystem.mcpConnect')}<//>
      ${organismName
        ? html`
          <${Text} kind="label">${t('profile.ecosystem.mcpSampleLabel')}<//>
          <${Surface} kind="code">${samplePrompt}<//>
          <${Stack} direction="horizontal" align="start"><${CopyAction} text=${samplePrompt} /><//>
          <${Text} kind="caption" tone="muted">${t('profile.ecosystem.mcpAccessNote')}<//>`
        : html`<${Text} kind="caption" tone="muted">${t('profile.ecosystem.mcpNoOrganism')}<//>`}
    <//><//>
  <//>`;
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
    <${Fold} title=${t('profile.ecosystem.techDetailsTitle')} open=${open} onToggle=${() => setOpen(o => !o)}>
      <${Stack}>
        <${Text} tone="muted">${t('profile.ecosystem.techDetailsHint')}<//>

        <${KeyValue} label=${t('profile.ecosystem.principalTitle')} value=${html`<${Text} kind="mono">${app.geai}<//>`} />

        <${KeyValue} label=${t('profile.ecosystem.grants')} value=${html`<${Stack} density="compact">
          <${Text} kind="caption" tone="muted">${t('profile.ecosystem.accessPlain')}<//>
          <${Stack} direction="wrap" density="compact">${(app.scopes || []).map(s => html`<${Chip} key=${s}>${s}<//>`)}<//>
        <//>`} />
        ${/* The areas this app may write used to be listed HERE, three disclosures deep. A
              statement of what an outside app puts into your store is the opposite of a
              technical detail, so it is now its own section on the card, above the list of what
              it actually wrote — claim first, then evidence. See ecosystem-tab.js. */ ''}

        <${KeyValue} label=${t('profile.ecosystem.subscriptions')} value=${html`<${Stack} density="compact">
          <${Text} kind="caption" tone="muted">${t('profile.ecosystem.subscriptionsDirection')}<//>
          ${appSubs.length === 0
            ? html`<${Text} tone="muted">${t('profile.ecosystem.noSubs')}<//>`
            : appSubs.map(s => html`<${ListRow} key=${s.event + (s.createdAt || '')} density="compact" name=${s.event}
                detail=${s.match ? JSON.stringify(s.match) : undefined}
                actions=${html`<${Action} kind="text" onClick=${() => onUnsubscribe(app.app, s.event)}>${t('profile.ecosystem.removeSub')}<//>`} />`)}
          ${app.status !== 'revoked' && html`<${Toolbar} label=${t('profile.ecosystem.subscriptions')}
            actions=${html`<${Action} onClick=${() => onSubscribe(app.app)}>${t('profile.ecosystem.addSub')}<//>`}>
            <${Field} type="select" ariaLabel=${t('profile.ecosystem.subscriptions')} onChange=${e => setSubForm(f => ({ ...f, [app.app]: { event: e.target.value } }))}
              options=${OUTBOUND_EVENTS.map(ev => ({ value: ev, label: ev }))} />
          <//>`}
        <//>`} />

        <${KeyValue} label=${t('profile.ecosystem.binding')} value=${html`<${Stack} density="compact">
          <${Text}>${t('profile.ecosystem.aimeatSide')}: <${Text} kind="mono">${app.owner}<//><//>
          <${Text}>${t('profile.ecosystem.appOrigin')}: <${Text} kind="mono">${app.app}<//><//>
          <${Text}>${t('profile.ecosystem.keyFp')}: <${Text} kind="mono">${keyFp(app.public_key)}<//><//>
          <${Text} kind="caption" tone="muted">${t('profile.ecosystem.bindingNote')}<//>
        <//>`} />
      <//>
    <//>`;
}
