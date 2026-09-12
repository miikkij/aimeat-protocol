/**
 * @file knowledge-tab.review.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 04 of the Knowledge page: what a review DOES, the trail it leaves, and the
 *   form that adds one. Plus the operator's own create form.
 *
 *   THE TRAIL IS THE POINT. GET /v1/knowledge/:id/reviews has existed since August and was security
 *   hardened in September, and no surface ever called it. So an operator submitted a review, the
 *   card reloaded, and it looked exactly as it had a moment before; a second operator could not
 *   tell that the first had already looked. Recording a decision nobody can read back is the same
 *   as not recording it.
 *
 *   AND THE FIVE ACTIONS ARE SPELLED OUT. `approve`, `flag`, `delist`, `restrict`, `note` were a
 *   dropdown of five words, two of which change who can read a person's knowledge. What each one
 *   does to the package is written beside it, because an operator choosing between "delist" and
 *   "restrict" is deciding whether somebody's work stays reachable.
 * @structure
 *   - ReviewPanel (04) — the package, its trail, the five actions, the form
 *   - CreateForm — the operator's own system package
 * @usage Imported by views/admin/knowledge-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Badge } from './shared.js';
import { getKnowledgeReviews } from '/js/services/admin.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

/** The five outcomes, in the order they cost somebody something. */
const ACTIONS = ['approve', 'note', 'flag', 'delist', 'restrict'];
const TONE = { approve: 'success', note: 'muted', flag: 'warning', delist: 'warning', restrict: 'danger' };
const REASONS = ['routine_review', 'community_report', 'content_quality', 'legal_compliance', 'storage_issue', 'custom'];

const CONTENT_TYPES = ['document', 'research', 'idea', 'plan', 'dataset', 'tutorial', 'collection', 'article', 'story', 'fiction'];
const MATURITIES = ['draft', 'review', 'published'];

/** Section 04: one package, what has been decided about it, and what you can decide now. */
export function ReviewPanel({ pkg, onClose, onSubmit, busy }) {
  const [trail, setTrail] = useState(null);
  const [form, setForm] = useState({ reason: 'routine_review', action: 'approve', customText: '' });

  useEffect(() => {
    let alive = true;
    getKnowledgeReviews(pkg.package_id)
      .then(r => { if (alive) setTrail(r?.data?.reviews || []); })
      .catch(err => {
        // The trail is detail, not the page: a failure leaves an empty list and says so below.
        console.warn('Could not read the review trail:', err.message);
        if (alive) setTrail([]);
      });
    return () => { alive = false; };
  }, [pkg.package_id]);

  const sorted = (trail || []).slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  return html`
    <section class="og-sec" id="adm-kn-04">
      <div class="og-sec-h">
        <h2>${S('review.title')}<small>04</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onClose}>${S('review.back')}</button>
        </div>
      </div>

      <div class="adm-ov-status">${pkg.name}</div>
      <p class="adm-alert-line">${S('review.lead', {
    kind: pkg.content_type, entries: num(pkg.entries_count), author: pkg.author || '—',
  })}</p>
      <div class="adm-ov-up">${pkg.package_id} · ${String(pkg.created || '').slice(0, 10)}</div>

      <div class="adm-kn-two">
        <div>
          <div class="adm-kn-lbl">${S('review.whatYouCanDo')}</div>
          ${ACTIONS.map((a, i) => html`
            <label class="adm-kn-choice ${form.action === a ? 'on' : ''}">
              <input type="radio" name="kn-action" checked=${form.action === a}
                onChange=${() => setForm({ ...form, action: a })} />
              <span>
                <b>${S('review.action.' + a)}</b>
                <span class="adm-why">${S('review.does.' + a)}</span>
              </span>
              <${Badge} type=${TONE[a]} label=${S('review.effect.' + a)} />
              ${i === ACTIONS.length - 1 ? null : null}
            </label>`)}

          <div class="adm-kn-fld">
            <label>${S('review.reason')}</label>
            <select value=${form.reason} onChange=${e => setForm({ ...form, reason: e.target.value })}>
              ${REASONS.map(r => html`<option value=${r}>${S('review.reasons.' + r)}</option>`)}
            </select>
          </div>
          ${form.reason === 'custom' ? html`
            <div class="adm-kn-fld">
              <label>${S('review.customReason')}</label>
              <input type="text" value=${form.customText}
                onInput=${e => setForm({ ...form, customText: e.target.value })} />
            </div>` : null}

          <div class="adm-kn-acts">
            <button type="button" class="og-door" disabled=${busy}
              onClick=${() => onSubmit(pkg.package_id, form)}>${S('review.submit')}</button>
          </div>
        </div>

        <div>
          <div class="adm-kn-lbl">${S('review.trailTitle')}</div>
          ${trail === null ? html`<p class="adm-why">${S('review.trailLoading')}</p>`
    : sorted.length === 0 ? html`
      <div class="adm-kn-empty">${S('review.trailNone')}</div>`
      : html`
        <div class="adm-kn-trail">
          ${sorted.map(r => html`
            <div class="adm-kn-trail-row">
              <div class="adm-kn-trail-head">
                <${Badge} type=${TONE[r.action] || 'muted'} label=${S('review.action.' + r.action)} />
                <span>${S('review.reasons.' + r.reason)}</span>
              </div>
              ${r.customText ? html`<p class="adm-why">${r.customText}</p>` : null}
              <div class="adm-kn-when">${when(r.timestamp)} · ${r.operatorGaii}</div>
            </div>`)}
        </div>`}
          <p class="adm-kn-note">${S('review.trailNote')}</p>
        </div>
      </div>
    </section>`;
}

/** The operator's own package. Kept from the old page, in the face the rest of it now wears. */
export function CreateForm({ onCreate, onCancel, busy }) {
  const [form, setForm] = useState({
    name: '', content_type: 'document', tags: '', maturity: 'published',
    visibility: 'public', catalog_listed: true, entries: [{ title: '', content: '' }],
  });
  const set = (patch) => setForm({ ...form, ...patch });
  const setEntry = (i, k, v) => set({ entries: form.entries.map((e, j) => (i === j ? { ...e, [k]: v } : e)) });
  const ready = form.name.trim() && form.entries.some(e => e.title.trim());

  return html`
    <div class="adm-kn-newbox">
      <span class="adm-kn-newlabel">${S('create.title')}</span>
      <div class="adm-kn-form">
        <div class="adm-kn-fld">
          <label>${S('create.name')}</label>
          <input type="text" value=${form.name} onInput=${e => set({ name: e.target.value })} />
        </div>
        <div class="adm-kn-fld-row">
          <div class="adm-kn-fld">
            <label>${S('create.kind')}</label>
            <select value=${form.content_type} onChange=${e => set({ content_type: e.target.value })}>
              ${CONTENT_TYPES.map(c => html`<option value=${c}>${t('knowledge.contentType.' + c) === 'knowledge.contentType.' + c ? c : t('knowledge.contentType.' + c)}</option>`)}
            </select>
          </div>
          <div class="adm-kn-fld">
            <label>${S('create.maturity')}</label>
            <select value=${form.maturity} onChange=${e => set({ maturity: e.target.value })}>
              ${MATURITIES.map(m => html`<option value=${m}>${t('knowledge.maturity.' + m)}</option>`)}
            </select>
            <span class="adm-why">${S('create.maturityWhy')}</span>
          </div>
        </div>
        <div class="adm-kn-fld">
          <label>${S('create.tags')}</label>
          <input type="text" value=${form.tags} placeholder="one, two, three"
            onInput=${e => set({ tags: e.target.value })} />
        </div>
        <label class="adm-kn-check">
          <input type="checkbox" checked=${form.visibility === 'public'}
            onChange=${e => set({ visibility: e.target.checked ? 'public' : 'private' })} />
          <span><b>${S('create.public')}</b><span class="adm-why">${S('create.publicWhy')}</span></span>
        </label>

        <div class="adm-kn-entries">
          ${form.entries.map((entry, i) => html`
            <div class="adm-kn-entry">
              <div class="adm-kn-fld">
                <label>${S('create.entryTitle', { n: i + 1 })}</label>
                <input type="text" value=${entry.title} onInput=${e => setEntry(i, 'title', e.target.value)} />
              </div>
              <div class="adm-kn-fld">
                <label>${S('create.entryContent')}</label>
                <textarea rows="3" value=${entry.content}
                  onInput=${e => setEntry(i, 'content', e.target.value)}></textarea>
              </div>
              ${form.entries.length > 1 ? html`
                <button type="button" class="og-door og-door--up"
                  onClick=${() => set({ entries: form.entries.filter((_, j) => j !== i) })}>
                  ${S('create.removeEntry')}
                </button>` : null}
            </div>`)}
          <button type="button" class="og-door og-door--quiet"
            onClick=${() => set({ entries: [...form.entries, { title: '', content: '' }] })}>
            ${S('create.addEntry')}
          </button>
        </div>

        <div class="adm-kn-acts">
          <button type="button" class="og-door" disabled=${!ready || busy}
            onClick=${() => onCreate(form)}>${S('create.submit')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${onCancel}>${S('create.cancel')}</button>
        </div>
      </div>
    </div>`;
}
