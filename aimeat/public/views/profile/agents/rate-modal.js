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
 *   v1.6.0 — 2026-09-26 — Every part is a component that takes data (page group G1a): the stars are
 *     Stars (the pointer on a star shows the rating it gives), the context is the Select with its
 *     label over it (was beside it), the grounded box is Check, the comment is TextArea, the footer
 *     Action and Loud, the whole a column of Fields.
 *   v1.5.0 — 2026-09-26 — The grounded check line is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.4.0 — 2026-09-26 — The stars are the library's Rating stars in the tone to give (css/components/rating-stars.css): dark up to the rating and up to the star under the pointer, instead of coral; the row keeps only its margin (a unification: Jouni's decision "Rating stars").
 *   v1.3.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.2.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.1.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.0.1 — 2026-09-13 — Cancel and Rate sit in the dialog's footer.
 *   v1.0.0 -- 2026-05-31 -- Extracted from agents-tasks-subtab.js so the Quality
 *     tab can reuse the same rating modal.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { Note } from '/components/Note.js';
import { Stars } from '/components/Stars.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { TextArea } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { Action, Loud } from '/components/Action.js';

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
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('profile.agents.tasks.rate.title')}
    footer=${html`
      <${Action} onClick=${onClose} disabled=${submitting}>${t('common.cancel') || 'Cancel'}<//>
      <${Loud} control onClick=${handleSend} disabled=${submitting || !stars}>
        ${submitting ? t('profile.agents.tasks.rate.submitting') : t('profile.agents.tasks.rate.submit')}
      <//>`}>
    <${Fields}>
      <${Note}>${t('profile.agents.tasks.rate.help')}<//>
      <${Stars} value=${stars} onPick=${setStars} label=${t('profile.agents.tasks.rate.title')} />
      <${Select} label=${t('profile.agents.tasks.rate.context')} value=${context} onChange=${setContext}
        options=${RATE_CONTEXTS.map(c => [c, t(`profile.agents.detail.quality.contexts.${c}`)])} />
      <${Check} checked=${grounded} onChange=${setGrounded}>${t('profile.agents.tasks.rate.grounded')}<//>
      <${TextArea}
        ariaLabel=${t('profile.agents.tasks.rate.commentPlaceholder')}
        placeholder=${t('profile.agents.tasks.rate.commentPlaceholder')}
        value=${comment}
        onInput=${setComment}
        rows=${3}
      />
    <//>
  <//>`;
}
