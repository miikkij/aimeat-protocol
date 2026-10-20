/**
 * @file public/views/profile/memory-tab/file-facts-fields.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fields a model picked out of a stored file for one content class, in the file's
 *   fold (memory-tab/file-facts.js). Jouni, 2026-10-21: "Where do I see the extracted invoice
 *   fields?", and he did not see the OWL, the extracted content in that form, nor how to correct it.
 *
 *   One part per class: the class's name, then one row per property of the class (its `properties`:
 *   its label in the page language, its `describe` on the line under it) with the value the
 *   entity holds under cc:<classId>.<name>, "not stated" when it holds none; under the table how
 *   certain the extraction was and which model made it, and "Corrected by you on <date>" when the
 *   person corrected it (a corrected row carries the mark).
 *   - Edit turns the values into fields by the property's type (a number, a date, a yes-or-no, text);
 *     Save sends only the changed names to POST /v1/content/correct { source, fields: { [classId]:
 *     { [name]: value } } }, an emptied field as null.
 *   - Show JSON-LD shows the entity as it is stored.
 *   - Show the OWL class reads GET /v1/content/ontology?format=jsonld when first opened and shows the
 *     class's owl:Class node and its owl:DatatypeProperty nodes.
 *   - Extract again runs POST /v1/content/inspect { source, stages: ['extract'], force: true }; the
 *     server keeps the values the person corrected. A refusal (the AI step needs ai:use) is shown as
 *     the server words it.
 * @structure EntityPart({ classId, entry, cls, classes, source, onFacts }) · valueWords · draftOf · changedFields
 * @usage html`<${EntityPart} classId="invoice" entry=${facts.entities.invoice} cls=${cls} classes=${classes} source=${source} onFacts=${setFacts} />`
 *   A class with no entity yet (removed and added back, or never extracted) still gets its part:
 *   "Nothing picked out for this class yet." and Extract again, without Edit and JSON-LD.
 * @version-history
 *   v1.1.1 — 2026-10-21 — A property's English `describe` shows as its hint on an English page only
 *     (propertyHint); in Finnish or Spanish the label carries the field.
 *   v1.1.0 — 2026-10-21 — A part without an entity (`entry` absent) says nothing was picked out and
 *     keeps Extract again; a property's name is its label in the page language (propertyLabel).
 *   v1.0.0 — 2026-10-21 — Initial (Jouni's look of 2026-10-21).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { Space } from '/components/Layout.js';
import { Facts } from '/components/Facts.js';
import { Label, Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { cc, classLabel, correctItem, inspectItem, readOwlClass, percent, propertyLabel, propertyHint } from '../data-wallet/content-facts.js';

const html = htm.bind(h);
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || fallback;
const has = (v) => v !== undefined && v !== null && v !== '';

/** A stored value in words: yes or no for a boolean, the value itself otherwise. */
export function valueWords(v) {
  if (typeof v === 'boolean') return v ? cc('yes') : cc('no');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The edit form's starting values: a boolean stays a boolean, everything else is text. */
export function draftOf(props, entity, classId) {
  const out = {};
  for (const p of props) {
    const v = entity?.[`cc:${classId}.${p.name}`];
    out[p.name] = p.type === 'boolean' ? v === true : has(v) ? String(v) : '';
  }
  return out;
}

/**
 * The changed names only, each as the value the server takes: null for an emptied field, a number
 * for a number property when the text reads as one (otherwise the text, which the server refuses
 * with INVALID_INPUT naming the property), a boolean for a yes-or-no.
 */
export function changedFields(props, before, after) {
  const out = {};
  for (const p of props) {
    if (before[p.name] === after[p.name]) continue;
    const v = after[p.name];
    if (p.type === 'boolean') out[p.name] = !!v;
    else if (v === '' || v === null || v === undefined) out[p.name] = null;
    else if (p.type === 'number') out[p.name] = Number.isFinite(Number(v)) ? Number(v) : v;
    else out[p.name] = v;
  }
  return out;
}

/** One property's field in the edit form, by its type. */
function field(p, value, set, busy) {
  const label = propertyLabel(p);
  if (p.type === 'boolean') return html`<${Check} key=${p.name} checked=${!!value} disabled=${busy} hint=${propertyHint(p)} onChange=${(on) => set(p.name, on)}>${label}<//>`;
  const type = p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : undefined;
  return html`<${TextField} key=${p.name} label=${label} hint=${propertyHint(p)} type=${type} step=${type === 'number' ? 'any' : undefined} value=${value} disabled=${busy} onInput=${(v) => set(p.name, v)} />`;
}

/**
 * @param {{ classId: string, entry: any, cls: any, classes: any[], source: any, onFacts: (facts: any) => void }} props
 */
export function EntityPart({ classId, entry, cls, classes, source, onFacts }) {
  const entity = entry?.entity || {};
  const props = cls?.properties || [];
  const corrected = entry?.corrected || null;
  const fixed = new Set(corrected?.properties || []);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [start, setStart] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [owl, setOwl] = useState(null);

  const edit = () => { const d = draftOf(props, entity, classId); setStart(d); setDraft(d); setMsg(null); setEditing(true); };
  const set = (name, v) => setDraft((d) => ({ ...d, [name]: v }));
  const save = async () => {
    const changed = changedFields(props, start, draft);
    if (!Object.keys(changed).length) { setEditing(false); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await correctItem({ source, fields: { [classId]: changed } });
      if (r.facts) onFacts(r.facts);
      setEditing(false);
      setMsg({ text: r.review ? cc('reviewMarked') : cc('saved') });
    } catch (e) { setMsg({ text: errText(e, cc('saveFailed')), error: true }); }
    setBusy(false);
  };
  const extract = async () => {
    setBusy(true); setMsg(null);
    try {
      const f = await inspectItem(source, { stages: ['extract'], force: true });
      if (f) onFacts(f);
      setMsg({ text: cc('extracted') });
    } catch (e) { setMsg({ text: errText(e, cc('inspectFailed')), error: true }); }
    setBusy(false);
  };
  const loadOwl = async (opened) => {
    if (!opened || owl) return;
    try { setOwl({ nodes: await readOwlClass(classId) }); } catch (e) { setOwl({ error: errText(e, cc('ontologyFailed')) }); }
  };

  const rows = props.map((p) => {
    const v = entity[`cc:${classId}.${p.name}`];
    const mark = fixed.has(p.name) ? html` <${Mark} tone="ink">${cc('correctedMark')}<//>` : null;
    return { key: p.name, k: propertyLabel(p), v: has(v) ? html`${valueWords(v)}${mark}` : cc('notStated'), missing: !has(v), sub: propertyHint(p) };
  });
  const meta = [
    typeof entry?.confidence === 'number' ? cc('certainty', { pct: percent(entry.confidence) }) : '',
    entry?.model ? cc('byModel', { model: entry.model }) : '',
  ].filter(Boolean).join(' · ');
  const owlBody = !owl ? html`<${Note} kind="loading">${t('dwpage.loading')}<//>`
    : owl.error ? html`<${Note} kind="message" error>${owl.error}<//>`
    : html`<${Code} block scroll="medium">${JSON.stringify(owl.nodes, null, 2)}<//>`;

  return html`
    <${Space} above="medium">
      <${Label} block>${cc('fieldsOf', { cls: classLabel(classes, classId) })}<//>
      ${editing ? html`
        <${Fields}>
          ${props.map((p) => field(p, draft[p.name], set, busy))}
          <${FormActions}>
            <${Loud} control disabled=${busy} onClick=${save}>${busy ? cc('saving') : cc('save')}<//>
            <${Action} small soft disabled=${busy} onClick=${() => setEditing(false)}>${cc('cancel')}<//>
          <//>
        <//>` : html`
        ${!entry ? html`<${Note} kind="quiet">${cc('nothingPicked')}<//>`
          : rows.length ? html`<${Facts} rows=${rows} />` : html`<${Note} kind="quiet">${cc('noProperties')}<//>`}
        ${meta ? html`<${Note} kind="hint">${meta}<//>` : null}
        ${corrected ? html`<${Note} kind="hint">${cc('correctedOn', { date: fmtDate(corrected.at) })}<//>` : null}
        <${Actions}>
          ${entry && props.length ? html`<${Action} small disabled=${busy} onClick=${edit}>${cc('editFields')}<//>` : null}
          <${Action} small disabled=${busy} onClick=${extract}>${busy ? cc('reading') : cc('extractAgain')}<//>
        <//>`}
      ${msg ? html`<${Note} kind="message" error=${!!msg.error}>${msg.text}<//>` : null}
      <${Folds}>
        ${entry ? html`<${FoldRow} kind="toggle" name=${cc('showJsonLd')} body=${html`<${Code} block scroll="medium">${JSON.stringify(entity, null, 2)}<//>`} />` : null}
        <${FoldRow} kind="toggle" name=${cc('showOwl')} onToggle=${loadOwl} body=${owlBody} />
      <//>
    <//>`;
}

export default EntityPart;
