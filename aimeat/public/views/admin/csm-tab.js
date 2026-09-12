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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, ErrorBox, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';
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
  useViewCSS('/css/views/admin-csm.css');
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

  const wrap = (inner) => html`<div class="og adm-csm">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    ${inner}
    <${ConfirmUI} />
  </div>`;

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
    <div class="og-strip">
      <div><b>${num(m.total)}</b><span>${S('cntAll')}</span><small>${S('cntAllSub')}</small></div>
      <div><b>${num(m.strict)}</b><span>${S('cntStrict')}</span><small>${S('cntStrictSub', { n: num(m.total - m.strict) })}</small></div>
      <div><b>${num(m.fields)}</b><span>${S('cntFields')}</span><small>${S('cntFieldsSub', { n: num(m.required) })}</small></div>
      <div><b>${num(m.federating)}</b><span>${S('cntFederate')}</span><small>${S('cntFederateSub')}</small></div>
    </div>

    <section class="og-sec og-sec--first">
      <div class="og-sec-h">
        <h2>${S('listTitle')}<small>01</small></h2>
        <button type="button" class="adm-btn" onClick=${() => startCreate('')}>${S('add')}</button>
      </div>

      <div class="adm-csm-top">
        <div>
          <div class="adm-csm-lbl">${S('heroLabel')}</div>
          <div class="adm-csm-hero">${S('hero', { n: num(m.total) })}</div>
          <p class="adm-csm-hero-sub">${S('heroSub')}</p>
        </div>
        <div><p class="adm-csm-lead">${S('lead')}</p></div>
      </div>

      <div class="adm-csm-rows">
        <div class="adm-csm-hrow">
          <span>${S('colCsm')}</span><span>${S('colFields')}</span><span>${S('colApplies')}</span>
          <span>${S('colMode')}</span><span></span>
        </div>
        ${csms.map(c => html`
          <div class="adm-csm-row" key=${c.name}>
            <span class="adm-csm-name">${c.name}<em>${S('typeIs', { type: c.service_type || '—' })}</em></span>
            <span class="adm-csm-fields">${S('nRequired', { n: num(c.required_fields || 0) })}
              <em>${S('nOptional', { n: num(c.optional_fields || 0) })}</em></span>
            <span class="adm-csm-where">${c.json_schema_key || 'csm.' + c.name}<em>${S('appliesWhy')}</em></span>
            <span class="adm-csm-mode">
              <span class="adm-csm-chip ${c.schema_mode === 'strict' ? 'is-strict' : ''}">${c.schema_mode === 'strict' ? S('modeStrict') : S('modeOpen')}</span>
              ${c.federate && html`<span class="adm-csm-chip is-fed">${S('federates')}</span>`}
            </span>
            <span class="adm-csm-doors">
              <button type="button" class="adm-csm-door" onClick=${() => showOne(c.name)}>${S('openIt')}</button>
              <button type="button" class="adm-csm-door is-quiet" onClick=${() => remove(c)}>${S('remove')}</button>
            </span>
          </div>`)}
      </div>

      <div class="adm-csm-foot">
        <span>${S('foot', { n: num(m.total), fields: num(m.fields) })}</span>
        <span>${S('footRemove')}</span>
      </div>
    </section>`);
}

/* ── Nothing registered: the page has to say what the thing is ───────────────────────────────── */

function Empty({ examples, loadExamples, onWrite, onTake, onPrompt }) {
  // The shipped examples ARE the page when nothing is registered, so they are fetched on arrival
  // rather than waiting behind the Add button nobody presses.
  useEffect(() => { if (!examples) loadExamples(); }, [examples, loadExamples]);
  const list = examples || [];

  return html`
    <section class="og-sec og-sec--first adm-csm-page">
      <div class="og-sec-h"><h2>${S('emptyTitle')}<small>01</small></h2></div>

      <div class="adm-csm-two adm-csm-two--empty">
        <div>
          <div class="adm-csm-lbl">${S('emptyLabel')}</div>
          <div class="adm-csm-hero adm-csm-hero--empty">${S('emptyHero')}</div>
          <p class="adm-csm-lead">${S('emptyLead1')}</p>
          <p class="adm-csm-lead">${S('emptyLead2')}</p>

          <div class="adm-csm-refusals">
            <div class="adm-csm-ref"><b>${S('refMissing')}</b><span>${S('refMissingWhy')}</span></div>
            <div class="adm-csm-ref"><b>${S('refBounds')}</b><span>${S('refBoundsWhy')}</span></div>
            <div class="adm-csm-ref"><b>${S('refUnknown')}</b><span>${S('refUnknownWhy')}</span></div>
          </div>

          <div class="adm-csm-act">
            <button type="button" class="adm-btn" onClick=${onWrite}>${S('writeOne')}</button>
            <button type="button" class="adm-csm-door" onClick=${onPrompt}>${S('aiWritesIt')}</button>
          </div>
          <p class="adm-csm-hint">${S('aiHint')}</p>
        </div>

        <div>
          ${list.length > 0 && html`
            <div class="adm-csm-starts">
              <div class="adm-csm-starts-l">${S('shipped', { n: num(list.length) })}</div>
              <p class="adm-csm-starts-s">${S('shippedWhy')}</p>
              ${list.map(ex => html`
                <div class="adm-csm-srow" key=${ex.type}>
                  <span class="adm-csm-sname">${ex.name}</span>
                  <button type="button" class="adm-csm-stake" onClick=${() => onTake(ex.type)}>${S('takeIt')}</button>
                  <span class="adm-csm-swhat">${ex.description}</span>
                </div>`)}
            </div>`}
        </div>
      </div>
    </section>`;
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
    <div class="adm-csm-frow" key=${f.name}>
      <span class="adm-csm-fname">${f.name}</span>
      <span class="adm-csm-ftype">${f.kind}</span>
      <span class="adm-csm-frule ${f.rule ? '' : 'is-none'}">${f.rule || S('noBounds')}</span>
    </div>`;

  return html`
    <div class="adm-csm-page">
      <div class="adm-csm-crumb">
        <button type="button" onClick=${onBack}>${S('crumb')}</button> · ${csm.name}
      </div>

      <div class="adm-csm-head">
        <h2>${csm.name}<i>${svc.version ? 'v' + svc.version + ' · ' : ''}${csm.json_schema_key}</i></h2>
        <div class="adm-csm-doors">
          <button type="button" class="adm-csm-door" onClick=${() => setShowYaml(!showYaml)}>
            ${showYaml ? S('hideDefinition') : S('theDefinition')}
          </button>
          <button type="button" class="adm-csm-door is-quiet" onClick=${onDelete}>${S('remove')}</button>
        </div>
      </div>
      ${svc.description && html`<p class="adm-csm-what">${svc.description}</p>`}
      <p class="adm-csm-applies">${S('appliesTo', { key: csm.json_schema_key })}</p>

      ${showYaml && html`
        <pre class="adm-csm-yaml">${JSON.stringify(def, null, 2)}</pre>`}

      <div class="adm-csm-two">
        <div>
          <div class="adm-csm-fhead">${S('fieldHead')}</div>
          ${required.length > 0 && html`
            <div class="adm-csm-grp">${S('groupRequired')}</div>
            ${required.map(fieldRow)}`}
          ${optional.length > 0 && html`
            <div class="adm-csm-grp">${S('groupOptional')}</div>
            ${optional.map(fieldRow)}`}
          ${required.length === 0 && optional.length === 0 && html`
            <p class="adm-csm-hint">${S('noFields')}</p>`}
        </div>

        <div>
          <dl class="adm-csm-facts">
            <div class="adm-csm-fact">
              <dt>${S('factUnknown')}</dt>
              <dd><span class="adm-csm-chip ${strict ? 'is-strict' : ''}">${strict ? S('modeStrict') : S('modeOpen')}</span>
                <em>${strict ? S('factUnknownStrict') : S('factUnknownOpen')}</em></dd>
            </div>
            ${consent.consentPurpose && html`
              <div class="adm-csm-fact">
                <dt>${S('factFor')}</dt>
                <dd>${consent.consentPurpose}
                  ${consent.requiresConsent && html`<em>${S('factForConsent')}</em>`}</dd>
              </div>`}
            ${consent.dataRetention && html`
              <div class="adm-csm-fact"><dt>${S('factKept')}</dt><dd>${SOr('retention.' + consent.dataRetention, consent.dataRetention)}</dd></div>`}
            ${consent.visibilityDefault && html`
              <div class="adm-csm-fact">
                <dt>${S('factSeen')}</dt>
                <dd>${SOr('visibility.' + consent.visibilityDefault, consent.visibilityDefault)}
                  <em>${S('factSeenWhy')}</em></dd>
              </div>`}
            ${moderation.flagsEnabled && html`
              <div class="adm-csm-fact">
                <dt>${S('factFlags')}</dt>
                <dd>${S('factFlagsOn', { n: num(moderation.autoHideThreshold ?? 0) })}
                  <em>${moderation.appealsEnabled ? S('factAppealsOn') : S('factAppealsOff')}</em></dd>
              </div>`}
            ${semType && html`
              <div class="adm-csm-fact">
                <dt>${S('factVocab')}</dt>
                <dd><code>${semType}</code><em>${S('factVocabWhy')}</em></dd>
              </div>`}
            <div class="adm-csm-fact">
              <dt>${S('factRegistered')}</dt>
              <dd>${S('factRegisteredBy', { who: csm.registered_by || '—', when: dt(csm.registered_at) })}</dd>
            </div>
            ${csm.federate && html`
              <div class="adm-csm-fact"><dt>${S('factFederate')}</dt><dd>${S('factFederateOn')}</dd></div>`}
          </dl>

          <div class="adm-csm-warn">
            <b>${S('warnTitle')}</b>${S('warnBody')}
          </div>
        </div>
      </div>
    </div>`;
}

/* ── Writing one ─────────────────────────────────────────────────────────────────────────────── */

function Create({ yaml, setYaml, examples, onTake, onCreate, loading, err, onCancel }) {
  return html`
    <div class="adm-csm-page">
      <div class="adm-csm-head">
        <h2>${S('createTitle')}<small>02</small></h2>
        <button type="button" class="adm-csm-door" onClick=${onCancel}>${t('common.cancel')}</button>
      </div>
      <p class="adm-csm-lead">${S('createLead')}</p>

      <div class="adm-csm-two adm-csm-two--create">
        <div>
          <div class="adm-csm-lbl">${S('theFile')}</div>
          <textarea class="adm-csm-editor" rows="22" value=${yaml}
            placeholder=${S('yamlPlaceholder')}
            onInput=${e => setYaml(e.target.value)}></textarea>
          ${err && html`<div class="adm-csm-err"><${ErrorBox} message=${err} /></div>`}
          <div class="adm-csm-act">
            <button class="adm-btn" disabled=${loading || !yaml.trim()} onClick=${onCreate}>
              ${loading ? t('common.loading') : S('registerIt')}
            </button>
            <span class="adm-csm-hint">${S('registerHint')}</span>
          </div>
        </div>

        <div>
          ${(examples || []).length > 0 && html`
            <div class="adm-csm-starts">
              <div class="adm-csm-starts-l">${S('startFrom')}</div>
              <p class="adm-csm-starts-s">${S('startFromWhy')}</p>
              ${examples.map(ex => html`
                <div class="adm-csm-srow" key=${ex.type}>
                  <span class="adm-csm-sname">${ex.name}</span>
                  <button type="button" class="adm-csm-stake" onClick=${() => onTake(ex.type)}>${S('takeIt')}</button>
                  <span class="adm-csm-swhat">${ex.description}</span>
                </div>`)}
            </div>`}
        </div>
      </div>
    </div>`;
}

/* ── The prompt an owner takes to their own chat ─────────────────────────────────────────────── */

function PromptView({ prompt, onBack }) {
  return html`
    <div class="adm-csm-page">
      <div class="adm-csm-crumb">
        <button type="button" onClick=${onBack}>${S('crumb')}</button> · ${S('aiWritesIt')}
      </div>
      <div class="adm-csm-head">
        <h2>${S('promptTitle')}</h2>
        <${CopyButton} text=${prompt} className="adm-btn"
          label=${t('common.copy')} copiedLabel=${t('common.copied')} />
      </div>
      <p class="adm-csm-lead">${S('promptLead')}</p>
      <pre class="adm-csm-prompt">${prompt}</pre>
    </div>`;
}
