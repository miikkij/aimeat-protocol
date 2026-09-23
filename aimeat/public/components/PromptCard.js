/**
 * @file public/components/PromptCard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt block: a label, a one-click copy, and — where it makes sense — a corner
 *   menu with the two things a person actually wants next.
 *
 *   It was the same shape written four times in views/home (step-mat, step-agent, step-branch-b,
 *   welcome-door). This is that shape, extracted verbatim: the markup and the classes are
 *   unchanged, so the four places look exactly as they did.
 *
 *   The primary button stays ONE CLICK with no menu in front of it. That is the whole rule for this
 *   component: copying is the thing people came to do, and putting a chooser in its way to make
 *   room for two rarer options would be a worse product sold as a better one. Everything else lives
 *   behind the chevron, and the chevron only appears when there is something behind it.
 *
 *   "Give it to an agent" appears only when an agent that actually drains a queue exists
 *   (services/open-items.js reachableAgents). Offering a name that will sit there forever is a
 *   graveyard, not a feature.
 * @structure PromptCard({ label, prompt, className, copyLabel, copiedLabel, onCopied,
 *   saveIntent, agents, onGiveToAgent, showPrompt })
 * @usage
 *   html`<${PromptCard} label=${t('...')} prompt=${text} copyLabel=${t('...')} />`
 * @version-history
 *   v1.0.0 — 2026-08-09 — Extracted from four call sites in views/home (intent pool, phase 2).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';

const html = htm.bind(h);

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function PromptCard({
  label,
  prompt,
  className = 'btn-primary',
  copyLabel,
  copiedLabel,
  onCopied,
  loadingLabel,
  /** () => Promise — called when the person picks "save for later". Omit to hide the row. */
  saveIntent = null,
  /** Agents that take queued work. Empty or absent hides "give it to an agent". */
  agents = [],
  /** (agentEntry) => Promise */
  onGiveToAgent = null,
  /**
   * Extra menu rows, appended after the built-in ones: [{ label, run, disabled }].
   *
   * The pool's rows need "Done" and "Remove" in the same place a prompt surface offers "leave it
   * waiting" — one chevron per row, not a chevron next to two loose buttons. Kept as data rather
   * than baked in, because this component must not learn what an intent is.
   */
  extraActions = [],
  /** Start with the prompt body visible. The four original call sites all did. */
  showPrompt = true,
}) {
  const [open, setOpen] = useState(false);
  const [bodyShown, setBodyShown] = useState(showPrompt);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const canGive = !!onGiveToAgent && agents.length > 0;
  const hasMenu = !!saveIntent || canGive || !showPrompt || extraActions.length > 0;

  // The card can sit inside a room card, which is an <a> under the SPA's delegated link handler.
  // Without this, copying also navigates away and marks the room entered — already learned once in
  // views/home/feed.js, and not worth learning twice.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  async function run(fn, after) {
    if (busy) return;
    setBusy(true);
    try { await fn(); after?.(); } finally { setBusy(false); setOpen(false); }
  }

  return html`
    <div class="koti-prompt" onClick=${hasMenu ? stop : undefined}>
      <div class="koti-prompt-head">
        <span class="koti-prompt-label">${label}</span>
        <div class="koti-prompt-actions">
          <${CopyButton}
            text=${prompt}
            className=${className}
            label=${copyLabel}
            copiedLabel=${copiedLabel}
            onCopied=${onCopied} />
          ${hasMenu && html`
            <button type="button" class="btn-ghost koti-prompt-more"
              aria-expanded=${open}
              aria-label=${tr('prompt.more', 'More')}
              onClick=${(e) => { stop(e); setOpen(v => !v); }}>▾</button>`}
        </div>
      </div>

      ${open && html`
        <div class="koti-prompt-menu">
          <button type="button" class="btn-ghost koti-prompt-menu-item"
            onClick=${(e) => { stop(e); setBodyShown(v => !v); setOpen(false); }}>
            ${bodyShown ? tr('prompt.hideText', 'Hide the prompt') : tr('prompt.showText', 'Show the prompt')}
          </button>
          ${saveIntent && html`
            <button type="button" class="btn-ghost koti-prompt-menu-item" disabled=${busy || saved}
              onClick=${(e) => { stop(e); run(saveIntent, () => setSaved(true)); }}>
              ${saved ? tr('prompt.saved', 'Waiting on your list') : tr('prompt.save', 'Leave it waiting')}
            </button>`}
          ${canGive && agents.map(a => html`
            <button type="button" key=${a.gaii || a.name} class="btn-ghost koti-prompt-menu-item"
              disabled=${busy}
              onClick=${(e) => { stop(e); run(() => onGiveToAgent(a)); }}>
              ${tr('prompt.giveTo', 'Give it to')} ${a.display_name || a.name}
            </button>`)}
          ${extraActions.map((a, idx) => html`
            <button type="button" key=${'x' + idx} class="btn-ghost koti-prompt-menu-item"
              disabled=${busy || a.disabled}
              onClick=${(e) => { stop(e); run(a.run); }}>
              ${a.label}
            </button>`)}
        </div>`}

      ${bodyShown && html`
        <pre class="koti-prompt-body">${prompt || loadingLabel || tr('home.mat.loading', 'Loading…')}</pre>`}
    </div>`;
}

export default PromptCard;
