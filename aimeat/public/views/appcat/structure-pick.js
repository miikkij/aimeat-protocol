/**
 * @file public/views/appcat/structure-pick.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two pickers of the app structure page: the layout (the main view and how a person
 *   moves between views) at ?step=layout, and the look (and a Design Book genre to start from) at
 *   ?step=look. Each answer is drawn, not described: a LayoutSketch of the preset's own blocks, a
 *   LookSample the kit itself draws. Every list is the node's (GET /v1/apps/ui/catalogue,
 *   GET /v1/designbook?kind=genre), so a layout, a navigation mode, a look or a genre added there
 *   shows here with no change.
 *
 *   "Let the AI decide" is the first answer and the one chosen when nothing is: Jouni, 2026-10-29,
 *   "yleensä hyvä on jos claude itse päättää". The choice goes to the plan with "Send to your AI";
 *   a connected AI reads it from there, and "Copy prompt" gives an AI that cannot connect the same
 *   choice in words.
 *
 *   The AI's own options come first (Jouni, 2026-10-30: the layouts should adapt to the app "eikä
 *   pakota jotain tiettyä muottia", and the presets stay to look at too): the layouts and navigations
 *   the building AI drew for this app (plan.proposals), each drawn from its own sketch, then the
 *   node's presets in a section of their own. Under them, a field for what the person would change,
 *   which goes to the AI as the note on their choice.
 *
 *   Writes no class; the parts are components.
 * @structure StructurePick({ kind, s, appRef, onSaved, onBack }) (`appRef`, never `ref`: Preact keeps
 *   `ref` for itself and the component never sees it) · layoutRows(preset) · NAV_SKETCH · LOOK_GROUPS ·
 *   PickSections · drawnOption · wishOf · patchOf(s, picks, wish)
 * @usage html`<${StructurePick} kind="layout" s=${structure} appRef=${ref} onSaved=${set} onBack=${back} />`
 * @version-history
 *   v1.1.0 — 2026-10-30 — The layouts the AI drew for the app first, the presets after, and the person's change.
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Band } from '/components/Band.js';
import { BackLink } from '/components/BackLink.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Mark, Code } from '/components/Mark.js';
import { Section } from '/components/Section.js';
import { Choice } from '/components/Choice.js';
import { StepList } from '/components/StepList.js';
import { SaveBar } from '/components/SaveBar.js';
import { Action, Loud } from '/components/Action.js';
import { Row as Line, Stack, Beside } from '/components/Layout.js';
import { LayoutSketch } from '/components/LayoutSketch.js';
import { LookSample } from '/components/LookSample.js';
import { TextArea } from '/components/TextField.js';
import { swallowed } from '/js/swallowed.js';
import { tOr } from '/js/i18n.js';
import { x } from '/views/appcat/i18n.js';
import { readCatalogue, readGenres, writePlan, choiceName, choiceLine, aiPrompt, proposalsOf, optionName } from '/views/appcat/structure-data.js';

const html = htm.bind(h);
const AI = '__ai';

/** A block's word in the sketch: the component's name in the reader's language, or its id. */
const blockWord = (component) => tOr(`appcat.structure.block.${component}`, component);

/**
 * The sketch rows of a layout preset, from its own blocks: a `main` and a `side` next to each other
 * share a row, two `half` blocks share a row, anything else is a row of its own. The first block is
 * the band at the top; a hero is drawn in ink.
 */
export function layoutRows(preset) {
  const blocks = preset?.layout?.blocks || [];
  const rows = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const cell = (blk) => ({ w: blk.span === 'main' || blk.span === 'side' || blk.span === 'half' ? blk.span : 'full', label: blockWord(blk.component), tone: blk.component === 'hero' ? 'ink' : undefined });
    const pairs = (b.span === 'main' || b.span === 'side' || b.span === 'half') && blocks[i + 1] && ['main', 'side', 'half'].includes(blocks[i + 1].span);
    const cells = pairs ? [cell(b), cell(blocks[++i])] : [cell(b)];
    const tall = cells.some((c) => c.w !== 'full') || ['list', 'cardGrid', 'queue', 'table'].includes(b.component);
    rows.push({ height: cells[0].tone === 'ink' ? 's' : tall ? 'l' : 'm', cells });
  }
  return rows.length ? rows : [{ height: 'l', cells: [{ w: 'full', label: preset?.id || '' }] }];
}

/** How each navigation mode looks; a mode the node adds later is drawn as one plain area. */
const NAV_SKETCH = {
  tabs: [{ height: 's', cells: [{ w: 'side', tone: 'ink' }, { w: 'side' }, { w: 'side' }] }, { height: 'l', cells: [{ w: 'full' }] }],
  'bottom-bar': [{ height: 'l', cells: [{ w: 'full' }] }, { height: 's', cells: [{ w: 'side', tone: 'ink' }, { w: 'side' }, { w: 'side' }, { w: 'side' }] }],
  rail: [{ height: 'l', cells: [{ w: 'tiny', tone: 'ink' }, { w: 'full' }] }],
  flow: [{ height: 's', cells: [{ w: 'side', tone: 'sun' }, { w: 'side' }, { w: 'side' }] }, { height: 'l', cells: [{ w: 'full' }] }],
  deck: [{ height: 'l', cells: [{ w: 'tiny' }, { w: 'full', tone: 'sun' }, { w: 'tiny' }] }],
  canvas: [{ height: 'l', cells: [{ w: 'full', label: '+' }] }],
  overlay: [{ height: 'l', cells: [{ w: 'main' }, { w: 'side', tone: 'ink' }] }],
};
const AI_SKETCH = [{ height: 'l', cells: [{ w: 'full', tone: 'sun' }] }];

/** The groups a person narrows the looks by; a look the node adds later is in "All" only. */
const LOOK_GROUPS = {
  calm: ['flat', 'calm-card', 'gallery', 'workbench', 'dawn'],
  paper: ['editorial', 'broadsheet', 'kirjapaino', 'riso'],
  loud: ['vivid', 'aurora', 'poster', 'sticker', 'brutalist', 'carnival', 'billboard'],
  night: ['neon-dense', 'terminal', 'tdr', 'stage', 'broadcast', 'lounge'],
};

const theme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

/** The plan's value of a choice, or AI when nothing is chosen. */
const picked = (s, key) => s.plan?.choices?.[key]?.value || AI;

/** The person's change to their layout choice, as the plan holds it: their own note on it. */
const wishOf = (s) => {
  const c = s.plan?.choices?.layout;
  return c && c.by === 'owner' && c.note ? c.note : '';
};

/**
 * The patch that sends the picks: a pick that differs from the plan is written; "let the AI decide"
 * clears a choice only the person had made, and leaves the AI's own choice alone. The person's change
 * (`wish`) rides on the layout choice as its note; with the layout left to the AI it becomes a layout
 * of their own, described by the change.
 */
function patchOf(s, picks, wish) {
  const choices = {};
  for (const [key, v] of Object.entries(picks)) {
    const cur = s.plan?.choices?.[key];
    const note = key === 'layout' && wish !== undefined ? wish.trim() : '';
    if (v === AI) {
      if (note) { if (!cur || cur.value !== 'custom' || cur.note !== note) choices[key] = { value: 'custom', note }; continue; }
      if (cur && cur.by === 'owner') choices[key] = null;
      continue;
    }
    if (!cur || cur.value !== v || cur.by !== 'owner' || (note && cur.note !== note)) choices[key] = { value: v, ...(note ? { note } : {}) };
  }
  return Object.keys(choices).length ? { choices } : null;
}

function SendBar({ s, appRef: ref, picks, wish, onSaved }) {
  const [said, setSaid] = useState(null);
  const [busy, setBusy] = useState(false);
  const names = Object.entries(picks).map(([k, v]) => `${x(`structure.prompt.${k}`)}: ${v === AI ? x('structure.aiDecides') : optionName(s, k, v)}`).join(' · ');
  const send = async () => {
    const patch = patchOf(s, picks, wish);
    if (!patch) { setSaid('same'); return; }
    setBusy(true);
    try { onSaved(await writePlan(ref.owner, ref.filename, patch)); setSaid('sent'); } catch (err) { swallowed('structure: send', err); setSaid('failed'); }
    setBusy(false);
  };
  const words = Object.fromEntries(Object.entries(picks).filter(([, v]) => v !== AI));
  return html`<${SaveBar} label=${x('structure.yourChoice')}>
    <${Line} wrap align="center" justify="between">
      <${Stack} gap="tight">
        <${Mark} kind="word">${x('structure.yourChoice')}<//>
        <${Note} inline>${names}<//>
        ${said ? html`<${Note} kind="message" error=${said === 'failed'}>${x(`structure.said.${said}`)}<//>` : null}
      <//>
      <${Line} wrap align="center">
        <${Action} small copy=${aiPrompt(s, words, wish?.trim())}>${x('structure.copyPrompt')}<//>
        <${Loud} control onClick=${send} disabled=${busy}>${x('structure.send')}<//>
      <//>
    <//>
  <//>`;
}

/** An option the AI drew for this app, drawn from its own sketch. */
const drawnOption = (p) => ({ value: p.id, label: p.name, hint: p.note, pic: html`<${LayoutSketch} rows=${p.sketch} label=${p.name} />` });

/**
 * One choice of the layout page. With options the AI drew for this app, they come first, with "let
 * the AI decide", and the node's presets follow in a section of their own; both sections pick the
 * same value. Without them it is the presets after "let the AI decide", as before.
 */
function PickSections({ kind, cols, drawn, presets, value, onChange, aiOption }) {
  const title = x(`structure.layout.${kind}Title`);
  if (!drawn.length) {
    return html`<${Section} id=${`structure-layout-${kind}`} title=${title} first=${kind === 'main'}>
      <${Note} kind="lead">${x(`structure.layout.${kind}Lead`)}<//>
      <${Choice} boxed cols=${cols} value=${value} onChange=${onChange} options=${[aiOption, ...presets]} ariaLabel=${title} />
    <//>`;
  }
  return html`
    <${Section} id=${`structure-layout-${kind}-drawn`} title=${title} first=${kind === 'main'}>
      <${Note} kind="lead">${x(`structure.layout.${kind}Drawn`)}<//>
      <${Choice} boxed cols=${3} value=${value} onChange=${onChange} options=${[...drawn.map(drawnOption), aiOption]} ariaLabel=${title} />
    <//>
    <${Section} id=${`structure-layout-${kind}`} title=${x(`structure.layout.${kind}PresetsTitle`)}>
      <${Note} kind="lead">${x(`structure.layout.${kind}PresetsLead`)}<//>
      <${Choice} boxed cols=${cols} value=${value} onChange=${onChange} options=${presets} ariaLabel=${x(`structure.layout.${kind}PresetsTitle`)} />
    <//>`;
}

function LayoutPick({ s, appRef: ref, onSaved }) {
  const [cat, setCat] = useState(null);
  const [layout, setLayout] = useState(picked(s, 'layout') === 'custom' ? AI : picked(s, 'layout'));
  const [nav, setNav] = useState(picked(s, 'nav') === 'custom' ? AI : picked(s, 'nav'));
  const [wish, setWish] = useState(wishOf(s));
  useEffect(() => { readCatalogue().then(setCat).catch((err) => swallowed('structure: catalogue', err)); }, []);
  if (!cat) return html`<${Note} kind="loading">${x('structure.loading')}<//>`;
  const aiOption = (kind) => ({ value: AI, label: x('structure.aiDecides'), hint: x(`structure.aiDecides.${kind}`), pic: html`<${LayoutSketch} rows=${AI_SKETCH} label=${x('structure.aiDecides')} />` });
  const layoutPresets = cat.layouts.map((p) => ({
    value: p.id, label: choiceName('layout', p.id),
    hint: html`${choiceLine('layout', p.id, p.summary)}<${Code}>${tOr(`appcat.structure.layout.${p.id}.say`, p.id)}<//>`,
    pic: html`<${LayoutSketch} rows=${layoutRows(p)} label=${choiceName('layout', p.id)} />`,
  }));
  const navPresets = cat.navModes.map((id) => ({
    value: id, label: choiceName('nav', id), hint: choiceLine('nav', id, ''),
    pic: html`<${LayoutSketch} rows=${NAV_SKETCH[id] || AI_SKETCH} label=${choiceName('nav', id)} />`,
  }));
  return html`
    <${PickSections} kind="main" cols=${3} drawn=${proposalsOf(s, 'layout')} presets=${layoutPresets} value=${layout} onChange=${setLayout} aiOption=${aiOption('layout')} />
    <${PickSections} kind="nav" cols=${4} drawn=${proposalsOf(s, 'nav')} presets=${navPresets} value=${nav} onChange=${setNav} aiOption=${aiOption('nav')} />
    <${Section} id="structure-layout-wish" title=${x('structure.wish.title')}>
      <${TextArea} label=${x('structure.wish.label')} hint=${x('structure.wish.hint')} value=${wish} onInput=${setWish} rows=${3} grow />
    <//>
    <${Beside} wide above="section" side=${html`<${Note} kind="aside">${x('structure.fromNode.layout')}<//>`}>
      <${Box} name=${x('structure.learn.title')}>
        <${Note} kind="lead">${x('structure.learn.lead')}<//>
        <${StepList} steps=${[x('structure.learn.q1'), x('structure.learn.q2'), x('structure.learn.q3')]} />
        <${Note}>${x('structure.learn.example')}<//>
      <//>
    <//>
    <${SendBar} s=${s} appRef=${ref} picks=${{ layout, nav }} wish=${wish} onSaved=${onSaved} />`;
}

function LookPick({ s, appRef: ref, onSaved }) {
  const [cat, setCat] = useState(null);
  const [genres, setGenres] = useState([]);
  const [group, setGroup] = useState('all');
  const [look, setLook] = useState(picked(s, 'look'));
  const [genre, setGenre] = useState(s.plan?.choices?.genre?.value || '');
  useEffect(() => {
    readCatalogue().then(setCat).catch((err) => swallowed('structure: catalogue', err));
    readGenres().then(setGenres).catch((err) => swallowed('structure: genres', err));
  }, []);
  if (!cat) return html`<${Note} kind="loading">${x('structure.loading')}<//>`;
  const inGroup = (id) => group === 'all' || (LOOK_GROUPS[group] || []).includes(id);
  const groups = ['all', ...Object.keys(LOOK_GROUPS)].map((g) => ({
    value: g, label: x(`structure.lookGroup.${g}`), count: g === 'all' ? cat.looks.length : cat.looks.filter((l) => LOOK_GROUPS[g].includes(l.id)).length,
  }));
  const options = [
    { value: AI, label: x('structure.aiDecides'), hint: x('structure.aiDecides.look'), pic: html`<${LayoutSketch} rows=${AI_SKETCH} label=${x('structure.aiDecides')} />` },
    ...cat.looks.filter((l) => inGroup(l.id)).map((l) => ({
      value: l.id, label: choiceName('look', l.id), hint: choiceLine('look', l.id, l.feel),
      pic: html`<${LookSample} look=${l.id} title=${s.name} theme=${theme()} label=${choiceName('look', l.id)} />`,
    })),
  ];
  const chosenGenre = genres.find((g) => g.id === genre);
  const picks = genre ? { look, genre } : { look };
  return html`
    <${Section} id="structure-look-looks" title=${x('structure.look.looksTitle', { n: cat.looks.length })} first>
      <${Note} kind="lead">${x('structure.look.looksLead')}<//>
      <${Choice} tone="filter" value=${group} onChange=${setGroup} options=${groups} ariaLabel=${x('structure.look.groups')} />
      <${Choice} boxed cols=${4} value=${look} onChange=${setLook} options=${options} ariaLabel=${x('structure.look.looksTitle', { n: cat.looks.length })} />
    <//>
    <${Section} id="structure-look-genres" title=${x('structure.look.genresTitle', { n: genres.length })}>
      <${Note} kind="lead">${x('structure.look.genresLead')}<//>
      ${genres.length
        ? html`<${Choice} tone="tile" clearable value=${genre} onChange=${setGenre} ariaLabel=${x('structure.look.genresTitle', { n: genres.length })}
            options=${genres.map((g) => ({ value: g.id, label: g.title || g.id, title: g.summary }))} />`
        : html`<${Note} kind="quiet">${x('structure.look.noGenres')}<//>`}
      ${chosenGenre?.preview_url ? html`<${Action} small href=${chosenGenre.preview_url} newTab>${x('structure.look.preview', { name: chosenGenre.title || chosenGenre.id })}<//>` : null}
      <${Note} kind="aside">${x('structure.fromNode.look')}<//>
    <//>
    <${SendBar} s=${s} appRef=${ref} picks=${picks} onSaved=${onSaved} />`;
}

export function StructurePick({ kind, s, appRef: ref, onSaved, onBack }) {
  return html`
    <${BackLink} href=${`/v1/appcat/structure?app=${encodeURIComponent(`${ref.owner}/${ref.filename}`)}`} onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${x('structure.title')}<//>
    <${Band} title=${x(`structure.${kind}.title`)}>
      <${Note} kind="lead">${x(`structure.${kind}.lead`)}<//>
      ${kind === 'layout' ? html`<${LayoutPick} s=${s} appRef=${ref} onSaved=${onSaved} />` : html`<${LookPick} s=${s} appRef=${ref} onSaved=${onSaved} />`}
    <//>`;
}
