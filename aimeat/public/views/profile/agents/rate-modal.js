/**
 * @file rate-modal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared "rate a deliverable" modal — 1–5 stars, quality context,
 *   an optional "checked against sources" flag, and a comment. Submits the
 *   POST /v1/agents/:name/tasks/:id/rate body shape. Used by both the Tasks
 *   sub-tab (rate from the task row) and the Quality tab (rate from the
 *   pending-deliverables list). Pre-fills from an existing rating so the same
 *   modal also does re-rate.
 * @structure
 *   - RATE_CONTEXTS -- the RatingContext enum (mirrors src/storage/interface.ts)
 *   - RateModal (default export) -- the modal component
 * @usage
 *   import RateModal, { RATE_CONTEXTS } from './rate-modal.js';
 *   <RateModal open onClose onSubmit submitting existing=${task.rating} />
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: a Dialog, the five stars as
 *     a group of tab actions that show their number instead of a star glyph, and the context,
 *     the source check and the comment as Fields. Same exports and props.
 *   v1.0.1 — 2026-09-13 — Cancel and Rate sit in the dialog's footer.
 *   v1.0.0 -- 2026-05-31 -- Extracted from agents-tasks-subtab.js so the Quality
 *     tab can reuse the same rating modal.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Dialog, Action, Field, Stack, Text } from '/components/poster-parts.js';

const html = htm.bind(h);

// Quality contexts an owner can pick when rating a deliverable. Mirrors the
// RatingContext enum in src/storage/interface.ts; labels come from the shared
// profile.agents.detail.quality.contexts.* i18n block.
export const RATE_CONTEXTS = ['factual', 'creative', 'code', 'planning', 'summarization', 'research', 'communication', 'other'];

export default function RateModal({ open, onClose, onSubmit, submitting, existing }) {
  const [stars, setStars] = useState(existing?.stars || 0);
  const [context, setContext] = useState(existing?.context || 'creative');
  const [grounded, setGrounded] = useState(existing?.sourceGrounded || false);
  const [comment, setComment] = useState(existing?.comment || '');
  useEffect(() => {
    if (open) {
      setStars(existing?.stars || 0);
      setContext(existing?.context || 'creative');
      setGrounded(existing?.sourceGrounded || false);
      setComment(existing?.comment || '');
    }
    // Prefill from `existing` only on the open transition; adding the existing.* fields would
    // re-run and wipe the user's in-progress edits whenever the parent record changes while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  function handleSend() {
    if (!stars) return;
    const body = { stars, context, source_grounded: grounded };
    const c = comment.trim();
    if (c) body.comment = c;
    onSubmit(body);
  }
  return html`<${Dialog} open=${open} onClose=${onClose} title=${t('profile.agents.tasks.rate.title')}
    actions=${html`
      <${Action} onClick=${onClose} disabled=${submitting}>${t('common.cancel') || 'Cancel'}<//>
      <${Action} kind="primary" onClick=${handleSend} disabled=${submitting || !stars}>
        ${submitting ? t('profile.agents.tasks.rate.submitting') : t('profile.agents.tasks.rate.submit')}
      <//>`}>
    <${Stack}>
      <${Text}>${t('profile.agents.tasks.rate.help')}<//>
      <${Stack} direction="horizontal" density="compact" align="start" role="radiogroup">
        ${[1, 2, 3, 4, 5].map(n => html`
          <${Action} key=${n} kind="tab" selected=${n <= stars} onClick=${() => setStars(n)} label=${String(n)}>${n}<//>
        `)}
      <//>
      <${Field} type="select" label=${t('profile.agents.tasks.rate.context')} value=${context}
        onChange=${e => setContext(e.target.value)}
        options=${RATE_CONTEXTS.map(c => ({ value: c, label: t(`profile.agents.detail.quality.contexts.${c}`) }))} />
      <${Field} type="checkbox" label=${t('profile.agents.tasks.rate.grounded')} value=${grounded}
        onChange=${e => setGrounded(e.target.checked)} />
      <${Field} type="textarea" placeholder=${t('profile.agents.tasks.rate.commentPlaceholder')}
        value=${comment} onInput=${e => setComment(e.target.value)} rows=${3} />
    <//>
  <//>`;
}
