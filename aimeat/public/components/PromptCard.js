/**
 * @file public/components/PromptCard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt block: a label, a one-click copy, and — where it makes sense — a corner
 *   menu with the two things a person actually wants next.
 *
 *   It was the same shape written four times in views/home (step-mat, step-agent, step-branch-b,
 *   welcome-door). The shared poster parts now own its surfaces, typography and controls.
 *
 *   The primary button stays ONE CLICK with no menu in front of it. That is the whole rule for this
 *   component: copying is the thing people came to do, and putting a chooser in its way to make
 *   room for two rarer options would be a worse product sold as a better one. Everything else lives
 *   behind the chevron, and the chevron only appears when there is something behind it.
 *
 *   "Give it to an agent" appears only when an agent that actually drains a queue exists
 *   (services/open-items.js reachableAgents). Offering a name that will sit there forever is a
 *   graveyard, not a feature.
 * @structure PromptCard({ label, prompt, kind, copyLabel, copiedLabel, onCopied,
 *   saveIntent, agents, onGiveToAgent, showPrompt })
 * @usage
 *   html`<${PromptCard} label=${t('...')} prompt=${text} copyLabel=${t('...')} />`
 * @version-history
 *   2026-09-13: Compose prompts from shared poster parts with a bounded action kind.
 *   v1.0.0 — 2026-08-09 — Extracted from four call sites in views/home (intent pool, phase 2).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Surface, Stack, Text, Action } from '/components/poster-parts.js';

const html = htm.bind(h);

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function PromptCard({
  label,
  prompt,
  kind = 'secondary',
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
    <${Surface} onClick=${hasMenu ? stop : undefined}><${Stack}>
      <${Stack} direction="wrap" align="between">
        <${Text} kind="label">${label}<//>
        <${Stack} direction="horizontal" align="center" density="compact">
          <${CopyButton} text=${prompt} className=${kind === 'primary' ? 'poster-slab' : 'poster-action'}
            label=${copyLabel} copiedLabel=${copiedLabel} onCopied=${onCopied} />
          ${hasMenu && html`<${Action} kind="icon" expanded=${open} label=${tr('prompt.more', 'More')}
            onClick=${(e) => { stop(e); setOpen(v => !v); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          <//>`}
        <//>
      <//>
      ${open && html`<${Stack} density="compact">
        <${Action} onClick=${(e) => { stop(e); setBodyShown(v => !v); setOpen(false); }}>
          ${bodyShown ? tr('prompt.hideText', 'Hide the prompt') : tr('prompt.showText', 'Show the prompt')}<//>
        ${saveIntent && html`<${Action} disabled=${busy || saved}
          onClick=${(e) => { stop(e); run(saveIntent, () => setSaved(true)); }}>
          ${saved ? tr('prompt.saved', 'Waiting on your list') : tr('prompt.save', 'Leave it waiting')}<//>`}
        ${canGive && agents.map(a => html`<${Action} key=${a.gaii || a.name} disabled=${busy}
          onClick=${(e) => { stop(e); run(() => onGiveToAgent(a)); }}>
          ${tr('prompt.giveTo', 'Give it to')} ${a.display_name || a.name}<//>`)}
        ${extraActions.map((a, idx) => html`<${Action} key=${'x' + idx} disabled=${busy || a.disabled}
          onClick=${(e) => { stop(e); run(a.run); }}>${a.label}<//>`)}
      <//>`}
      ${bodyShown && html`<${Surface} kind="code" tone="muted">${prompt || loadingLabel || tr('home.mat.loading', 'Loading…')}<//>`}
    <//><//>`;
}

export default PromptCard;
