/**
 * @file public/views/profile/offers/wizard-sources.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Step 1 of a new data product (design canvas "Data ulos", board Vaihe1-Lahde): the
 *   sources, A, B and on, each one of six kinds (a workspace's records, an app's data, an agent's or a
 *   workflow's result in memory, an extension's action, a stored file, another data product), and how
 *   several combine: their own tables, one table of rows appended, or enriched by a key. Each source
 *   names only what the owner can pick: their organisms and workspaces, apps, extensions, stored CSV
 *   and Excel files and packages (js/services/dataproducts.js listSourceChoices); what the node read
 *   from a source on the last try is said under it. Made of the component kit.
 * @structure stepSources · sourceSpec · sourcesReady · KINDS
 * @usage const body = stepSources(s);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D9.1, D9.9).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { num } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import * as dp from '/js/services/dataproducts.js';
import { Box, BoxList } from '/components/Box.js';
import { Field, Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { Tabs } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Section } from '/components/Section.js';
import { d } from './data-model.js';

/** The six kinds, in the canvas's order (agent or workflow results live in a memory key). */
export const KINDS = ['records', 'app', 'memory', 'extension', 'file', 'datapackage'];
/** The fields each kind needs (services/dataproduct/definition.ts normaliseDefinition). */
const NEEDS = { records: ['organism_id', 'ws', 'space'], app: ['app', 'key_prefix'], memory: ['key'], extension: ['ext', 'action'], file: ['key'], datapackage: ['name'] };
const FIELDS = { records: ['organism_id', 'ws', 'space'], app: ['app', 'key_prefix', 'rows_at'], memory: ['key', 'rows_at'], extension: ['ext', 'action', 'input', 'rows_at'], file: ['key', 'sheet'], datapackage: ['name', 'resource'] };

/** An extension action's input: a JSON object as typed, or plain words as its query (the field's hint). */
function inputOf(words) {
  try {
    const v = JSON.parse(words);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { query: words };
  } catch (err) {
    swallowed('wizard: the input is words, not JSON', err);
    return { query: words };
  }
}

/** One source of the draft as the definition takes it: its id, its kind and the fields it holds. */
export function sourceSpec(src) {
  const out = { id: src.id, kind: src.kind };
  for (const f of FIELDS[src.kind]) {
    const v = typeof src[f] === 'string' ? src[f].trim() : src[f];
    if (v === undefined || v === '') continue;
    if (f === 'input') { out.input = inputOf(v); continue; }
    out[f] = v;
  }
  return out;
}

export const sourcesReady = (draft) => draft.sources.length > 0
  && draft.sources.every((src) => NEEDS[src.kind].every((f) => String(src[f] || '').trim()))
  && (draft.sources.length < 2 || draft.combine.mode !== 'join' || (!!draft.combine.left && !!draft.combine.right));

/** The first letter no source has: A, B, C … (a removed source frees its letter). */
const nextId = (sources) => {
  const used = new Set(sources.map((x) => x.id));
  for (let i = 0; i < 26; i++) { const id = String.fromCharCode(65 + i); if (!used.has(id)) return id; }
  return `S${sources.length}`;
};

/** The workspaces of the organism a records source names, read when it is picked. */
function WorkspacePick({ src, set }) {
  const [list, setList] = useState([]);
  useEffect(() => { if (src.organism_id) dp.listWorkspaces(src.organism_id).then(setList); else setList([]); }, [src.organism_id]);
  return html`<${Select} label=${d('src.ws')} value=${src.ws || ''} disabled=${!src.organism_id}
    placeholder=${d('src.pick')} options=${list} onChange=${(v) => set({ ws: v })} />`;
}

/** The fields of one source, by its kind: a pick where the owner's things are known, a typed field otherwise. */
function SourceFields({ src, set, choices }) {
  const pickOrType = (field, list, label, hint) => (list && list.length
    ? html`<${Select} label=${label} hint=${hint} value=${src[field] || ''} placeholder=${d('src.pick')} options=${list} onChange=${(v) => set({ [field]: v })} />`
    : html`<${TextField} label=${label} hint=${hint} code value=${src[field] || ''} onInput=${(v) => set({ [field]: v })} />`);
  const c = choices || {};
  switch (src.kind) {
    case 'records': return html`<${Fields} cols=${3}>
      ${pickOrType('organism_id', c.organisms, d('src.organism'))}
      <${WorkspacePick} src=${src} set=${set} />
      <${TextField} label=${d('src.space')} hint=${d('src.spaceHint')} value=${src.space || ''} onInput=${(v) => set({ space: v })} /><//>`;
    case 'app': return html`<${Fields} cols=${3}>
      ${pickOrType('app', c.apps, d('src.app'))}
      <${TextField} label=${d('src.keyPrefix')} hint=${d('src.keyPrefixHint')} code value=${src.key_prefix || ''} onInput=${(v) => set({ key_prefix: v })} />
      <${TextField} label=${d('src.rowsAt')} hint=${d('src.rowsAtHint')} code value=${src.rows_at || ''} onInput=${(v) => set({ rows_at: v })} /><//>`;
    case 'memory': return html`<${Fields} cols=${2}>
      <${TextField} label=${d('src.key')} hint=${d('src.keyHint')} code value=${src.key || ''} onInput=${(v) => set({ key: v })} />
      <${TextField} label=${d('src.rowsAt')} hint=${d('src.rowsAtHint')} code value=${src.rows_at || ''} onInput=${(v) => set({ rows_at: v })} /><//>`;
    case 'extension': return html`<${Fields} cols=${2}>
      ${pickOrType('ext', c.extensions, d('src.ext'))}
      <${TextField} label=${d('src.action')} code value=${src.action || ''} onInput=${(v) => set({ action: v })} />
      <${TextArea} label=${d('src.input')} hint=${d('src.inputHint')} code rows=${3} value=${src.input || ''} onInput=${(v) => set({ input: v })} />
      <${TextField} label=${d('src.rowsAt')} hint=${d('src.rowsAtHint')} code value=${src.rows_at || ''} onInput=${(v) => set({ rows_at: v })} /><//>`;
    case 'file': return html`<${Fields} cols=${2}>
      ${pickOrType('key', c.files, d('src.file'), d('src.fileHint'))}
      <${TextField} label=${d('src.sheet')} hint=${d('src.sheetHint')} value=${src.sheet || ''} onInput=${(v) => set({ sheet: v })} /><//>`;
    default: return html`<${Fields} cols=${2}>
      ${pickOrType('name', c.packages, d('src.package'))}
      <${TextField} label=${d('src.resource')} hint=${d('src.resourceHint')} code value=${src.resource || ''} onInput=${(v) => set({ resource: v })} /><//>`;
  }
}

/** What the last try read from one source: its rows and columns, or nothing yet. */
function triedLine(probe, src, i) {
  const s = (probe?.sources || []).find((x) => x.id === src.id);
  const r = (probe?.resources || [])[i];
  if (!s) return d('src.notTried');
  return d('src.tried', { rows: num(s.rows), cols: num(r?.schema?.fields?.length || 0) });
}

/** The columns a source had on the last try, for the join key. */
const columnsOf = (probe, i) => ((probe?.resources || [])[i]?.schema?.fields || []).map((f) => f.name);

export function stepSources(s) {
  const { draft, setDraft, choices, probe } = s;
  const setSource = (id, patch) => setDraft((cur) => ({ sources: cur.sources.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const add = (kind) => setDraft((cur) => ({ sources: [...cur.sources, { id: nextId(cur.sources), kind }] }));
  const remove = (id) => setDraft((cur) => ({ sources: cur.sources.filter((x) => x.id !== id), columns: cur.columns.filter((c) => c.source !== id) }));
  const many = draft.sources.length > 1;
  const [a, b] = draft.sources;
  const keyOptions = (i, src) => columnsOf(probe, i).map((c) => [`${src.id}.${c}`, `${src.id}.${c}`]);
  return html`
    <${Section} id="wz-sources" title=${d('src.title')} count=${d('src.count', { n: draft.sources.length })} first=${true}>
      ${draft.sources.length ? html`<${BoxList}>
        ${draft.sources.map((src, i) => html`<${Box} key=${src.id} tone="row" name=${`${src.id} · ${d('kind.' + src.kind)}`}
          end=${html`<${Action} small soft tone="danger" onClick=${() => remove(src.id)}>${d('src.remove')}<//>`}>
          <${SourceFields} src=${src} set=${(patch) => setSource(src.id, patch)} choices=${choices} />
          <${Note} kind="meta" mono>${triedLine(probe, src, i)}<//>
        <//>`)}
      <//>` : html`<${Note} kind="quiet">${d('src.none')}<//>`}
      <${Field} label=${d('src.add')} group>
        <${Tabs} tone="filter" kind="view" label=${d('src.kindLabel')} value=""
          onSelect=${add} items=${KINDS.map((k) => ({ value: k, label: d('kind.' + k) }))} />
      <//>
    <//>
    ${many ? html`<${Section} id="wz-combine" title=${d('combine.title', { ids: draft.sources.map((x) => x.id).join(', ') })}>
      <${Choice} boxed cols=${3} dot name="wz-combine" ariaLabel=${d('combine.title', { ids: draft.sources.map((x) => x.id).join(', ') })} value=${draft.combine.mode}
        onChange=${(v) => setDraft((cur) => ({ combine: { ...cur.combine, mode: v } }))}
        options=${['tables', 'union', 'join'].map((m) => ({ value: m, label: d('combine.' + m), hint: d('combine.' + m + 'Hint') }))} />
      ${draft.combine.mode === 'join' ? html`<${Fields} cols=${2}>
        <${Select} label=${d('combine.keyLeft', { id: a.id })} value=${draft.combine.left} placeholder=${probe ? d('src.pick') : d('combine.tryFirst')}
          options=${keyOptions(0, a)} onChange=${(v) => setDraft((cur) => ({ combine: { ...cur.combine, left: v } }))} />
        <${Select} label=${d('combine.keyRight', { id: b.id })} value=${draft.combine.right} placeholder=${probe ? d('src.pick') : d('combine.tryFirst')}
          options=${keyOptions(1, b)} onChange=${(v) => setDraft((cur) => ({ combine: { ...cur.combine, right: v } }))} />
      <//>` : null}
      ${draft.combine.mode === 'join' ? html`<${Action} small disabled=${s.busy || !draft.sources.every((src) => NEEDS[src.kind].every((f) => String(src[f] || '').trim()))}
        onClick=${s.tryProbeOnly}>${d('combine.tryNow')}<//>` : null}
    <//>` : null}
    <${Note} kind="aside" size="small">${d('src.provenance')}<//>`;
}
