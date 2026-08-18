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
 *   v1.0.0 -- 2026-05-31 -- Extracted from agents-tasks-subtab.js so the Quality
 *     tab can reuse the same rating modal.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';

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
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('profile.agents.tasks.rate.title')}>
    <p class="pf-agd-modal-help">${t('profile.agents.tasks.rate.help')}</p>
    <div class="pf-agd-rate-stars" role="radiogroup">
      ${[1, 2, 3, 4, 5].map(n => html`
        <button key=${n}
                class=${`pf-agd-rate-star ${n <= stars ? 'pf-agd-rate-star--on' : ''}`}
                onClick=${() => setStars(n)}
                aria-label=${String(n)}
                aria-pressed=${n <= stars}>★</button>
      `)}
    </div>
    <label class="pf-agd-rate-field">
      <span>${t('profile.agents.tasks.rate.context')}</span>
      <select value=${context} onChange=${e => setContext(e.target.value)}>
        ${RATE_CONTEXTS.map(c => html`<option key=${c} value=${c}>${t(`profile.agents.detail.quality.contexts.${c}`)}</option>`)}
      </select>
    </label>
    <label class="pf-agd-rate-check">
      <input type="checkbox" checked=${grounded} onChange=${e => setGrounded(e.target.checked)} />
      <span>${t('profile.agents.tasks.rate.grounded')}</span>
    </label>
    <textarea
      class="pf-agd-revision-textarea"
      placeholder=${t('profile.agents.tasks.rate.commentPlaceholder')}
      value=${comment}
      onInput=${e => setComment(e.target.value)}
      rows=${3}
    ></textarea>
    <div class="modal-footer">
      <button class="btn-ghost" onClick=${onClose} disabled=${submitting}>${t('common.cancel') || 'Cancel'}</button>
      <button class="btn-primary" onClick=${handleSend} disabled=${submitting || !stars}>
        ${submitting ? t('profile.agents.tasks.rate.submitting') : t('profile.agents.tasks.rate.submit')}
      </button>
    </div>
  <//>`;
}
