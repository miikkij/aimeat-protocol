/**
 * @file public/views/appcat/sections/odps-tool.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ODPS description of one tool, inside the Monetize tool editor (question 3, "On
 *   the marketplace"): what a buyer reads before contracting. A listed tool is projected into an Open
 *   Data Product Specification v4.1 document (GET /v1/exchange/offerings/{id}/odps.yaml); the node
 *   derives price, plans, access, licence rights and observed use, and what it cannot derive is
 *   written here into the tool's own `odps` and `provenance` in the manifest.
 *
 *   As the old catalogue's js/odps.js: a folded block ("▸ ODPS description", with "View odps.yaml"
 *   when the tool is listed); "Draft with AI" fills the DESCRIPTIVE fields with the owner's own AI key
 *   and never the attestations; "Generate from a real call" (only when the saved tool has an `ext:`
 *   binding) calls the capability once, stores the answer as a public file and puts its address in
 *   the sample field; the measured delivery time can be taken with 30 % headroom; a block never
 *   opened during an edit leaves the tool's ODPS data untouched (readOdpsTool).
 * @structure OdpsToolBlock({ d, m, tool, form, set }) · odpsFormOf(tool) · readOdpsTool(base, form, open)
 * @usage html`<${OdpsToolBlock} d=${d} m=${m} tool=${base} form=${form} set=${set} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (appcat sections-d): the head row with the file
 *     link (Action tone 'file'), the form at the old spacing (Fields `plain chapter`, the chapter's grey
 *     lines and door rows), the status lines that keep their room, the provenance in its statement box;
 *     a finished AI draft is said as a notice too, as the old page did.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's js/odps.js.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { api } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Row } from '/components/Layout.js';
import { x } from '/views/appcat/i18n.js';
import { aiComplete } from '/views/appcat/ai-calls.js';
import { patchManifest, ownerGhiiOf, MONEY_UNIT } from '/views/appcat/sections/tools-manifest.js';

const html = htm.bind(h);

/** Mirrors ODPS_PRODUCT_TYPES / ODPS_SLA_* / ODPS_QUALITY_* in src/models/odps-schemas.ts. */
const PRODUCT_TYPES = ['', 'raw data', 'derived data', 'dataset', 'reports', 'analytic view', 'algorithm',
  'decision support', 'automated decision-making', 'data-enhanced product', 'data-driven service',
  'data-enabled performance', 'bi-directional'];
const SLA_DIMENSIONS = ['latency', 'uptime', 'responseTime', 'errorRate', 'endOfSupport', 'endOfLife',
  'updateFrequency', 'timeToDetect', 'timeToNotify', 'timeToRepair', 'emailResponseTime'];
const SLA_UNITS = ['percent', 'milliseconds', 'seconds', 'minutes', 'days', 'weeks', 'months', 'years', 'never', 'date'];
const QUALITY_DIMENSIONS = ['accuracy', 'completeness', 'conformity', 'consistency', 'coverage', 'timeliness', 'validity', 'uniqueness'];
const QUALITY_UNITS = ['percentage', 'number'];

/** A drop-down's options, the empty value drawn as "—" (the old select's words). */
export function optionsOf(list) { return list.map((o) => [o, o || '—']); }

/** Commitment lines "uptime 99.5 percent — Monthly availability", one per dimension. */
function dimsToText(dims) {
  return (dims || []).map((d) => d.dimension + ' ' + d.objective + ' ' + d.unit + (d.description ? ' — ' + d.description : '')).join('\n');
}

/** Those lines back; an unknown dimension or unit is dropped rather than saved as garbage. */
function textToDims(text, dimensions, units) {
  const out = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('—');
    const head = parts[0].trim().split(/\s+/);
    const desc = parts.length > 1 ? parts.slice(1).join('—').trim() : '';
    if (head.length < 3) continue;
    const dim = head[0];
    const objective = parseFloat(String(head[1]).replace(',', '.'));
    const unit = head[2];
    if (!dimensions.includes(dim) || !units.includes(unit) || !Number.isFinite(objective)) continue;
    const entry = { dimension: dim, objective, unit };
    if (desc) entry.description = desc;
    out.push(entry);
  }
  return out;
}

const listOf = (s) => (s || '').split(',').map((v) => v.trim()).filter(Boolean);

/** The block's fields, filled from the tool being edited. */
export function odpsFormOf(tool) {
  const o = (tool && tool.odps) || {};
  const p = (tool && tool.provenance) || {};
  return {
    odType: o.productType || '',
    odValue: o.valueProposition || '',
    odCategories: (o.categories || []).join(', '),
    odStandards: (o.standards || []).join(', '),
    odUseCases: (o.useCases || []).map((u) => u.title + (u.description ? ' | ' + u.description : '') + (u.url ? ' | ' + u.url : '')).join('\n'),
    odSample: o.contentSample || '',
    odSla: dimsToText(o.sla),
    odQuality: dimsToText(o.dataQuality),
    odSource: p.source || '',
    odTransformations: p.transformations || '',
    sampleInput: '',
  };
}

/**
 * The block read into { odps, provenance }, merged over the tool being edited so the fields it does
 * not show survive. A block never opened in this edit keeps whatever the tool had, untouched.
 */
export function readOdpsTool(base, f, open) {
  if (!open) return { odps: base && base.odps, provenance: base && base.provenance };
  const odps = { ...((base && base.odps) || {}) };
  const prov = { ...((base && base.provenance) || {}) };
  const set = (obj, key, v) => { if (v) obj[key] = v; else delete obj[key]; };
  set(odps, 'productType', f.odType.trim());
  set(odps, 'valueProposition', f.odValue.trim());
  const cats = listOf(f.odCategories); if (cats.length) odps.categories = cats; else delete odps.categories;
  const stds = listOf(f.odStandards); if (stds.length) odps.standards = stds; else delete odps.standards;
  const uc = f.odUseCases.trim().split('\n').map((line) => {
    const parts = line.split('|').map((v) => v.trim());
    if (!parts[0]) return null;
    const entry = { title: parts[0] };
    if (parts[1]) entry.description = parts[1];
    if (parts[2]) entry.url = parts[2];
    return entry;
  }).filter(Boolean);
  if (uc.length) odps.useCases = uc; else delete odps.useCases;
  set(odps, 'contentSample', f.odSample.trim());
  const sla = textToDims(f.odSla.trim(), SLA_DIMENSIONS, SLA_UNITS);
  if (sla.length) odps.sla = sla; else delete odps.sla;
  const dq = textToDims(f.odQuality.trim(), QUALITY_DIMENSIONS, QUALITY_UNITS);
  if (dq.length) odps.dataQuality = dq; else delete odps.dataQuality;
  set(prov, 'source', f.odSource.trim());
  set(prov, 'transformations', f.odTransformations.trim());
  return { odps: Object.keys(odps).length ? odps : undefined, provenance: Object.keys(prov).length ? prov : undefined };
}

/** The price the AI is told, in the prompt's own language (the prompt is English by design). */
function promptPrice(tool) {
  const parts = [];
  if (tool.price && tool.price.morsels > 0) parts.push(tool.price.morsels + ' morsels');
  if (tool.priceMoney && tool.priceMoney.amount > 0) parts.push((tool.priceMoney.amount / MONEY_UNIT) + ' ' + tool.priceMoney.currency);
  return parts.join(' · ') || 'not for sale';
}

const DRAFT_SYSTEM = 'You write the descriptive half of an Open Data Product Specification (ODPS v4.1) entry for '
  + 'a capability sold on a marketplace. Return ONLY a JSON object with these keys: '
  + '"productType" (one of: raw data, derived data, dataset, reports, analytic view, algorithm, decision support, '
  + 'automated decision-making, data-enhanced product, data-driven service, data-enabled performance, bi-directional), '
  + '"valueProposition" (one sentence, max 400 characters, what a buyer gets), '
  + '"categories" (2-4 short strings), "standards" (0-3 recognised standards that genuinely apply, else []), '
  + '"useCases" (1-3 objects with "title" and "description"). '
  + 'Base every word on the material given. Do NOT state where the data comes from, its legal basis, consent, '
  + 'retention, service levels, uptime, accuracy or the selling company — those are the owner\'s own attestations '
  + 'and inventing them would be a false claim. No markdown, no commentary, JSON only.';

/** UTF-8 text as base64 (the storage route's `data`). */
function base64Of(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A status line that keeps its room: words in grey while working, green when done, coral when refused. */
function Status({ s }) {
  const tone = s && s.tone === 'ok' ? 'ok' : (s && s.tone === 'err' ? 'refused' : 'busy');
  return html`<${Note} kind="report" chapter keep tone=${tone}>${(s && s.text) || ''}<//>`;
}

/**
 * The per-tool block. `tool` is the saved tool (or {} for a new one), `form` the editor's fields and
 * `set(patch)` changes them; `m` is the shared manifest (toolOpen, offerings, timing, the app's own
 * provenance).
 */
export function OdpsToolBlock({ d, m, tool, form, set }) {
  const [busy, setBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [sampleStatus, setSampleStatus] = useState(null);
  const name = tool.name || '';
  const offeringId = m.offerings[name] || '';
  const timing = m.timing[name] || null;
  const inherited = (m.doc && m.doc.provenance) || {};
  const open = m.toolOpen;

  const draft = async () => {
    if (!getSession()?.jwt) { setAiStatus({ text: x('odps.needLogin') }); return; }
    setBusy(true);
    setAiStatus({ text: x('odps.suggesting') });
    const toolName = form.name || name;
    const toolDescription = form.desc || tool.description || '';
    const prompt = 'App: ' + m.filename + '\n'
      + 'Capability (tool) name: ' + toolName + '\n'
      + (toolDescription ? 'Capability description: ' + toolDescription + '\n' : '')
      + (tool.inputSchema ? 'Input schema: ' + JSON.stringify(tool.inputSchema).slice(0, 1500) + '\n' : '')
      + (tool.outputSchema ? 'Output schema: ' + JSON.stringify(tool.outputSchema).slice(0, 1500) + '\n' : '')
      + 'Price: ' + promptPrice(tool) + '\n'
      + 'Write the ODPS descriptive fields for this capability.';
    try {
      const { content: raw } = await aiComplete({ prompt, systemPrompt: DRAFT_SYSTEM });
      const found = raw.match(/\{[\s\S]*\}/);
      let parsed = null;
      // eslint-disable-next-line aimeat/no-silent-catch -- an unparseable answer is said on the status line just below
      try { parsed = found ? JSON.parse(found[0]) : null; } catch { parsed = null; }
      if (!parsed) { setAiStatus({ text: '✘ ' + x('odps.suggestUnparseable'), tone: 'err' }); return; }
      const patch = {};
      if (PRODUCT_TYPES.includes(parsed.productType)) patch.odType = parsed.productType;
      if (parsed.valueProposition) patch.odValue = String(parsed.valueProposition).slice(0, 512);
      if (Array.isArray(parsed.categories)) patch.odCategories = parsed.categories.join(', ');
      if (Array.isArray(parsed.standards)) patch.odStandards = parsed.standards.join(', ');
      if (Array.isArray(parsed.useCases)) {
        patch.odUseCases = parsed.useCases.map((u) => (u.title || '') + (u.description ? ' | ' + u.description : '')).filter(Boolean).join('\n');
      }
      set(patch);
      setAiStatus({ text: '✔ ' + x('odps.suggestDone'), tone: 'ok' });
      // The old page said it as a notice too.
      if (d) d.notice(x('odps.suggestDone'), 'success');
    } catch (e) {
      setAiStatus({ text: '✘ ' + (e.message || x('odps.suggestFailed')), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const sample = async () => {
    if (!getSession()?.jwt) { setSampleStatus({ text: x('odps.needLogin') }); return; }
    let input;
    try { input = JSON.parse(form.sampleInput || '{}'); } catch { setSampleStatus({ text: x('odps.genSampleBadJson'), tone: 'err' }); return; }
    const bind = /^ext:([^:]+):(.+)$/.exec(form.action || tool.action_id || '');
    if (!bind) { setSampleStatus({ text: x('odps.genSampleNoBinding') }); return; }
    setBusy(true);
    setSampleStatus({ text: x('odps.genSampleRunning') });
    try {
      const res = await api('/v1/ext/' + encodeURIComponent(bind[1]) + '/' + encodeURIComponent(bind[2]),
        { method: 'POST', body: JSON.stringify(input), timeoutMs: 120000 });
      const payload = JSON.stringify(res.data !== undefined ? res.data : res, null, 2);
      const key = 'odps.sample.' + (m.filename || 'app') + '.' + ((form.name || name) || 'tool') + '.json';
      await api('/v1/storage', { method: 'POST', body: JSON.stringify({ key, visibility: 'public', mime_type: 'application/json', data: base64Of(payload) }) });
      set({ odSample: location.origin + '/v1/pub/' + encodeURIComponent(ownerGhiiOf(m)) + '/' + key });
      setSampleStatus({ text: '✔ ' + x('odps.genSampleDone'), tone: 'ok' });
    } catch (e) {
      setSampleStatus({ text: '✘ ' + (e.message || x('odps.genSampleFailed')), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const takeMeasured = (ms) => {
    const line = 'responseTime ' + ms + ' milliseconds — ' + x('odps.measuredNote');
    const now = form.odSla.trim();
    set({ odSla: now ? now + '\n' + line : line });
  };

  // The old block: the head row (the fold and the odps.yaml link, 18px apart), then the form (.od-form)
  // under it with its fields, lines and door rows at the old spacing (Fields `plain chapter`).
  const head = html`<${Actions} chapter>
    <${Action} small expanded=${open} onClick=${() => patchManifest({ toolOpen: !open })}>${(open ? '▾ ' : '▸ ') + x('odps.toolTitle')}<//>
    ${offeringId ? html`<${Action} tone="file" href=${'/v1/exchange/offerings/' + encodeURIComponent(offeringId) + '/odps.yaml'} newTab>${x('odps.viewYaml')}<//>` : null}
  <//>`;
  if (!open) return head;

  return html`${head}
    <${Fields} plain chapter>
      <${Note} kind="quiet" chapter>${x('odps.toolHint')}<//>
      <${Actions} chapter><${Loud} control disabled=${busy} onClick=${draft}>${x('odps.suggest')}<//><//>
      <${Status} s=${aiStatus} />
      <${Select} label=${x('odps.productType')} options=${optionsOf(PRODUCT_TYPES)} value=${form.odType} onChange=${(v) => set({ odType: v })} />
      <${TextArea} label=${x('odps.valueProposition')} rows=${2} value=${form.odValue} placeholder=${x('odps.valuePlaceholder')} onInput=${(v) => set({ odValue: v })} />
      <${Fields} plain chapter cols=${2}>
        <${TextField} label=${x('odps.categories')} value=${form.odCategories} placeholder="company data, finland" onInput=${(v) => set({ odCategories: v })} />
        <${TextField} label=${x('odps.standards')} value=${form.odStandards} placeholder="ISO 8000" onInput=${(v) => set({ odStandards: v })} />
      <//>
      <${TextArea} label=${x('odps.useCases')} rows=${2} value=${form.odUseCases} placeholder=${x('odps.useCasesPlaceholder')} onInput=${(v) => set({ odUseCases: v })} />
      <${TextField} type="url" label=${x('odps.contentSample')} value=${form.odSample} placeholder="https://example.org/sample.json" onInput=${(v) => set({ odSample: v })} />
      ${tool.action_id ? html`
        <${Actions} chapter><${Action} small disabled=${busy} onClick=${sample}>${x('odps.genSample')}<//><//>
        <${Note} kind="quiet" chapter>${x('odps.genSampleHint')}<//>
        <${TextArea} rows=${2} ariaLabel=${x('odps.genSample')} value=${form.sampleInput} placeholder=${x('odps.genSampleInput')} onInput=${(v) => set({ sampleInput: v })} />
        <${Status} s=${sampleStatus} />` : null}
      <${TextArea} label=${x('odps.sla')} rows=${2} value=${form.odSla} placeholder=${x('odps.slaPlaceholder')} onInput=${(v) => set({ odSla: v })} />
      ${timing && timing.count > 0
        ? html`<${Row} wrap gap="small" above="small" below="small">
            <${Note} kind="meta" inline mono>${x('odps.measured', { n: timing.count, p50: timing.p50Ms, p95: timing.p95Ms })}<//>
            <${Action} small onClick=${() => takeMeasured(Math.ceil(timing.p95Ms * 1.3))}>${x('odps.useMeasured')}<//>
          <//>`
        : html`<${Note} kind="quiet" chapter>${x('odps.noMeasurement')}<//>`}
      <${TextArea} label=${x('odps.quality')} rows=${2} value=${form.odQuality} placeholder=${x('odps.qualityPlaceholder')} onInput=${(v) => set({ odQuality: v })} />
      <${Box} tone="statement">
        <${Label} block>${x('odps.toolAttestation')}<//>
        <${Note} kind="quiet" chapter>${x('odps.toolAttestationHint')}<//>
        <${Fields} plain chapter>
          <${TextField} label=${x('odps.source')} value=${form.odSource}
            placeholder=${inherited.source ? x('odps.inheritedIs') + ' ' + inherited.source : x('odps.inheritedNone')}
            onInput=${(v) => set({ odSource: v })} />
          <${TextArea} label=${x('odps.transformations')} rows=${2} value=${form.odTransformations} placeholder=${x('odps.transformationsPlaceholder')} onInput=${(v) => set({ odTransformations: v })} />
        <//>
        <${Actions} chapter><${Action} small onClick=${() => patchManifest({ defaultsOpen: !m.defaultsOpen })}>${x('odps.openAppDefaults')}<//><//>
      <//>
    <//>`;
}
