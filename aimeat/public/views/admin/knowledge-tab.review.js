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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the five actions as boxed radio
 *     choices, shared fields, the trail as list rows, the create form in the shared aside.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Badge } from './shared.js';
import { Section, Columns, Stack, ListRow, Field, Action, Surface, Text } from '/components/poster-parts.js';
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

  return html`<${Section} id="adm-kn-04" title=${S('review.title')} count="04"
    actions=${html`<${Action} onClick=${onClose}>${S('review.back')}<//>`}>
    <${Stack}>
      <${Stack} density="compact">
        <${Text} kind="heading">${pkg.name}<//>
        <${Text} kind="lead">${S('review.lead', {
          kind: pkg.content_type, entries: num(pkg.entries_count), author: pkg.author || '—',
        })}<//>
        <${Text} kind="mono" tone="muted">${pkg.package_id} · ${String(pkg.created || '').slice(0, 10)}<//>
      <//>

      <${Columns} collapse=${900}>
        <${Stack}>
          <${Text} kind="label">${S('review.whatYouCanDo')}<//>
          <${Stack} role="radiogroup" label=${S('review.whatYouCanDo')} density="compact">
            ${ACTIONS.map(a => html`<${Action} key=${a} kind="choice" semantics="radio" selected=${form.action === a}
              title=${S('review.action.' + a)} onClick=${() => setForm({ ...form, action: a })}>
              <${Stack} density="compact">
                <${Text} kind="caption">${S('review.does.' + a)}<//>
                <span><${Badge} type=${TONE[a]} label=${S('review.effect.' + a)} /></span>
              <//>
            <//>`)}
          <//>

          <${Field} type="select" label=${S('review.reason')} value=${form.reason}
            options=${REASONS.map(r => ({ value: r, label: S('review.reasons.' + r) }))}
            onChange=${e => setForm({ ...form, reason: e.target.value })} />
          ${form.reason === 'custom' ? html`<${Field} label=${S('review.customReason')} value=${form.customText}
            onInput=${e => setForm({ ...form, customText: e.target.value })} />` : null}

          <${Stack} direction="horizontal">
            <${Action} kind="primary" disabled=${busy}
              onClick=${() => onSubmit(pkg.package_id, form)}>${S('review.submit')}<//>
          <//>
        <//>

        <${Stack}>
          <${Text} kind="label">${S('review.trailTitle')}<//>
          ${trail === null ? html`<${Text} kind="caption" tone="muted">${S('review.trailLoading')}<//>`
            : sorted.length === 0 ? html`<${Text} tone="muted">${S('review.trailNone')}<//>`
              : html`<div>${sorted.map((r, i) => html`<${ListRow} key=${i} density="compact"
                  name=${S('review.reasons.' + r.reason)} detail=${`${when(r.timestamp)} · ${r.operatorGaii}`}
                  value=${html`<${Badge} type=${TONE[r.action] || 'muted'} label=${S('review.action.' + r.action)} />`}>
                  ${r.customText ? html`<${Text} kind="caption">${r.customText}<//>` : null}
                <//>`)}</div>`}
          <${Text} kind="caption" tone="muted">${S('review.trailNote')}<//>
        <//>
      <//>
    <//>
  <//>`;
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

  const kindWord = (c) => (t('knowledge.contentType.' + c) === 'knowledge.contentType.' + c ? c : t('knowledge.contentType.' + c));

  return html`<${Surface} kind="aside">
    <${Stack}>
      <${Text} kind="label">${S('create.title')}<//>
      <${Field} label=${S('create.name')} value=${form.name} onInput=${e => set({ name: e.target.value })} />
      <${Columns} collapse=${600}>
        <${Field} type="select" label=${S('create.kind')} value=${form.content_type}
          options=${CONTENT_TYPES.map(c => ({ value: c, label: kindWord(c) }))}
          onChange=${e => set({ content_type: e.target.value })} />
        <${Stack} density="compact">
          <${Field} type="select" label=${S('create.maturity')} value=${form.maturity}
            options=${MATURITIES.map(m => ({ value: m, label: t('knowledge.maturity.' + m) }))}
            onChange=${e => set({ maturity: e.target.value })} />
          <${Text} kind="caption" tone="muted">${S('create.maturityWhy')}<//>
        <//>
      <//>
      <${Field} label=${S('create.tags')} value=${form.tags} placeholder="one, two, three"
        onInput=${e => set({ tags: e.target.value })} />
      <${Stack} density="compact">
        <${Field} type="checkbox" label=${S('create.public')} value=${form.visibility === 'public'}
          onChange=${e => set({ visibility: e.target.checked ? 'public' : 'private' })} />
        <${Text} kind="caption" tone="muted">${S('create.publicWhy')}<//>
      <//>

      <${Stack}>
        ${form.entries.map((entry, i) => html`<${Stack} key=${i} density="compact">
          <${Field} label=${S('create.entryTitle', { n: i + 1 })} value=${entry.title} onInput=${e => setEntry(i, 'title', e.target.value)} />
          <${Field} type="textarea" rows=${3} label=${S('create.entryContent')} value=${entry.content}
            onInput=${e => setEntry(i, 'content', e.target.value)} />
          ${form.entries.length > 1 ? html`<${Stack} direction="horizontal">
            <${Action} tone="danger" onClick=${() => set({ entries: form.entries.filter((_, j) => j !== i) })}>
              ${S('create.removeEntry')}<//>
          <//>` : null}
        <//>`)}
        <${Stack} direction="horizontal">
          <${Action} onClick=${() => set({ entries: [...form.entries, { title: '', content: '' }] })}>${S('create.addEntry')}<//>
        <//>
      <//>

      <${Stack} direction="wrap" align="center">
        <${Action} kind="primary" disabled=${!ready || busy} onClick=${() => onCreate(form)}>${S('create.submit')}<//>
        <${Action} kind="text" onClick=${onCancel}>${S('create.cancel')}<//>
      <//>
    <//>
  <//>`;
}
