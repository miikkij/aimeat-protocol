/**
 * @file public/views/profile/offers/wizard-columns.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Steps 2 and 3 of a new data product (design canvas "Data ulos", boards
 *   Vaihe2-Sarakkeet and Vaihe3-Esikatselu). Step 2: each column of each source, whether it goes out,
 *   the name another system reads, its type and its description, and the mark on a column the source's
 *   data map calls personal, which starts left out; and an optional row filter, which the package's
 *   transformations record. Step 3: the first rows of the trial build, the row and column counts and
 *   the size, the checks (the Frictionless validation, a type and a description on every column, no
 *   personal data), an excerpt of the ODPS sheet the version would get, and the name, the address
 *   name, the description and the keywords. Made of the component kit.
 * @structure columnsFromProbe · stepColumns · stepPreview
 * @usage const cols = columnsFromProbe(probe, sources, previous);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D9.2, D9.3, D9.4).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { num } from '/js/format.js';
import { Box, BoxList } from '/components/Box.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Section } from '/components/Section.js';
import { DataTable } from '/components/DataTable.js';
import { Action, Actions } from '/components/Action.js';
import { d, bytesWord } from './data-model.js';

const TYPES = ['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'any'];
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'];
const PREVIEW_ROWS = 5;

/**
 * The column list of step 2 from the sources tried one table each: every column of each source, a
 * column the data map calls personal left out, what the owner already chose kept.
 */
export function columnsFromProbe(probe, sources, previous = []) {
  const kept = new Map(previous.map((c) => [`${c.source}.${c.from}`, c]));
  const out = [];
  sources.forEach((src, i) => {
    const r = (probe?.resources || [])[i];
    const s = (probe?.sources || []).find((x) => x.id === src.id);
    const personal = new Set(s?.personal_columns || []);
    const fields = [...(r?.schema?.fields || [])];
    for (const p of personal) if (!fields.some((f) => f.name === p)) fields.push({ name: p, type: 'string' });
    for (const f of fields) {
      const key = `${src.id}.${f.name}`;
      out.push(kept.get(key) || {
        source: src.id, from: f.name, name: f.name, type: TYPES.includes(f.type) ? f.type : 'string',
        description: f.description || '', personal: personal.has(f.name), include: !personal.has(f.name),
      });
    }
  });
  return out;
}

export function stepColumns(s) {
  const { draft, setDraft } = s;
  const setCol = (i, patch) => setDraft((cur) => ({ columns: cur.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const personalOut = draft.columns.filter((c) => c.personal && !c.include);
  const personalIn = draft.columns.filter((c) => c.personal && c.include);
  const outNames = draft.columns.filter((c) => c.include).map((c) => c.name || c.from);
  const f = draft.filter;
  return html`
    <${Section} id="wz-columns" title=${d('cols.title')} count=${d('cols.count', { n: outNames.length, of: draft.columns.length })} first=${true}>
      <${BoxList}>
        ${draft.columns.map((c, i) => html`<${Box} key=${`${c.source}.${c.from}`} tone=${c.include ? 'row' : 'off'}
          name=${`${c.source}.${c.from}`}
          marks=${html`<${Marks}><${Mark}>${c.type}<//>${c.personal ? html`<${Mark} tone="coral">${d('cols.personal')}<//>` : null}<//>`}
          end=${html`<${Check} checked=${c.include} onChange=${(v) => setCol(i, { include: v })}>${d('cols.include')}<//>`}>
          ${c.include ? html`<${Fields} cols=${3}>
            <${TextField} label=${d('wizard.colOut')} code value=${c.name} onInput=${(v) => setCol(i, { name: v })} />
            <${Select} label=${d('wizard.colType')} value=${c.type} options=${TYPES} onChange=${(v) => setCol(i, { type: v })} />
            <${TextField} label=${d('wizard.colDesc')} value=${c.description} placeholder=${d('cols.descPlaceholder')} onInput=${(v) => setCol(i, { description: v })} />
          <//>` : null}
        <//>`)}
      <//>
      ${personalOut.length ? html`<${Note} kind="aside" size="small">${d('cols.personalLeftOut', { cols: personalOut.map((c) => c.from).join(', ') })}<//>` : null}
      ${personalIn.length ? html`<${Note} kind="aside" size="small" tone="irreversible">${d('cols.personalIncluded', { cols: personalIn.map((c) => c.from).join(', ') })}<//>` : null}
    <//>
    <${Section} id="wz-filter" title=${d('cols.filterTitle')} count=${d('cols.optional')}>
      <${Fields} cols=${3}>
        <${Select} label=${d('cols.filterColumn')} value=${f.column} placeholder=${d('cols.noFilter')} options=${outNames}
          onChange=${(v) => setDraft((cur) => ({ filter: { ...cur.filter, column: v } }))} />
        <${Select} label=${d('cols.filterOp')} value=${f.op} options=${OPS.map((o) => [o, d('cols.op.' + o)])} disabled=${!f.column}
          onChange=${(v) => setDraft((cur) => ({ filter: { ...cur.filter, op: v } }))} />
        <${TextField} label=${d('cols.filterValue')} value=${f.value} disabled=${!f.column}
          onInput=${(v) => setDraft((cur) => ({ filter: { ...cur.filter, value: v } }))} />
      <//>
      <${Note}>${d('cols.filterNote')}<//>
    <//>`;
}

/** The checks under the rows, each a ✓ or a ✗ line. */
function checks(preview, draft) {
  const fields = (preview?.resources || []).flatMap((r) => r.schema?.fields || []);
  const described = fields.length > 0 && fields.every((x) => x.type && x.description);
  const personal = draft.columns.some((c) => c.personal && c.include);
  return [
    [preview?.validation?.ok !== false, preview?.validation?.ok !== false ? d('preview.validOk') : d('preview.validBad', { n: preview?.validation?.issues?.length || 0 })],
    [described, described ? d('preview.describedOk') : d('preview.describedBad')],
    [!personal, personal ? d('preview.personalIn') : d('preview.personalNone')],
    preview?.publish_check && !preview.publish_check.ok ? [false, preview.publish_check.message] : null,
  ].filter(Boolean);
}

export function stepPreview(s) {
  const { draft, setDraft, preview, busy } = s;
  const resources = preview?.resources || [];
  const rows = resources.reduce((n, r) => n + (r.row_count || 0), 0);
  const cols = resources.reduce((n, r) => n + (r.schema?.fields?.length || 0), 0);
  const size = new Blob([resources.map((r) => JSON.stringify(r.rows)).join('')]).size;
  const yaml = String(preview?.odps_yaml || '').split('\n').slice(0, 24).join('\n');
  return html`
    <${Section} id="wz-rows" title=${d('preview.rowsTitle')} count=${d('preview.counts', { rows: num(rows), cols: num(cols) })} first=${true}>
      ${resources.map((r) => {
        const head = (r.schema?.fields || []).map((x) => x.name);
        return html`<${Box} key=${r.name} flush name=${resources.length > 1 ? r.name : null}>
          <${DataTable} scroll headers=${head} rows=${(r.rows || []).slice(0, PREVIEW_ROWS).map((row) => head.map((k) => (row[k] === null || row[k] === undefined ? '' : String(row[k]))))} />
        <//>`;
      })}
      <${Note} kind="meta" mono>${d('preview.sizeLine', { rows: num(rows), cols: num(cols), size: bytesWord(size) })}<//>
      ${checks(preview, draft).map(([ok, words], i) => html`<${Note} key=${i} kind="state" tone=${ok ? 'fine' : 'danger'}>${ok ? '✓' : '✗'} ${words}<//>`)}
    <//>
    <${Section} id="wz-about" title=${d('preview.aboutTitle')}>
      <${Fields} cols=${2}>
        <${TextField} label=${d('preview.name')} value=${draft.title} onInput=${(v) => setDraft({ title: v })} />
        <${TextField} label=${d('preview.slug')} hint=${d('preview.slugHint')} code value=${draft.name}
          onInput=${(v) => setDraft({ name: v.toLowerCase().replace(/[^a-z0-9-]/g, ''), nameTouched: true })} />
        <${TextArea} label=${d('preview.desc')} wide rows=${5} value=${draft.description} onInput=${(v) => setDraft({ description: v })} />
        <${TextField} label=${d('preview.keywords')} wide hint=${d('preview.keywordsHint')} value=${draft.keywords} onInput=${(v) => setDraft({ keywords: v })} />
      <//>
      <${Actions}><${Action} small disabled=${busy} onClick=${() => s.tryPreview()}>${d('preview.rebuild')}<//><//>
    <//>
    <${Section} id="wz-odps" title=${d('preview.odpsTitle')} count=${busy ? d('wizard.working') : ''}>
      ${yaml ? html`<${Code} block scroll>${yaml}<//>` : html`<${Note} kind="quiet">${d('preview.noOdps')}<//>`}
    <//>`;
}
