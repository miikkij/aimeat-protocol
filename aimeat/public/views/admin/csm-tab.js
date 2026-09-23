/**
 * @file csm-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard CSM page in the poster face (design canvas "AIMEAT Admin CSM").
 *   Four views under one crumb: the list of registered CSMs, the empty state that says what a CSM
 *   refuses and offers the eight that ship with the build, one CSM open with its fields rendered as
 *   a person reads them, and the create view. A CSM is the one thing on this installation that can
 *   refuse a write, so the page leads on what is refused rather than on what is installed.
 *
 * @structure
 *   - default CsmTab({ data, reload }): the model and the four views
 *   - Empty: what a CSM refuses, the two ways in, and the eight shipped examples
 *   - List: the strip, the headline, one row per CSM
 *   - One: the fields, then the facts (mode, consent, retention, vocabulary)
 *   - Create: the YAML, with the shipped examples as a starting point
 *   - fieldsOf / bounds: reading one field's rule out of the definition
 * @usage Mounted by the admin dashboard tab router.
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: the numeral band, sections, the
 *     shared table (stacking on a phone), fields as list rows, facts as key-value rows, the trail as
 *     the shared crumbs, the editor as a shared field. The page's own sheet is gone.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.2.0 -- 2026-09-13 -- Compose remaining section headings and record rules from poster.css.
 *   v2.1.0 — 2026-09-13 — Compose shared poster list and empty-state headings.
 *   v2.0.0 — 2026-09-12 — The poster face, and the list that could never show anything: the tab
 *     read `data.csm?.templates` while admin.js stores the read at `d.csmTemplates`, so the array
 *     was always empty and the page said "No CSM templates installed" whatever was registered.
 *     The detail view printed JSON.stringify(definition) into a grey box; the fields, their bounds
 *     and their allowed values are the whole point of the document and are a table now. The eight
 *     examples that ship with the build were reachable only from a dropdown inside the create form.
 *   v1.2.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 *   v1.1.0 — 2026-06-02 — Admin design unification: inline danger styles → adm-btn-danger
 *     (2 delete buttons), raw textarea → adm-textarea adm-input-full, error div → <ErrorBox>.
 */
import { h } from 'preact';
import { useState, useMemo, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { num, dt, ErrorBox, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Columns, Stack, ListRow, KeyValue, Table, Field, NumeralBand, Crumbs, Chip, Action, CopyAction, Surface, Text } from '/components/poster-parts.js';
import { getCsmDetail, deleteCsm, createCsm, getCsmFileTemplates, getCsmFileTemplate, getCsmBuilderPrompt } from '/js/services/admin.js';

const S = (key, params) => t('admin.csm.' + key, params);
/**
 * The same lookup, falling back to the raw value when there is no translation for it. A CSM may
 * name a retention period, a visibility or a field type this page has no words for, and the raw
 * value it wrote is better on screen than the key path t() hands back for a miss.
 */
const SOr = (key, fallback) => tOr('admin.csm.' + key, fallback);

/** One field's rule, said the way the page reads it: what it takes, and what it refuses. */
function bounds(def) {
  const parts = [];
  if (Array.isArray(def?.enum) && def.enum.length) return { kind: S('typeOneOf', { n: num(def.enum.length) }), rule: def.enum.join(' · ') };
  const type = def?.type ?? 'string';
  const kind = SOr('type.' + type, type);
  if (type === 'array') {
    const item = typeof def.items === 'string' ? def.items : def.items?.type;
    if (def.min != null) parts.push(S('atLeast', { n: num(def.min) }));
    if (def.max != null) parts.push(S('atMost', { n: num(def.max) }));
    return { kind: item ? S('listOf', { of: SOr('type.' + item, item) }) : kind, rule: parts.join(', ') };
  }
  if (type === 'object') {
    const props = Object.entries(def.properties ?? {});
    const req = props.filter(([, p]) => p?.required !== false).map(([k]) => k);
    const opt = props.filter(([, p]) => p?.required === false).map(([k]) => k);
    if (!req.length && !opt.length) return { kind, rule: '' };
    if (!opt.length) return { kind, rule: S('insideAllRequired', { req: req.join(', ') }) };
    if (!req.length) return { kind, rule: S('insideNoneRequired', { opt: opt.join(', ') }) };
    return { kind, rule: S('inside', { req: req.join(', '), opt: opt.join(', ') }) };
  }
  if (type === 'string') {
    if (def.min != null && def.max != null) parts.push(S('charsBetween', { min: num(def.min), max: num(def.max) }));
    else if (def.min != null) parts.push(S('charsAtLeast', { n: num(def.min) }));
    else if (def.max != null) parts.push(S('charsAtMost', { n: num(def.max) }));
    if (def.format) parts.push(S('mustBeFormat', { format: def.format }));
  } else {
    if (def.min != null) parts.push(S('numAtLeast', { n: num(def.min) }));
    if (def.max != null) parts.push(S('numAtMost', { n: num(def.max) }));
  }
  return { kind, rule: parts.join(', ') };
}

/** The required and optional field lists of a definition, in the order the author wrote them. */
function fieldsOf(definition) {
  const ds = definition?.dataSchema ?? definition?.data_schema ?? {};
  const toRows = (obj) => Object.entries(obj ?? {}).map(([name, def]) => ({ name, ...bounds(def) }));
  return { required: toRows(ds.required), optional: toRows(ds.optional) };
}

export default function CsmTab({ data, reload }) {
  const [view, setView] = useState('list');    // list | one | create | prompt
  const [open, setOpen] = useState(null);
  const [yaml, setYaml] = useState('');
  const [examples, setExamples] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [prompt, setPrompt] = useState('');
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  // admin.js stores this read at `csmTemplates`. Reading `data.csm` — which nothing sets — is what
  // made the list permanently empty and the page permanently say nothing was installed.
  const csms = useMemo(() => data.csmTemplates?.templates || [], [data.csmTemplates]);

  // useToast hands back a fresh function every render; an effect keyed on it would never settle.
  const showErrRef = useRef(showErr);
  showErrRef.current = showErr;

  const m = useMemo(() => ({
    total: csms.length,
    strict: csms.filter(c => c.schema_mode === 'strict').length,
    fields: csms.reduce((n, c) => n + (c.required_fields || 0) + (c.optional_fields || 0), 0),
    required: csms.reduce((n, c) => n + (c.required_fields || 0), 0),
    federating: csms.filter(c => c.federate).length,
  }), [csms]);

  async function showOne(name) {
    setErr('');
    try {
      const r = await getCsmDetail(name);
      setOpen(r.data);
      setView('one');
    } catch (e) { showErr(e.message); }
  }

  function remove(c) {
    confirm(S('deleteAsk', { name: c.name }), async () => {
      try {
        await deleteCsm(c.name);
        setView('list');
        setOpen(null);
        reload();
      } catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  async function startCreate(withYaml) {
    setErr('');
    setYaml(withYaml || '');
    setView('create');
    if (!examples) loadExamples();
  }

  async function takeExample(type) {
    if (!type) return;
    setLoading(true);
    try {
      const text = await getCsmFileTemplate(type);
      setYaml(text);
      setView('create');
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  /** Fetch the shipped examples once. Sets state; an empty list here means the read failed, and
   *  the toast says so rather than the page pretending the build shipped none. */
  const loadExamples = useCallback(async () => {
    try {
      const r = await getCsmFileTemplates();
      setExamples(r.data?.templates || []);
    } catch (e) {
      showErrRef.current(S('examplesFailed') + ': ' + e.message);
      setExamples([]);
    }
  }, []);

  async function doCreate() {
    if (!yaml.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await createCsm(yaml);
      setView('list');
      setYaml('');
      reload();
    } catch (e) {
      setErr(e.message || S('createFailed'));
    }
    setLoading(false);
  }

  async function showPrompt() {
    setErr('');
    setLoading(true);
    try {
      const r = await getCsmBuilderPrompt();
      setPrompt(r.data?.prompt || '');
      setView('prompt');
    } catch (e) { showErr(e.message); }
    setLoading(false);
  }

  const wrap = (inner) => html`<${Stack}>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    ${inner}
    <${ConfirmUI} />
  <//>`;

  if (view === 'one' && open) {
    return wrap(html`<${One} csm=${open} onBack=${() => { setView('list'); setOpen(null); }}
      onDelete=${() => remove(open)} />`);
  }

  if (view === 'create') {
    return wrap(html`<${Create} yaml=${yaml} setYaml=${setYaml} examples=${examples}
      onTake=${takeExample} onCreate=${doCreate} loading=${loading} err=${err}
      onCancel=${() => { setView('list'); setErr(''); }} />`);
  }

  if (view === 'prompt') {
    return wrap(html`<${PromptView} prompt=${prompt} onBack=${() => setView('list')} />`);
  }

  if (csms.length === 0) {
    return wrap(html`<${Empty} examples=${examples} loadExamples=${loadExamples}
      onWrite=${() => startCreate('')} onTake=${takeExample} onPrompt=${showPrompt} />`);
  }

  return wrap(html`
    <${NumeralBand} tone="plain" items=${[
      { label: S('cntAll'), value: num(m.total), note: S('cntAllSub') },
      { label: S('cntStrict'), value: num(m.strict), note: S('cntStrictSub', { n: num(m.total - m.strict) }) },
      { label: S('cntFields'), value: num(m.fields), note: S('cntFieldsSub', { n: num(m.required) }) },
      { label: S('cntFederate'), value: num(m.federating), note: S('cntFederateSub') },
    ]} />

    <${Section} title=${S('listTitle')} count="01"
      actions=${html`<${Action} kind="primary" onClick=${() => startCreate('')}>${S('add')}<//>`}>
      <${Stack}>
        <${Columns} collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="label">${S('heroLabel')}<//>
            <${Text} kind="number">${S('hero', { n: num(m.total) })}<//>
            <${Text} kind="caption" tone="muted">${S('heroSub')}<//>
          <//>
          <${Text} kind="lead">${S('lead')}<//>
        <//>

        <${Table} collapse=${900} label=${S('listTitle')}
          headers=${[S('colCsm'), S('colFields'), S('colApplies'), S('colMode'), '']}
          rows=${csms.map(c => [
            html`<${Stack} density="compact"><strong>${c.name}</strong><${Text} kind="caption" tone="muted">${S('typeIs', { type: c.service_type || '—' })}<//><//>`,
            html`<${Stack} density="compact"><span>${S('nRequired', { n: num(c.required_fields || 0) })}</span><${Text} kind="caption" tone="muted">${S('nOptional', { n: num(c.optional_fields || 0) })}<//><//>`,
            html`<${Stack} density="compact"><${Text} kind="mono">${c.json_schema_key || 'csm.' + c.name}<//><${Text} kind="caption" tone="muted">${S('appliesWhy')}<//><//>`,
            html`<${Stack} direction="wrap" density="compact">
              <${Chip} tone=${c.schema_mode === 'strict' ? 'sun' : 'plain'}>${c.schema_mode === 'strict' ? S('modeStrict') : S('modeOpen')}<//>
              ${c.federate && html`<${Chip} tone="success">${S('federates')}<//>`}
            <//>`,
            html`<${Stack} direction="horizontal" density="compact">
              <${Action} onClick=${() => showOne(c.name)}>${S('openIt')}<//>
              <${Action} tone="danger" onClick=${() => remove(c)}>${S('remove')}<//>
            <//>`,
          ])} />

        <${Stack} direction="wrap" align="between">
          <${Text} kind="caption" tone="muted">${S('foot', { n: num(m.total), fields: num(m.fields) })}<//>
          <${Text} kind="caption" tone="muted">${S('footRemove')}<//>
        <//>
      <//>
    <//>`);
}

/** The shipped examples, each with the word that loads it into the editor. */
function Starts({ title, why, list, onTake }) {
  return html`<${Surface} kind="box">
    <${Stack}>
      <${Stack} density="compact">
        <${Text} kind="label">${title}<//>
        <${Text} kind="caption" tone="muted">${why}<//>
      <//>
      <div>${list.map(ex => html`<${ListRow} key=${ex.type} density="compact" name=${ex.name}
        detail=${ex.description} detailKind="text"
        actions=${html`<${Action} onClick=${() => onTake(ex.type)}>${S('takeIt')}<//>`} />`)}</div>
    <//>
  <//>`;
}

/* ── Nothing registered: the page has to say what the thing is ───────────────────────────────── */

function Empty({ examples, loadExamples, onWrite, onTake, onPrompt }) {
  // The shipped examples ARE the page when nothing is registered, so they are fetched on arrival
  // rather than waiting behind the Add button nobody presses.
  useEffect(() => { if (!examples) loadExamples(); }, [examples, loadExamples]);
  const list = examples || [];

  return html`<${Section} title=${S('emptyTitle')} count="01">
    <${Columns} collapse=${900}>
      <${Stack}>
        <${Stack} density="compact">
          <${Text} kind="label">${S('emptyLabel')}<//>
          <${Text} kind="number">${S('emptyHero')}<//>
        <//>
        <${Text} kind="lead">${S('emptyLead1')}<//>
        <${Text} kind="lead">${S('emptyLead2')}<//>

        <div>
          <${ListRow} name=${S('refMissing')} detail=${S('refMissingWhy')} detailKind="text" />
          <${ListRow} name=${S('refBounds')} detail=${S('refBoundsWhy')} detailKind="text" />
          <${ListRow} name=${S('refUnknown')} detail=${S('refUnknownWhy')} detailKind="text" />
        </div>

        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" onClick=${onWrite}>${S('writeOne')}<//>
          <${Action} onClick=${onPrompt}>${S('aiWritesIt')}<//>
        <//>
        <${Text} kind="caption" tone="muted">${S('aiHint')}<//>
      <//>

      <div>
        ${list.length > 0 && html`<${Starts} title=${S('shipped', { n: num(list.length) })} why=${S('shippedWhy')}
          list=${list} onTake=${onTake} />`}
      </div>
    <//>
  <//>`;
}

/* ── One CSM open ────────────────────────────────────────────────────────────────────────────── */

function One({ csm, onBack, onDelete }) {
  const [showYaml, setShowYaml] = useState(false);
  const def = csm.definition || {};
  const svc = def.service || {};
  const { required, optional } = fieldsOf(def);
  const consent = def.consentRequirements || def.consent_requirements || {};
  const moderation = def.moderation || {};
  const strict = (def.schemaMode ?? def.schema_mode) === 'strict';
  const sem = csm.semantic || svc.semantic;
  const semType = sem?.['@type'];

  const fieldRow = (f) => html`<${ListRow} key=${f.name} density="compact" name=${f.name} detail=${f.kind}
    value=${html`<${Text} kind="caption" tone=${f.rule ? 'plain' : 'muted'}>${f.rule || S('noBounds')}<//>`} />`;
  const fact = (label, value, note) => html`<${KeyValue} label=${label}><${Stack} density="compact">
    <span>${value}</span>${note && html`<${Text} kind="caption" tone="muted">${note}<//>`}<//><//>`;

  return html`<${Stack}>
    <${Crumbs} items=${[{ label: S('crumb'), onClick: onBack }, { label: csm.name }]} />

    <${Stack} direction="wrap" align="between">
      <${Stack} density="compact">
        <${Text} kind="heading">${csm.name}<//>
        <${Text} kind="mono" tone="muted">${svc.version ? 'v' + svc.version + ' · ' : ''}${csm.json_schema_key}<//>
      <//>
      <${Stack} direction="horizontal">
        <${Action} expanded=${showYaml} onClick=${() => setShowYaml(!showYaml)}>
          ${showYaml ? S('hideDefinition') : S('theDefinition')}<//>
        <${Action} tone="danger" onClick=${onDelete}>${S('remove')}<//>
      <//>
    <//>
    ${svc.description && html`<${Text} kind="lead">${svc.description}<//>`}
    <${Text} kind="caption" tone="muted">${S('appliesTo', { key: csm.json_schema_key })}<//>

    ${showYaml && html`<${Surface} kind="code" height="tall">${JSON.stringify(def, null, 2)}<//>`}

    <${Columns} collapse=${900}>
      <${Stack}>
        <${Text} kind="label">${S('fieldHead')}<//>
        ${required.length > 0 && html`<${Stack} density="compact">
          <${Text} kind="heading" size="small">${S('groupRequired')}<//>
          <div>${required.map(fieldRow)}</div>
        <//>`}
        ${optional.length > 0 && html`<${Stack} density="compact">
          <${Text} kind="heading" size="small">${S('groupOptional')}<//>
          <div>${optional.map(fieldRow)}</div>
        <//>`}
        ${required.length === 0 && optional.length === 0 && html`<${Text} kind="caption" tone="muted">${S('noFields')}<//>`}
      <//>

      <${Stack}>
        <div>
          ${fact(S('factUnknown'), html`<${Chip} tone=${strict ? 'sun' : 'plain'}>${strict ? S('modeStrict') : S('modeOpen')}<//>`,
            strict ? S('factUnknownStrict') : S('factUnknownOpen'))}
          ${consent.consentPurpose && fact(S('factFor'), consent.consentPurpose, consent.requiresConsent ? S('factForConsent') : '')}
          ${consent.dataRetention && fact(S('factKept'), SOr('retention.' + consent.dataRetention, consent.dataRetention))}
          ${consent.visibilityDefault && fact(S('factSeen'), SOr('visibility.' + consent.visibilityDefault, consent.visibilityDefault), S('factSeenWhy'))}
          ${moderation.flagsEnabled && fact(S('factFlags'), S('factFlagsOn', { n: num(moderation.autoHideThreshold ?? 0) }),
            moderation.appealsEnabled ? S('factAppealsOn') : S('factAppealsOff'))}
          ${semType && fact(S('factVocab'), html`<${Text} kind="mono">${semType}<//>`, S('factVocabWhy'))}
          ${fact(S('factRegistered'), S('factRegisteredBy', { who: csm.registered_by || '—', when: dt(csm.registered_at) }))}
          ${csm.federate && fact(S('factFederate'), S('factFederateOn'))}
        </div>

        <${Surface} kind="aside"><${Stack} density="compact">
          <${Text} kind="label">${S('warnTitle')}<//>
          <${Text}>${S('warnBody')}<//>
        <//><//>
      <//>
    <//>
  <//>`;
}

/* ── Writing one ─────────────────────────────────────────────────────────────────────────────── */

function Create({ yaml, setYaml, examples, onTake, onCreate, loading, err, onCancel }) {
  return html`<${Section} title=${S('createTitle')} count="02" description=${S('createLead')}
    actions=${html`<${Action} onClick=${onCancel}>${t('common.cancel')}<//>`}>
    <${Columns} layout="leading" collapse=${900}>
      <${Stack}>
        <${Field} type="textarea" rows=${22} label=${S('theFile')} value=${yaml}
          placeholder=${S('yamlPlaceholder')} spellCheck=${false}
          onInput=${e => setYaml(e.target.value)} />
        ${err && html`<${ErrorBox} message=${err} />`}
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${loading || !yaml.trim()} onClick=${onCreate}>
            ${loading ? t('common.loading') : S('registerIt')}<//>
          <${Text} kind="caption" tone="muted">${S('registerHint')}<//>
        <//>
      <//>

      <div>
        ${(examples || []).length > 0 && html`<${Starts} title=${S('startFrom')} why=${S('startFromWhy')}
          list=${examples} onTake=${onTake} />`}
      </div>
    <//>
  <//>`;
}

/* ── The prompt an owner takes to their own chat ─────────────────────────────────────────────── */

function PromptView({ prompt, onBack }) {
  return html`<${Stack}>
    <${Crumbs} items=${[{ label: S('crumb'), onClick: onBack }, { label: S('aiWritesIt') }]} />
    <${Section} title=${S('promptTitle')} description=${S('promptLead')}
      actions=${html`<${CopyAction} kind="primary" text=${prompt} label=${t('common.copy')} copiedLabel=${t('common.copied')} />`}>
      <${Surface} kind="code" height="tall">${prompt}<//>
    <//>
  <//>`;
}
