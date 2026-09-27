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
 *   - Starts: the shipped examples, each with the way to take it
 *   - fieldsOf / bounds: reading one field's rule out of the definition
 * @usage Mounted by the admin dashboard tab router.
 * @version-history
 *   v3.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7): the
 *     strip is the FigureStrip, the headline the Verdict with its label, the sections Section, the
 *     CSMs, the fields, the refusals and the shipped examples Lists (the examples in the Object box
 *     on the grey ground), the facts Facts, the warning SettingBox, the definition and the prompt Code
 *     blocks, the file the typewriter TextArea, the way back the Crumb. The page writes no class and
 *     loads no sheet of its own (admin-csm.css is gone). The crumb's step mark is the Crumb's slash.
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
import { h, Fragment } from 'preact';
import { useState, useMemo, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { num, dt, ErrorBox, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Verdict } from '/components/Readings.js';
import { List, Row, Name, Who, Cell, Doors, Group } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Box, SettingBox } from '/components/Box.js';
import { Crumb } from '/components/Crumb.js';
import { TextArea } from '/components/TextField.js';
import { Beside, Row as Line, Stack } from '/components/Layout.js';
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

/** A CSM's mode as its mark: strict in ink, open in the dim tone. */
const modeMark = (strict) => html`<${Mark} tone=${strict ? 'ink' : 'dim'}>${strict ? S('modeStrict') : S('modeOpen')}<//>`;

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

  const wrap = (inner) => html`<${Fragment}>
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
    <${FigureStrip} wrap lead items=${[
      { key: 'all', n: num(m.total), label: S('cntAll'), sub: S('cntAllSub') },
      { key: 'strict', n: num(m.strict), label: S('cntStrict'), sub: S('cntStrictSub', { n: num(m.total - m.strict) }) },
      { key: 'fields', n: num(m.fields), label: S('cntFields'), sub: S('cntFieldsSub', { n: num(m.required) }) },
      { key: 'federating', n: num(m.federating), label: S('cntFederate'), sub: S('cntFederateSub') },
    ]} />

    <${Section} first num="01" title=${S('listTitle')}
      doors=${html`<${Loud} control onClick=${() => startCreate('')}>${S('add')}<//>`}>
      <${Verdict} label=${S('heroLabel')} word=${S('hero', { n: num(m.total) })} line=${S('heroSub')}>
        <${Note} kind="lead">${S('lead')}<//>
      <//>

      <${List} cols="name-n-where-state-doors" labels
        head=${[S('colCsm'), S('colFields'), S('colApplies'), S('colMode'), '']}>
        ${csms.map(c => html`
          <${Row} key=${c.name} hover>
            <${Name} meta=${S('typeIs', { type: c.service_type || '—' })}>${c.name}<//>
            <${Who} sub=${S('nOptional', { n: num(c.optional_fields || 0) })}>${S('nRequired', { n: num(c.required_fields || 0) })}<//>
            <${Cell} code sub=${S('appliesWhy')}>${c.json_schema_key || 'csm.' + c.name}<//>
            <${Cell} line>
              ${modeMark(c.schema_mode === 'strict')}
              ${c.federate ? html`<${Mark} tone="coral">${S('federates')}<//>` : null}
            <//>
            <${Doors}>
              <${Action} small row onClick=${() => showOne(c.name)}>${S('openIt')}<//>
              <${Action} small row soft onClick=${() => remove(c)}>${S('remove')}<//>
            <//>
          <//>`)}
      <//>

      <${Line} gap="large" justify="between" wrap above="medium">
        <${Note} kind="meta" inline>${S('foot', { n: num(m.total), fields: num(m.fields) })}<//>
        <${Note} kind="meta" inline>${S('footRemove')}<//>
      <//>
    <//>`);
}

/* ── The shipped examples, each with the way to take it ──────────────────────────────────────── */

function Starts({ label, why, list, onTake }) {
  return html`
    <${Box} tone="dim">
      <${Label} block>${label}<//>
      <${Note}>${why}<//>
      <${List} cols="name-doors" keepCols dense>
        ${list.map(ex => html`
          <${Row} key=${ex.type}>
            <${Name} desc=${ex.description}>${ex.name}<//>
            <${Doors}><${Action} small row soft onClick=${() => onTake(ex.type)}>${S('takeIt')}<//><//>
          <//>`)}
      <//>
    <//>`;
}

/* ── Nothing registered: the page has to say what the thing is ───────────────────────────────── */

function Empty({ examples, loadExamples, onWrite, onTake, onPrompt }) {
  // The shipped examples ARE the page when nothing is registered, so they are fetched on arrival
  // rather than waiting behind the Add button nobody presses.
  useEffect(() => { if (!examples) loadExamples(); }, [examples, loadExamples]);
  const list = examples || [];

  return html`
    <${Section} first num="01" title=${S('emptyTitle')}>
      <${Beside} wide side=${list.length > 0 ? html`<${Starts} label=${S('shipped', { n: num(list.length) })}
        why=${S('shippedWhy')} list=${list} onTake=${onTake} />` : null}>
        <${Verdict} label=${S('emptyLabel')} word=${S('emptyHero')} />
        <${Note} kind="lead">${S('emptyLead1')}<//>
        <${Note} kind="lead">${S('emptyLead2')}<//>

        <${List} cols="name-words">
          <${Row}><${Name}>${S('refMissing')}<//><${Cell}>${S('refMissingWhy')}<//><//>
          <${Row}><${Name}>${S('refBounds')}<//><${Cell}>${S('refBoundsWhy')}<//><//>
          <${Row}><${Name}>${S('refUnknown')}<//><${Cell}>${S('refUnknownWhy')}<//><//>
        <//>

        <${Actions}>
          <${Loud} control onClick=${onWrite}>${S('writeOne')}<//>
          <${Action} small onClick=${onPrompt}>${S('aiWritesIt')}<//>
        <//>
        <${Note}>${S('aiHint')}<//>
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

  const fieldRow = (f) => html`
    <${Row} key=${f.name}>
      <${Cell} code>${f.name}<//>
      <${Cell} dim>${f.kind}<//>
      <${Cell} dim=${!f.rule}>${f.rule || S('noBounds')}<//>
    <//>`;

  const facts = html`
    <${Facts} rows=${[
      { k: S('factUnknown'), v: modeMark(strict), sub: strict ? S('factUnknownStrict') : S('factUnknownOpen') },
      consent.consentPurpose && { k: S('factFor'), v: consent.consentPurpose, sub: consent.requiresConsent ? S('factForConsent') : undefined },
      consent.dataRetention && { k: S('factKept'), v: SOr('retention.' + consent.dataRetention, consent.dataRetention) },
      consent.visibilityDefault && { k: S('factSeen'), v: SOr('visibility.' + consent.visibilityDefault, consent.visibilityDefault), sub: S('factSeenWhy') },
      moderation.flagsEnabled && { k: S('factFlags'), v: S('factFlagsOn', { n: num(moderation.autoHideThreshold ?? 0) }), sub: moderation.appealsEnabled ? S('factAppealsOn') : S('factAppealsOff') },
      semType && { k: S('factVocab'), v: semType, mono: true, sub: S('factVocabWhy') },
      { k: S('factRegistered'), v: S('factRegisteredBy', { who: csm.registered_by || '—', when: dt(csm.registered_at) }) },
      csm.federate && { k: S('factFederate'), v: S('factFederateOn') },
    ]} />
    <${SettingBox} label=${S('warnTitle')}>${S('warnBody')}<//>`;

  return html`
    <${Stack} gap="none">
      <${Crumb} steps=${[{ label: S('crumb'), onClick: onBack }, csm.name]} />
      <${Section} num=${`${svc.version ? 'v' + svc.version + ' · ' : ''}${csm.json_schema_key}`} title=${csm.name}
        doors=${html`
          <${Action} small expanded=${showYaml} onClick=${() => setShowYaml(!showYaml)}>
            ${showYaml ? S('hideDefinition') : S('theDefinition')}
          <//>
          <${Action} small soft onClick=${onDelete}>${S('remove')}<//>`}>
        ${svc.description ? html`<${Note} kind="lead">${svc.description}<//>` : null}
        <${Note}>${S('appliesTo', { key: csm.json_schema_key })}<//>

        ${showYaml ? html`<${Code} block scroll="large">${JSON.stringify(def, null, 2)}<//>` : null}

        <${Beside} narrow above="large" side=${facts}>
          <${Label} block>${S('fieldHead')}<//>
          <${List} cols="name-kind-words" keepCols empty=${S('noFields')}>
            ${required.length > 0 ? html`<${Group} title=${S('groupRequired')}>${required.map(fieldRow)}<//>` : null}
            ${optional.length > 0 ? html`<${Group} title=${S('groupOptional')}>${optional.map(fieldRow)}<//>` : null}
          <//>
        <//>
      <//>
    <//>`;
}

/* ── Writing one ─────────────────────────────────────────────────────────────────────────────── */

function Create({ yaml, setYaml, examples, onTake, onCreate, loading, err, onCancel }) {
  const list = examples || [];
  return html`
    <${Section} first num="02" title=${S('createTitle')}
      doors=${html`<${Action} small onClick=${onCancel}>${t('common.cancel')}<//>`}>
      <${Note} kind="lead">${S('createLead')}<//>

      <${Beside} narrow side=${list.length > 0 ? html`<${Starts} label=${S('startFrom')}
        why=${S('startFromWhy')} list=${list} onTake=${onTake} />` : null}>
        <${TextArea} code rows=${22} label=${S('theFile')} value=${yaml}
          placeholder=${S('yamlPlaceholder')} onInput=${setYaml} />
        ${err ? html`<${ErrorBox} message=${err} />` : null}
        <${Actions}>
          <${Loud} control disabled=${loading || !yaml.trim()} onClick=${onCreate}>
            ${loading ? t('common.loading') : S('registerIt')}
          <//>
          <${Note} inline>${S('registerHint')}<//>
        <//>
      <//>
    <//>`;
}

/* ── The prompt an owner takes to their own chat ─────────────────────────────────────────────── */

function PromptView({ prompt, onBack }) {
  return html`
    <${Stack} gap="none">
      <${Crumb} steps=${[{ label: S('crumb'), onClick: onBack }, S('aiWritesIt')]} />
      <${Section} title=${S('promptTitle')}
        doors=${html`<${Loud} control copy=${prompt} copiedLabel=${t('common.copied')}>${t('common.copy')}<//>`}>
        <${Note} kind="lead">${S('promptLead')}<//>
        <${Code} block tall>${prompt}<//>
      <//>
    <//>`;
}
