/**
 * @file public/views/appcat/dialogs/generate.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Generate App with AI", the prompt builder (features F104–F108, F149–F155, F250–F253):
 *   the intro and three steps. 1 "Describe your app": the track (Classic, the default, or Atelier with
 *   its "new" mark; hidden when improving an app, whose own track is used, and "Improving: {name}"
 *   shows instead), the description (it takes the focus), and on Classic only the starting template,
 *   the capability packs with their tier marks (the idea text ticks matching packs as it is typed; a
 *   pack ticked or unticked by hand is left alone for the rest of the page's life), the panel that says
 *   what the pointed, focused or ticked packs do, and the tier legend. 2 "Copy the prompt & paste it
 *   into your AI": the prompt preview and "Copy Prompt" ("✔ Copied!" for 1.4 s; the dialog stays
 *   open). 3 "Add & publish your app": signs the person in when needed, then opens Add on its Paste
 *   tab. Every opening reads the templates, the packs and the node's two build guides again.
 * @structure default GenerateDialog({ app }) · PackPill · usePackDoc
 * @usage openDialog('generate')  — new app.
 *        openDialog('generate', { app: { name, filename, track, html } })  — improve that app (html:
 *        its source as text; track: the manifest's track, 'atelier' or anything else for Classic).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the packs are a group under their label (Field group), the idea field
 *     two lines high; the look of every part is the ruled step's (step-card.css), as the old builder.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old cortex.js prompt builder.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { StepCard } from '/components/StepCard.js';
import { Stack, Row } from '/components/Layout.js';
import { Field } from '/components/Field.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { TextArea } from '/components/TextField.js';
import { copyToClipboard } from '/js/utils.js';
import { x, lang } from '/views/appcat/i18n.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { useFlash } from '/views/appcat/dialogs/parts.js';
import { signInThen } from '/views/appcat/dialogs/app-io.js';
import { buildPrompt } from '/views/appcat/dialogs/generate-prompt.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** The pack categories the builder offers (the old PB_PACK_CATEGORIES). */
const CATEGORIES = ['visualization', 'diagrams', 'canvas', 'game', '3d', 'realtime'];
/** Packs the person ticked or unticked by hand: never changed by the idea text again this page life. */
const touched = new Set();
/** Pack docs by id, read once (GET /v1/library-packs/{id}). */
const docs = {};

/** A word of the table, or `fallback` when the table has no such key. */
function word(key, fallback) {
  const w = x(key);
  return w === 'appcat.' + key ? fallback : w;
}

/** Whether a pack's interview triggers match the idea at a word start (suffixes allowed). */
function matches(pack, text) {
  return (pack.interviewTriggers || []).some((t) => {
    const esc = String(t).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-zà-öø-ÿ])' + esc).test(text);
  });
}

async function getJson(path) {
  const resp = await fetch(path);
  return resp.json();
}

/** One capability pack: a framed check with its tier mark. */
function PackPill({ pack, on, onToggle, onPoint }) {
  const tier = pack.modelTier;
  const proven = (pack.proofs || []).map((p) => p.model + '→' + p.verdict).join(', ');
  const tip = tier
    ? x('pb.tierTip', { tier }) + ' · ' + (proven ? x('pb.tierProven', { list: proven }) : x('pb.tierUnproven'))
      + (pack.apiCaveat ? ' · ⚠ ' + pack.apiCaveat : '')
    : undefined;
  return html`<${Check} pill checked=${on} title=${pack.description || undefined}
    onChange=${(v) => onToggle(pack.id, v)}
    onMouseEnter=${() => onPoint(pack.id)} onMouseLeave=${() => onPoint(null)}
    onFocus=${() => onPoint(pack.id)} onBlur=${() => onPoint(null)}>
    <span>${pack.title}</span>
    ${tier ? html`<span title=${tip}><${Mark} tone=${tier === 'frontier' ? 'coral' : undefined}>${word('pb.tier.' + tier, tier)}<//></span>` : null}
  <//>`;
}

export default function GenerateDialog({ app, close }) {
  const improving = !!app;
  const l = lang();
  const [track, setTrack] = useState(app && app.track === 'atelier' ? 'atelier' : 'classic');
  const [description, setDescription] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [template, setTemplate] = useState(null);
  const [packs, setPacks] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [, setDocTick] = useState(0);
  const [point, setPoint] = useState(null);
  const [core, setCore] = useState({ new: null, improve: null });
  const [coreAtelier, setCoreAtelier] = useState({ new: null, improve: null });
  const [copied, flashCopied] = useFlash(1400);

  const loadDoc = (id) => {
    if (docs[id]) return;
    getJson('/v1/library-packs/' + encodeURIComponent(id))
      .then((d) => { const pack = d.data && d.data.pack; if (pack) { docs[id] = pack; setDocTick((n) => n + 1); } })
      .catch((e) => console.warn('[appcat] pack doc not read; the core text still names the packs', e));
  };

  // Every opening reads the node again: the templates, the packs and the two build guides (F106).
  useEffect(() => {
    let live = true;
    getJson('/v1/app-templates?lang=' + encodeURIComponent(l)).then((d) => {
      const list = ((d.data && d.data.templates) || []).filter((t) => t.kind !== 'component');
      list.sort((a, b) => (a.kind === 'use-case' ? 0 : 1) - (b.kind === 'use-case' ? 0 : 1));
      if (live) setTemplates(list);
    }).catch((e) => console.warn('[appcat] templates not read; they are optional', e));
    getJson('/v1/library-packs?lang=' + encodeURIComponent(l)).then((d) => {
      const all = (d.data && d.data.packs) || [];
      const list = all.filter((p) => {
        if (p.status === 'deprecated') return false;
        if (p.kind === 'vendored' || p.kind === 'bundle') return CATEGORIES.includes(p.category);
        if (p.kind === 'cortex') return CATEGORIES.includes(p.category) && p.id !== 'aimeat-charts';
        return false;
      });
      if (live) setPacks(list);
    }).catch((e) => console.warn('[appcat] capability packs not read (an older node)', e));
    for (const mode of ['new', 'improve']) {
      getJson('/v1/prompts/build-app?mode=' + mode + '&lang=' + encodeURIComponent(l)).then((d) => {
        const body = d && d.data && d.data.body;
        if (live && body && typeof body === 'string') setCore((c) => ({ ...c, [mode]: body }));
      }).catch((e) => console.warn('[appcat] the Classic build guide not read; the inline text is used', e));
      getJson('/v1/prompts/build-app-atelier?mode=' + mode + '&lang=' + encodeURIComponent(l)).then((d) => {
        const full = d && d.data && d.data.prompt;
        if (live && full && typeof full === 'string') setCoreAtelier((c) => ({ ...c, [mode]: full }));
      }).catch((e) => console.warn('[appcat] the Atelier build guide not read', e));
    }
    return () => { live = false; };
  }, [l]);

  // The idea text ticks the packs its words name, and unticks the ones it no longer names.
  const matchIdea = (text, list) => {
    const lower = String(text || '').toLowerCase();
    setPicked((prev) => {
      const next = new Set(prev);
      for (const p of list) {
        if (touched.has(p.id)) continue;
        const hit = matches(p, lower);
        if (hit && !next.has(p.id)) { next.add(p.id); loadDoc(p.id); } else if (!hit) next.delete(p.id);
      }
      return next;
    });
  };
  // When the packs arrive, tick what the idea already names; typing calls matchIdea itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the pack list arrives, not on every key
  useEffect(() => { if (packs.length) matchIdea(description, packs); }, [packs]);

  const onDescription = (v) => { setDescription(v); matchIdea(v, packs); };
  const togglePack = (id, on) => {
    touched.add(id);
    setPicked((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
    if (on) loadDoc(id);
  };
  const chooseTemplate = (id) => {
    setTemplateId(id);
    if (!id) { setTemplate(null); return; }
    getJson('/v1/app-templates/' + encodeURIComponent(id))
      .then((d) => setTemplate((d.data && d.data.template) || null))
      // As the old page: a template that cannot be read builds the prompt without one (the preview shows it).
      .catch((err) => { swallowed('appcat: generate template', err); setTemplate(null); });
  };

  const prompt = buildPrompt({
    track, app: app || null, description, lang: l, core, coreAtelier,
    template: track === 'classic' ? template : null,
    packs: track === 'classic' ? packs.filter((p) => picked.has(p.id)).map((p) => docs[p.id]) : [],
    atelierLoading: x('pb.atelierLoading'),
  });

  const info = packs.filter((p) => (point ? p.id === point : picked.has(p.id)) && p.description);
  const templateOptions = [['', x('pb.noneTemplate')], ...templates.map((t) => [t.id,
    (t.kind === 'use-case' ? '★ ' : '') + t.title + (t.kind === 'use-case' && t.description ? ' — ' + t.description.slice(0, 70) : '')])];

  const addApp = () => signInThen(() => openDialog('add', { tab: 'paste' }));

  return html`<${Dialog} title=${x('pb.title')} size="lg" footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Note} kind="lead">${x('pb.intro')}<//>
    <${StepCard} rule num="1" title=${x('pb.step1')}>
      <${Stack} gap="medium">
        ${improving
          ? html`<${Note} kind="report" tone="refused" role="note"><strong>${x('pb.improving')}: ${app.name || app.filename || x('pb.thisApp')}</strong><//>`
          : html`<${Choice} boxed cols=${2} ariaLabel=${x('pb.trackLabel')} value=${track} onChange=${setTrack} options=${[
            { value: 'classic', label: x('pb.trackClassic'), hint: x('pb.trackClassicDesc') },
            { value: 'atelier', label: html`${x('pb.trackAtelier')} <${Mark} tone="coral">${x('pb.trackNew')}<//>`, hint: x('pb.trackAtelierDesc') },
          ]} />`}
        <${TextArea} autoFocus rows=${2} ariaLabel=${x('pb.step1')} placeholder=${x('pb.descPh')}
          value=${description} onInput=${onDescription} />
        ${track === 'classic' ? html`
          <${Select} label=${'✨ ' + x('pb.template')} value=${templateId} options=${templateOptions} onChange=${chooseTemplate} />
          <${Field} label=${'🧰 ' + x('pb.packs')} group>
            <${Note} kind="hint">${x('pb.packsHint')}<//>
            <${Row} gap="small" wrap>
              ${packs.map((p) => html`<${PackPill} key=${p.id} pack=${p} on=${picked.has(p.id)} onToggle=${togglePack} onPoint=${setPoint} />`)}
            <//>
            ${info.length ? html`<${Stack} gap="tight">${info.map((p) => html`<${Note} key=${p.id} kind="hint"><strong>${(p.title || p.id) + ':'}</strong> ${p.description}<//>`)}<//>` : null}
            <${Note} kind="hint">${x('pb.tierLegend')}<//>
          <//>` : null}
      <//>
    <//>
    <${StepCard} rule num="2" title=${x('pb.step2')}>
      <${Stack} gap="small">
        <${Note} kind="hint">${x('pb.step2hint')}<//>
        <${Label} ruled>${x('pb.promptPreview')}<//>
        <${Code} block scroll>${prompt}<//>
        <div><${Loud} control onClick=${async () => { await copyToClipboard(prompt); flashCopied(); }}>${copied ? '✔ ' + x('pb.copied') : x('pb.copy')}<//></div>
      <//>
    <//>
    <${StepCard} rule num="3" title=${x('pb.step3')}>
      <${Stack} gap="small">
        <${Note} kind="hint">${x('pb.step3hint')}<//>
        <div><${Action} onClick=${addApp}>${x('pb.addBtn')}<//></div>
      <//>
    <//>
  <//>`;
}
