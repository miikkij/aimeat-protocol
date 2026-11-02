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
 *   v1.2.0 — 2026-11-01 — Step 3 takes the title, description and attribution per language (a tab per
 *     language; the page's own edits the base fields) and the attribution; the description field is the
 *     widest column of step 2, and the preview rows keep one line each (WP10e A2, A3, B8, B11).
 *   v1.1.0 — 2026-11-01 — Step 2 is a table as on the canvas (DataTable form stack: goes out, source
 *     field, name out, type, description, the personal mark; one block per column on a phone), its
 *     descriptions and types filled from the source's schema by the node. Step 3 says that the owner's AI
 *     wrote the description draft, with the AI label when one is owed, or where to set up an AI (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D9.2, D9.3, D9.4).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { num } from '/js/format.js';
import { Box } from '/components/Box.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Mark, Code } from '/components/Mark.js';
import { AiLabel } from '/components/ai-label.js';
import { Note } from '/components/Note.js';
import { Section } from '/components/Section.js';
import { DataTable } from '/components/DataTable.js';
import { Action, Actions } from '/components/Action.js';
import { Tabs } from '/components/Tabs.js';
import { d, bytesWord, errText } from './data-model.js';
import { pageLang } from './data-words.js';

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
      <${DataTable} form stack grow=${4}
        headers=${[d('cols.include'), d('cols.sourceField'), d('wizard.colOut'), d('wizard.colType'), d('wizard.colDesc'), d('cols.note')]}
        rows=${draft.columns.map((c, i) => {
          const field = `${c.source}.${c.from}`;
          return [
            html`<${Check} checked=${c.include} ariaLabel=${d('cols.includeOne', { col: field })} onChange=${(v) => setCol(i, { include: v })} />`,
            { text: field, mono: true },
            html`<${TextField} code ariaLabel=${`${d('wizard.colOut')}: ${field}`} value=${c.name} disabled=${!c.include} onInput=${(v) => setCol(i, { name: v })} />`,
            html`<${Select} ariaLabel=${`${d('wizard.colType')}: ${field}`} value=${c.type} options=${TYPES} disabled=${!c.include} onChange=${(v) => setCol(i, { type: v })} />`,
            html`<${TextField} ariaLabel=${`${d('wizard.colDesc')}: ${field}`} value=${c.description} placeholder=${d('cols.descPlaceholder')} disabled=${!c.include} onInput=${(v) => setCol(i, { description: v })} />`,
            c.personal ? html`<${Mark} tone="coral">${d('cols.personal')}<//>` : null,
          ];
        })} />
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
    preview?.publish_check && !preview.publish_check.ok ? [false, errText({ code: preview.publish_check.code, message: preview.publish_check.message }, 'wizard.failed')] : null,
  ].filter(Boolean);
}

/**
 * What the page says about the description's AI draft: that the owner's AI wrote it and it is theirs to
 * change, with the AI label when one is owed (components/ai-label.js decides from the record); or that
 * a draft needs an AI, and where to set one up.
 */
function aiNote(s) {
  const { ai, draft } = s;
  if (!ai || ai.state === 'idle') return null;
  if (ai.state === 'working') return html`<${Note} kind="loading">${d('preview.aiWorking')}<//>`;
  if (ai.state === 'noai') {
    return html`<${Note} kind="aside" size="small">${d('preview.aiNoKey')}<//>
      ${ai.settingsUrl ? html`<${Actions}><${Action} small soft href=${ai.settingsUrl}>${d('preview.aiSettings')}<//><//>` : null}`;
  }
  if (ai.state === 'failed') return html`<${Note} kind="aside" size="small">${ai.error}<//>`;
  if (draft.description !== ai.text) return null;
  return html`<${Note} kind="aside" size="small">${d('preview.aiWrote')}<//>
    ${ai.provenance ? html`<${AiLabel} variant="inline" record=${ai.provenance.record} recordUrl=${ai.provenance.record_url} />` : null}`;
}

/** The languages a product's words are written in on step 3: the page's own first, then the others. */
const LANGS = ['fi', 'en', 'es'];

export function stepPreview(s) {
  const { draft, setDraft, preview, busy } = s;
  // The page's language edits the base fields; another language edits its own words (draft.i18n).
  const base = LANGS.includes(pageLang()) ? pageLang() : 'en';
  const langs = [base, ...LANGS.filter((l) => l !== base)];
  const lang = langs.includes(s.wordsLang) ? s.wordsLang : base;
  const setLang = (l) => s.setWordsLang(l);
  const w = lang === base
    ? { title: draft.title, description: draft.description, attribution: draft.attribution }
    : { title: '', description: '', attribution: '', ...(draft.i18n?.[lang] || {}) };
  const setWords = (patch) => (lang === base
    ? setDraft(patch)
    : setDraft((cur) => ({ i18n: { ...cur.i18n, [lang]: { ...(cur.i18n?.[lang] || {}), ...patch } } })));
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
          <${DataTable} scroll nowrap headers=${head} rows=${(r.rows || []).slice(0, PREVIEW_ROWS).map((row) => head.map((k) => (row[k] === null || row[k] === undefined ? '' : String(row[k]))))} />
        <//>`;
      })}
      <${Note} kind="meta" mono>${d('preview.sizeLine', { rows: num(rows), cols: num(cols), size: bytesWord(size) })}<//>
      ${checks(preview, draft).map(([ok, words], i) => html`<${Note} key=${i} kind="state" tone=${ok ? 'fine' : 'danger'}>${ok ? '✓' : '✗'} ${words}<//>`)}
    <//>
    <${Section} id="wz-about" title=${d('preview.aboutTitle')}>
      <${Tabs} tone="filter" label=${d('preview.langLabel')} value=${lang} onSelect=${setLang}
        items=${langs.map((l) => ({ value: l, label: d('preview.lang.' + l), title: l === base ? d('preview.langBase') : undefined }))} />
      <${Fields} cols=${2}>
        <${TextField} label=${d('preview.name')} value=${w.title} onInput=${(v) => setWords({ title: v })} />
        ${lang === base ? html`<${TextField} label=${d('preview.slug')} hint=${d('preview.slugHint')} code value=${draft.name}
          onInput=${(v) => setDraft({ name: v.toLowerCase().replace(/[^a-z0-9-]/g, ''), nameTouched: true })} />` : null}
        <${TextArea} label=${d('preview.desc')} hint=${d('preview.descHint')} wide rows=${6} value=${w.description} onInput=${(v) => setWords({ description: v })} />
        <${TextField} label=${d('preview.attribution')} hint=${d('preview.attributionHint')} wide value=${w.attribution} onInput=${(v) => setWords({ attribution: v })} />
        ${lang === base ? html`<${TextField} label=${d('preview.keywords')} wide hint=${d('preview.keywordsHint')} value=${draft.keywords} onInput=${(v) => setDraft({ keywords: v })} />` : null}
      <//>
      ${lang === base ? null : html`<${Note} kind="aside" size="small">${d('preview.langOther', { lang: d('preview.lang.' + lang) })}<//>`}
      ${aiNote(s)}
      <${Actions}>
        <${Action} small disabled=${busy} onClick=${() => s.tryPreview()}>${d('preview.rebuild')}<//>
        <${Action} small soft disabled=${s.ai?.state === 'working'} onClick=${s.askDraft}>${s.ai?.state === 'working' ? d('preview.aiWorking') : d('preview.aiAsk')}<//>
      <//>
    <//>
    <${Section} id="wz-odps" title=${d('preview.odpsTitle')} count=${busy ? d('wizard.working') : ''}>
      ${yaml ? html`<${Code} block scroll>${yaml}<//>` : html`<${Note} kind="quiet">${d('preview.noOdps')}<//>`}
    <//>`;
}
