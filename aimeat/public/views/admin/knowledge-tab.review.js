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
 *   v2.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7): the
 *     section is Section, the package's head the Verdict (name, line, stamp), the five outcomes radio
 *     Checks with what each does and its effect mark, the reason a Select, the trail a List, the
 *     create form the Field family in the SettingBox. No class.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Badge, Empty } from './shared.js';
import { getKnowledgeReviews } from '/js/services/admin.js';
import { Section } from '/components/Section.js';
import { Verdict } from '/components/Readings.js';
import { List, Row, Name } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Beside, Split, Stack } from '/components/Layout.js';

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

  const trailPart = html`
    <${Label} block>${S('review.trailTitle')}<//>
    ${trail === null ? html`<${Note} kind="loading">${S('review.trailLoading')}<//>`
      : sorted.length === 0 ? html`<${Empty} text=${S('review.trailNone')} />`
        : html`
          <${List} cols="name">
            ${sorted.map((r, i) => html`
              <${Row} key=${i}>
                <${Name} before=${html`<${Badge} type=${TONE[r.action] || 'muted'} label=${S('review.action.' + r.action)} />`}
                  desc=${r.customText || undefined} meta=${`${when(r.timestamp)} · ${r.operatorGaii}`}>${S('review.reasons.' + r.reason)}<//>
              <//>`)}
          <//>`}
    <${Note}>${S('review.trailNote')}<//>`;

  return html`
    <${Section} id="adm-kn-04" num="04" title=${S('review.title')}
      doors=${html`<${Action} small soft onClick=${onClose}>${S('review.back')}<//>`}>
      <${Verdict} word=${pkg.name}
        line=${S('review.lead', { kind: pkg.content_type, entries: num(pkg.entries_count), author: pkg.author || '—' })}
        stamp=${`${pkg.package_id} · ${String(pkg.created || '').slice(0, 10)}`} />

      <${Beside} wide above="large" side=${trailPart}>
        <${Fields}>
          <${Field} label=${S('review.whatYouCanDo')} group>
            ${ACTIONS.map(a => html`
              <${Check} key=${a} radio name="kn-action" value=${a} checked=${form.action === a}
                hint=${S('review.does.' + a)} onChange=${() => setForm({ ...form, action: a })}>
                ${S('review.action.' + a)} <${Badge} type=${TONE[a]} label=${S('review.effect.' + a)} /><//>`)}
          <//>
          <${Select} label=${S('review.reason')} value=${form.reason} onChange=${v => setForm({ ...form, reason: v })}
            options=${REASONS.map(r => [r, S('review.reasons.' + r)])} />
          ${form.reason === 'custom' ? html`
            <${TextField} label=${S('review.customReason')} value=${form.customText}
              onInput=${v => setForm({ ...form, customText: v })} />` : null}
          <${FormActions}>
            <${Action} small disabled=${busy} onClick=${() => onSubmit(pkg.package_id, form)}>${S('review.submit')}<//>
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

  return html`
    <${SettingBox} label=${S('create.title')}>
      <${Fields}>
        <${TextField} label=${S('create.name')} value=${form.name} onInput=${v => set({ name: v })} />
        <${Fields} cols=${2}>
          <${Select} label=${S('create.kind')} value=${form.content_type} onChange=${v => set({ content_type: v })}
            options=${CONTENT_TYPES.map(c => [c, t('knowledge.contentType.' + c) === 'knowledge.contentType.' + c ? c : t('knowledge.contentType.' + c)])} />
          <${Select} label=${S('create.maturity')} hint=${S('create.maturityWhy')} value=${form.maturity}
            onChange=${v => set({ maturity: v })} options=${MATURITIES.map(m => [m, t('knowledge.maturity.' + m)])} />
        <//>
        <${TextField} label=${S('create.tags')} value=${form.tags} placeholder="one, two, three"
          onInput=${v => set({ tags: v })} />
        <${Check} checked=${form.visibility === 'public'} hint=${S('create.publicWhy')}
          onChange=${on => set({ visibility: on ? 'public' : 'private' })}>${S('create.public')}<//>

        <${Split} heavy>
          <${Stack} gap="large">
            ${form.entries.map((entry, i) => html`
              <${Stack} key=${i}>
                <${TextField} label=${S('create.entryTitle', { n: i + 1 })} value=${entry.title}
                  onInput=${v => setEntry(i, 'title', v)} />
                <${TextArea} code rows=${3} label=${S('create.entryContent')} value=${entry.content}
                  onInput=${v => setEntry(i, 'content', v)} />
                ${form.entries.length > 1 ? html`
                  <${Action} small onClick=${() => set({ entries: form.entries.filter((_, j) => j !== i) })}>
                    ${S('create.removeEntry')}
                  <//>` : null}
              <//>`)}
            <${Action} small soft onClick=${() => set({ entries: [...form.entries, { title: '', content: '' }] })}>
              ${S('create.addEntry')}
            <//>
          <//>
        <//>

        <${FormActions}>
          <${Action} small disabled=${!ready || busy} onClick=${() => onCreate(form)}>${S('create.submit')}<//>
          <${Action} small soft onClick=${onCancel}>${S('create.cancel')}<//>
        <//>
      <//>
    <//>`;
}
