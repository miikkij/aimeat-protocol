/**
 * @file public/views/profile/offers/wizard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Offers › New data product: the six steps that make a data product without code (design
 *   canvas "Data ulos", boards Vaihe1-Lahde to Vaihe6-Valmis; plan doc-mvwxcas3dom3 D9.7). 1 the sources
 *   and how they combine, 2 the columns that go out, 3 the preview, 4 how often it updates, 5 who may
 *   use it, 6 done. This file holds the draft, the reads the steps need and the publish; the steps are
 *   wizard-sources.js, wizard-columns.js and wizard-publish.js. Every step reads what the node answers:
 *   step 1 tries the sources with POST /v1/dataproducts/{name}/preview (each source its own table),
 *   step 3 previews the whole draft, and "Publish" is PUT /v1/dataproducts/{name}, POST .../run, then
 *   one POST /v1/parties/share per named share and PUT .../exchange for a sale: the calls
 *   aimeat_dataproduct, aimeat_party and aimeat_datapackage_sell make, so the chat and this page build
 *   the same thing. Nothing is stored before "Publish".
 * @structure DataWizard · definitionOf · slugOf · STEPS
 * @usage html`<${DataWizard} ctx=${ctx} />`
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9a).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { swallowed } from '/js/swallowed.js';
import * as dp from '/js/services/dataproducts.js';
import { Tabs } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { Actions, Action, Loud } from '/components/Action.js';
import { renderPage } from './frame.js';
import { d, cronFor } from './data-model.js';
import { stepSources, sourcesReady, sourceSpec } from './wizard-sources.js';
import { stepColumns, stepPreview, columnsFromProbe } from './wizard-columns.js';
import { stepSchedule, stepWho, stepDone } from './wizard-publish.js';
import { termsBody, EMPTY_SALE } from './sell-dialog.js';

export const STEPS = ['sources', 'columns', 'preview', 'schedule', 'who', 'done'];

/** The address name from a title: lowercase letters, digits and dashes, 2 to 64. */
export function slugOf(words) {
  const s = String(words || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return s.length >= 2 ? s : '';
}

const KEEP = { '12': { keep: 12, unit: 'versions' }, '6m': { keep: 6, unit: 'months' }, all: null };

/** The draft as the definition PUT /v1/dataproducts/{name} takes. */
export function definitionOf(draft) {
  const sources = draft.sources.map(sourceSpec);
  const combine = sources.length > 1
    ? { mode: draft.combine.mode, ...(draft.combine.mode === 'join' && draft.combine.left && draft.combine.right ? { key: { left: draft.combine.left, right: draft.combine.right } } : {}) }
    : { mode: 'tables' };
  const columns = draft.columns.length
    ? draft.columns.filter((c) => c.include).map((c) => ({ source: c.source, from: c.from, name: c.name || c.from, type: c.type, ...(c.description ? { description: c.description } : {}), ...(c.personal ? { include: true } : {}) }))
    : undefined;
  const f = draft.filter;
  const value = f && f.value !== '' && !Number.isNaN(Number(f.value)) ? Number(f.value) : f?.value;
  const cron = cronFor(draft.schedule);
  const visibility = draft.visibility === 'organism' ? (draft.organism ? `organism:${draft.organism}` : 'private') : draft.visibility;
  return {
    sources, combine, ...(columns ? { columns } : {}),
    filter: f && f.column && f.value !== '' ? { column: f.column, op: f.op, value } : null,
    schedule: cron ? { cron, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null,
    retention: KEEP[draft.keep] ?? null,
    visibility,
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.keywords.trim() ? { keywords: draft.keywords.split(',').map((k) => k.trim()).filter(Boolean) } : {}),
    ...(draft.license ? { license: draft.license } : {}),
  };
}

const EMPTY = {
  sources: [], combine: { mode: 'tables', left: '', right: '' }, columns: [], filter: { column: '', op: 'gte', value: '' },
  title: '', name: '', nameTouched: false, description: '', keywords: '',
  schedule: { freq: 'weekly', day: 1, time: '06:00' }, keep: '12',
  visibility: 'private', organism: '', license: '', shares: [], sell: { on: false, ...EMPTY_SALE },
};

export function DataWizard({ ctx }) {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [draft, setDraftState] = useState(EMPTY);
  const [choices, setChoices] = useState(null);
  const [probe, setProbe] = useState(null);      // the sources tried, each its own table
  const [preview, setPreview] = useState(null);  // the whole draft built
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);    // what Publish made

  useEffect(() => { dp.listSourceChoices(ctx.data.owner).then(setChoices).catch((err) => { swallowed('wizard: choices', err); setChoices({}); }); }, [ctx.data.owner]);
  const setDraft = (patch) => setDraftState((cur) => {
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    if (!next.nameTouched) next.name = slugOf(next.title);
    return next;
  });
  const name = draft.name || 'luonnos';
  // A new step starts at its head: the page scrolls back to the step tabs once it has drawn.
  const go = (i) => {
    setError(''); setStep(i); setReached((r) => Math.max(r, i));
    window.setTimeout(() => document.getElementById('wz-steps')?.scrollIntoView({ block: 'start' }), 0);
  };

  const tryRun = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err?.message || d('wizard.failed')); }
    setBusy(false);
  };

  /** Step 1 → 2: each source read as its own table, so step 2 knows every column. */
  const tryProbe = (advance = true) => tryRun(async () => {
    const body = { sources: draft.sources.map(sourceSpec), combine: { mode: 'tables' }, visibility: 'private' };
    const out = await dp.previewDraft(name, body);
    setProbe(out);
    setDraft((cur) => ({ columns: columnsFromProbe(out, cur.sources, cur.columns) }));
    if (advance) go(1);
  });
  /** Step 2 → 3, and again when step 3 changes: the whole draft built, nothing stored. */
  const tryPreview = (then) => tryRun(async () => {
    const out = await dp.previewDraft(name, definitionOf(draft));
    setPreview(out);
    if (then !== undefined) go(then);
  });
  /** Step 5: define, run, share, sell. A step that fails says so; what was made before it stays. */
  const publish = () => tryRun(async () => {
    if (!draft.name) throw new Error(d('wizard.needName'));
    const def = definitionOf(draft);
    await dp.defineProduct(draft.name, def);
    const ran = await dp.runProduct(draft.name);
    const shares = [];
    for (const s of draft.shares) {
      try {
        const out = await dp.shareWithParty({ name: s.party, display_name: s.who, kind: s.how, package: draft.name, purpose: s.purpose,
          expires: new Date(`${s.until}T23:59:59`).toISOString(), ...(s.email ? { contact: s.email } : {}) });
        const link = s.email ? await dp.sendShareLink(out, s.email) : null;
        shares.push({ ...s, out, link });
      } catch (err) { shares.push({ ...s, error: err?.message || d('share.failed') }); }
    }
    let sale = null;
    if (draft.sell.on) {
      try { await dp.sellPackage(ctx.data.owner, draft.name, termsBody(draft.sell)); sale = { ok: true }; }
      catch (err) { sale = { error: err?.message || d('sell.failed') }; }
    }
    const pkg = await dp.getPackage(ctx.data.owner, draft.name).catch((err) => { swallowed('wizard: package', err); return null; });
    setResult({ ran, shares, sale, pkg, visibility: def.visibility });
    ctx.data.reload();
    go(5);
  });

  const s = { ctx, draft, setDraft, choices, probe, preview, busy, result, tryPreview, name, tryProbeOnly: () => tryProbe(false) };
  const id = STEPS[step];
  const body = [stepSources, stepColumns, stepPreview, stepSchedule, stepWho, stepDone][step](s);
  const next = [
    { label: d('wizard.next.columns'), ok: sourcesReady(draft), run: () => tryProbe(true) },
    { label: d('wizard.next.preview'), ok: draft.columns.some((c) => c.include), run: () => tryPreview(2) },
    { label: d('wizard.next.schedule'), ok: !!draft.name && preview?.validation?.ok !== false, run: () => go(3) },
    { label: d('wizard.next.who'), ok: true, run: () => go(4) },
    { label: d('wizard.publish'), ok: !!draft.name && (draft.visibility !== 'organism' || !!draft.organism), run: publish },
  ][step];
  const back = step > 0 && step < 5 ? html`<${Action} small onClick=${() => go(step - 1)}>${d('wizard.back')}<//>` : null;
  const cancel = step < 5 ? html`<${Action} small soft onClick=${() => ctx.pickView({ kind: 'page', id: 'data' })}>${d('wizard.cancel')}<//>` : null;
  const crumbs = [{ label: d('list.title'), go: () => ctx.pickView({ kind: 'page', id: 'data' }) }, step === 5 ? (draft.title || draft.name) : d('list.new')];

  return renderPage(ctx, {
    id: 'data', crumbs, label: step === 5 ? null : d('wizard.label'), title: d(`wizard.${id}.title`), desc: d(`wizard.${id}.lead`, { n: result?.shares?.length || 0 }),
    children: html`
      <div id="wz-steps"><${Tabs} kind="view" label=${d('wizard.stepsLabel')} value=${id}
        onSelect=${(v) => { const i = STEPS.indexOf(v); if (i <= reached && step < 5) go(i); }}
        items=${STEPS.map((k, i) => ({ value: k, label: `${i + 1} ${d(`wizard.${k}.tab`)}`, disabled: i > reached || (step === 5 && i < 5) }))} /></div>
      ${body}
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${next ? html`<${Actions}>
        <${Loud} control disabled=${!next.ok || busy} onClick=${next.run}>${busy ? d('wizard.working') : next.label}<//>
        ${back}${cancel}
      <//>` : null}`,
  });
}
