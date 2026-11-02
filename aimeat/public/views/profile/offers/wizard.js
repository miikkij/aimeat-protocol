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
 *   v1.2.0 — 2026-11-01 — The definition carries the attribution and the words per language; a shut
 *     "Next" says why; "Publish" is shut, with the source named, while the audience is wider than the
 *     sources allow; step 3 builds again after its words change, so the ODPS excerpt is current (WP10e).
 *   v1.1.0 — 2026-11-01 — Step 4 "When the source changes" (`schedule: { on: 'change' }`); step 3 asks the
 *     owner's own AI for a description draft (POST .../describe) when the field is empty; a share to a
 *     person on another AIMEAT node by their account; refusals in the page's language (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { swallowed } from '/js/swallowed.js';
import * as dp from '/js/services/dataproducts.js';
import { Tabs } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { Actions, Action, Loud } from '/components/Action.js';
import { renderPage } from './frame.js';
import { d, cronFor, errText } from './data-model.js';
import { getLocale } from '/js/i18n.js';

/** The page's language for the AI's draft: fi, es, or en for any other. */
const pageLang = () => { const l = String(getLocale() || 'en').slice(0, 2); return ['fi', 'es'].includes(l) ? l : 'en'; };
import { stepSources, sourcesReady, sourceSpec } from './wizard-sources.js';
import { stepColumns, stepPreview, columnsFromProbe } from './wizard-columns.js';
import { stepSchedule, stepWho, stepDone, audienceLimit } from './wizard-publish.js';
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
/**
 * The table names of sources that stay their own tables: after what each source is (the file, the app,
 * the records space, the key, the action, the package), not source-a and source-b. Unique, 2 to 64
 * lowercase letters, digits and dashes; a source with nothing to name it by keeps the node's default.
 */
function tableNames(sources) {
  const taken = new Set();
  return sources.map((src) => {
    const raw = { file: String(src.key || '').split('/').pop().replace(/\.[a-z0-9]+$/i, ''), app: String(src.app || '').replace(/\.html$/, ''),
      records: src.space, memory: String(src.key || '').split(/[./]/).pop(), extension: src.action, datapackage: src.resource || src.name }[src.kind];
    let n = slugOf(raw || '');
    if (!n) return undefined;
    for (let i = 2; taken.has(n); i++) n = `${slugOf(raw).slice(0, 60)}-${i}`;
    taken.add(n);
    return n;
  });
}

export function definitionOf(draft) {
  const named = draft.sources.length > 1 && draft.combine.mode === 'tables' ? tableNames(draft.sources) : [];
  const sources = draft.sources.map((src, i) => ({ ...sourceSpec(src), ...(named[i] ? { resource_name: named[i] } : {}) }));
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
    schedule: draft.schedule.freq === 'change' ? { on: 'change' } : cron ? { cron, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null,
    retention: KEEP[draft.keep] ?? null,
    visibility,
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.keywords.trim() ? { keywords: draft.keywords.split(',').map((k) => k.trim()).filter(Boolean) } : {}),
    ...(draft.license ? { license: draft.license } : {}),
    ...(draft.attribution.trim() ? { attribution: draft.attribution.trim() } : {}),
    ...(i18nOf(draft) ? { i18n: i18nOf(draft) } : {}),
  };
}

/**
 * The words per language: each language tab of step 3 that has words, and the page's own language with
 * the base fields, so a reader and DCAT know which language the base words are in.
 */
function i18nOf(draft) {
  const out = {};
  const put = (lang, w) => {
    const kept = Object.fromEntries(['title', 'description', 'attribution'].map((f) => [f, String(w?.[f] || '').trim()]).filter(([, v]) => v));
    if (Object.keys(kept).length) out[lang] = kept;
  };
  for (const [lang, w] of Object.entries(draft.i18n || {})) put(lang, w);
  put(pageLang(), { title: draft.title, description: draft.description, attribution: draft.attribution });
  return Object.keys(out).length ? out : null;
}

const EMPTY = {
  sources: [], combine: { mode: 'tables', left: '', right: '' }, columns: [], filter: { column: '', op: 'gte', value: '' },
  title: '', name: '', nameTouched: false, description: '', keywords: '', attribution: '', i18n: {},
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
  const [ai, setAi] = useState({ state: 'idle' }); // the description draft by the owner's own AI
  const [wordsLang, setWordsLang] = useState('');  // the language step 3's words are written in

  useEffect(() => { dp.listSourceChoices(ctx.data.owner).then(setChoices).catch((err) => { swallowed('wizard: choices', err); setChoices({}); }); }, [ctx.data.owner]);
  const setDraft = (patch) => setDraftState((cur) => {
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    if (!next.nameTouched) next.name = slugOf(next.title);
    return next;
  });
  const name = draft.name || 'luonnos';
  // Step 3's words: when they change, the trial build runs again after a pause, so the ODPS excerpt
  // names the product as it is now named (it said "luonnos" until the owner pressed "Build again").
  const wordsKey = JSON.stringify([draft.title, draft.name, draft.description, draft.keywords, draft.attribution, draft.i18n]);
  const previewed = useRef('');
  useEffect(() => {
    if (step !== 2 || previewed.current === wordsKey) return undefined;
    const timer = window.setTimeout(() => { if (previewed.current !== wordsKey) tryPreview(); }, 1200);
    return () => window.clearTimeout(timer);
    // tryPreview is made anew on every render; the effect asks again only when the step or the words
    // change, and the timer reads the newest one through the closure of the render that set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [step, wordsKey]);
  // A new step starts at its head: the page scrolls back to the step tabs once it has drawn.
  const go = (i) => {
    setError(''); setStep(i); setReached((r) => Math.max(r, i));
    window.setTimeout(() => document.getElementById('wz-steps')?.scrollIntoView({ block: 'start' }), 0);
  };

  const tryRun = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(errText(err, 'wizard.failed')); }
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
  /**
   * Step 3: the owner's own AI writes a draft of the description from the name, the sources and the
   * columns (POST /v1/dataproducts/{name}/describe). It fills an empty field only; the owner changes it.
   * With no AI to ask, the field stays empty and the page says where the AI is set up.
   */
  const askDraft = async (cur = draft) => {
    setAi({ state: 'working' });
    try {
      const out = await dp.describeDraft(name, { ...definitionOf(cur), lang: pageLang() });
      setAi({ state: 'done', text: out.description, provenance: out.provenance || null });
      // An owner who wrote meanwhile keeps their words; the draft fills an empty field only.
      setDraft((now) => (now.description.trim() ? {} : { description: out.description }));
    } catch (err) {
      const details = err?.response?.error?.details || {};
      setAi(details.reason ? { state: 'noai', reason: details.reason, settingsUrl: details.settings_url } : { state: 'failed', error: errText(err, 'preview.aiFailed') });
    }
  };
  /** Step 2 → 3, and again when step 3 changes: the whole draft built, nothing stored. */
  const tryPreview = (then) => tryRun(async () => {
    previewed.current = wordsKey;
    // A join key is chosen on step 1, so a refusal of the key is said there, not on step 2.
    const out = await dp.previewDraft(name, definitionOf(draft)).catch((err) => {
      if ((err?.code || err?.response?.error?.code) === 'JOIN_DUPLICATE_KEY' && step !== 0) go(0);
      throw err;
    });
    setPreview(out);
    if (then !== undefined) go(then);
    if (then === 2 && !draft.description.trim() && ai.state === 'idle') void askDraft();
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
        const expires = new Date(`${s.until}T23:59:59`).toISOString();
        // A person on another AIMEAT node is shared with by their own account, with no party and no key.
        const out = s.how === 'aimeat'
          ? await dp.shareWithParty({ recipient: s.account, display_name: s.who, package: draft.name, purpose: s.purpose, expires })
          : await dp.shareWithParty({ name: s.party, display_name: s.who, kind: s.how, package: draft.name, purpose: s.purpose,
            expires, ...(s.email ? { contact: s.email } : {}) });
        const link = s.email ? await dp.sendShareLink(out, s.email) : null;
        shares.push({ ...s, out, link });
      } catch (err) { shares.push({ ...s, error: errText(err, 'share.failed') }); }
    }
    let sale = null;
    if (draft.sell.on) {
      try { await dp.sellPackage(ctx.data.owner, draft.name, termsBody(draft.sell)); sale = { ok: true }; }
      catch (err) { sale = { error: errText(err, 'sell.failed') }; }
    }
    const pkg = await dp.getPackage(ctx.data.owner, draft.name).catch((err) => { swallowed('wizard: package', err); return null; });
    setResult({ ran, shares, sale, pkg, visibility: def.visibility });
    ctx.data.reload();
    go(5);
  });

  const s = { ctx, draft, setDraft, choices, probe, preview, busy, result, tryPreview, name, tryProbeOnly: () => tryProbe(false), ai, askDraft: () => askDraft(), wordsLang, setWordsLang };
  const id = STEPS[step];
  const body = [stepSources, stepColumns, stepPreview, stepSchedule, stepWho, stepDone][step](s);
  // Each step's way on, and why it is shut when it is (a disabled button says nothing by itself).
  const limit = audienceLimit(draft, preview);
  const next = [
    { label: d('wizard.next.columns'), ok: sourcesReady(draft), why: d('wizard.why.sources'), run: () => tryProbe(true) },
    { label: d('wizard.next.preview'), ok: draft.columns.some((c) => c.include), why: d('wizard.why.columns'), run: () => tryPreview(2) },
    { label: d('wizard.next.schedule'), ok: !!draft.name && preview?.validation?.ok !== false, why: !draft.name ? d('wizard.why.name') : d('wizard.why.invalid'), run: () => go(3) },
    { label: d('wizard.next.who'), ok: true, run: () => go(4) },
    { label: d('wizard.publish'), ok: !!draft.name && (draft.visibility !== 'organism' || !!draft.organism) && !limit,
      why: limit ? d('wizard.why.audience') : !draft.name ? d('wizard.why.name') : d('wizard.why.organism'), run: publish },
  ][step];
  const back = step > 0 && step < 5 ? html`<${Action} small onClick=${() => go(step - 1)}>${d('wizard.back')}<//>` : null;
  const cancel = step < 5 ? html`<${Action} small soft onClick=${() => ctx.pickView({ kind: 'page', id: 'data' })}>${d('wizard.cancel')}<//>` : null;
  const crumbs = [{ label: d('list.title'), go: () => ctx.pickView({ kind: 'page', id: 'data' }) }, step === 5 ? (draft.title || draft.name) : d('list.new')];

  return renderPage(ctx, {
    id: 'data', crumbs, wide: true, label: step === 5 ? null : d('wizard.label'), title: d(`wizard.${id}.title`), desc: d(`wizard.${id}.lead`, { n: result?.shares?.length || 0 }),
    children: html`
      <div id="wz-steps"><${Tabs} kind="view" label=${d('wizard.stepsLabel')} value=${id}
        onSelect=${(v) => { const i = STEPS.indexOf(v); if (i <= reached && step < 5) go(i); }}
        items=${STEPS.map((k, i) => ({ value: k, label: `${i + 1} ${d(`wizard.${k}.tab`)}`, disabled: i > reached || (step === 5 && i < 5) }))} /></div>
      ${body}
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${next ? html`<${Actions}>
        <${Loud} control disabled=${!next.ok || busy} onClick=${next.run}>${busy ? d('wizard.working') : next.label}<//>
        ${back}${cancel}
      <//>
      ${!next.ok && next.why ? html`<${Note} kind="aside" size="small">${next.why}<//>` : null}` : null}`,
  });
}
