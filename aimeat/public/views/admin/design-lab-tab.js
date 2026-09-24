/**
 * @file public/views/admin/design-lab-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat-design-lab, the library view: every part of the node's own interface drawn
 *   live by its real component with its catalogue example, so a person judges pictures rather than
 *   names. The overview shows each part once; a part opened shows every variant and state in light
 *   and dark side by side, at a phone width, and beside them its name, what it is for, the data it
 *   takes, its use, the theme tokens it reads, the pages that draw it and its history.
 *
 *   Jouni: "I cannot judge 71 component names without seeing them. Every decision I make needs
 *   pictures." Built only from library components (the Specimen frame is one of them).
 * @structure DesignLabTab (default: the library / decisions switch) · Library · Overview · PartDetail
 * @usage Mounted by the admin dashboard tab router (views/admin.js), group Design.
 * @version-history
 *   v1.3.0 — 2026-09-24 — The preview wears any theme and style of this server, offered or not (R16):
 *     a theme and style picker above the library, passed to every frame as `look=` and `style=`.
 *   v1.2.0 — 2026-09-23 — The agent step's wrapper is a decision in the decisions view, not a panel
 *     under the Unused filter: the filter's count and its content agree.
 *   v1.1.0 — 2026-09-23 — The decisions view beside the library (views/admin/design-lab-decisions.js).
 *   v1.0.0 — 2026-09-23 — Initial: the library view (UI consolidation phase 2).
 */
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { PageIntro } from '/components/PageIntro.js';
import { Hint } from '/components/Hint.js';
import { TextInput } from '/components/TextInput.js';
import { ModeSwitch } from '/components/ModeSwitch.js';
import { FoldButton } from '/components/FoldButton.js';
import { BackLink } from '/components/BackLink.js';
import { QuietNote } from '/components/QuietNote.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { Choice } from './themes-bits.js';
import { DEMOS } from '/views/design-lab/demos.js';
import DecisionsView from './design-lab-decisions.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** A part's frame, in the theme and style the lab's picker chose (none: the page's own look). */
const frameSrc = (id, v, theme, look) => `/v1/design-lab/frame?id=${encodeURIComponent(id)}&v=${v}&theme=${theme}`
  + (look?.theme ? `&look=${encodeURIComponent(look.theme)}&style=${encodeURIComponent(look.style || '')}` : '');

/**
 * Every theme and every style of this server, offered to people or not (R16): the frames below wear
 * the one chosen. The AIMEAT theme in its AIMEAT style is the lab as it always looked.
 */
function LookPicker({ look, onChange }) {
  const [themes, setThemes] = useState(/** @type {any[]} */ ([]));
  useEffect(() => { apiGet('/v1/themes/all?summary=1').then((r) => setThemes(r.data.themes)).catch((e) => { swallowed('design-lab: themes', e); setThemes([]); }); }, []);
  const theme = themes.find((th) => th.id === look.theme) || themes[0];
  if (!theme) return null;
  return html`
    <${Choice} label=${t('designLab.lookTheme')} hint=${t('designLab.lookThemeHint')} value=${theme.id}
      choices=${themes.map((th) => ({ value: th.id, label: th.name }))}
      onChoose=${(id) => { const th = themes.find((x) => x.id === id); onChange({ theme: id, style: th?.defaultStyle }); }} />
    <${Choice} label=${t('designLab.lookStyle')} hint=${t('designLab.lookStyleHint')} value=${look.style || theme.defaultStyle}
      choices=${theme.styles.map((s) => ({ value: s.id, label: s.name }))}
      onChoose=${(id) => onChange({ theme: theme.id, style: id })} />`;
}

/** Which rows a filter keeps. */
const FILTERS = {
  all: () => true,
  component: (e) => e.kind === 'component' && e.status === 'active',
  shape: (e) => e.kind === 'shape',
  unused: (e) => e.status === 'unused',
};

/** "StepCard" read as "Step card": the caption is set in capitals, where a joined name blurs. */
const spaced = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

/** A page file as a person names it. */
function pageName(p) {
  const known = { 'views/home/index.js': 'home', 'views/home/history.js': 'history', 'views/landing.js': 'front page', 'views/chat.js': 'chat', 'views/profile.js': 'profile', 'views/admin.js': 'admin' };
  return known[p] ?? p.replace(/^views\//, '').replace(/\.js$/, '');
}

function Overview({ entries, onOpen, look }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = entries.filter(FILTERS[filter]).filter((e) => {
    const hay = `${e.id} ${e.name} ${e.summary}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const count = (f) => entries.filter(FILTERS[f]).length;
  return html`
    ${/* The admin page prints the tab's name as its title; the intro is the line under it. */''}
    <${Hint}>${tr('designLab.intro', 'Every part of this AIMEAT\'s own interface, drawn live by its real component with its example data. Open a part to see every variant in light and dark, at a phone width, and what it is for.')}<//>
    <${ModeSwitch} label=${tr('designLab.filterLabel', 'Which parts')}>
      ${Object.keys(FILTERS).map((f) => html`
        <${FoldButton} key=${f} on=${filter === f} onClick=${() => setFilter(f)}>
          ${tr('designLab.filter.' + f, { all: 'All', component: 'Components', shape: 'Shapes', unused: 'Unused' }[f])} (${count(f)})
        <//>`)}
    <//>
    <${TextInput} id="design-lab-find" maxLength="80" placeholder=${tr('designLab.find', 'Find a part')} value=${q}
      onInput=${(e) => setQ(e.target.value)} />
    ${shown.length === 0
      ? html`<${QuietNote}>${tr('designLab.none', 'No part matches.')}<//>`
      : html`
        <${Specimens}>
          ${shown.map((e) => html`
            <${Specimen} key=${e.id}
              label=${html`<button type="button" class="poster-action" onClick=${() => onOpen(e.id)}>${spaced(e.name)}${e.status === 'unused' ? ' · ' + tr('designLab.unused', 'unused') : ''}</button>`}
              src=${frameSrc(e.id, 0, 'light', look)}
              note=${e.summary} />`)}
        <//>`}`;
}

function PartDetail({ id, onBack, look }) {
  const [entry, setEntry] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    apiGet(`/v1/ui/components/${encodeURIComponent(id)}`)
      .then((r) => { if (alive) setEntry(r.data); })
      .catch((e) => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
  }, [id]);
  const variants = DEMOS[id]?.variants ?? [];

  if (error) return html`<${ErrorNote} text=${error} />`;
  if (!entry) return html`<${QuietNote}>…<//>`;
  return html`
    <${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${tr('designLab.back', 'All parts')}<//>
    <${PageIntro} title=${spaced(entry.name)} sub=${entry.summary} />
    ${entry.note && html`<${BandNote}>${entry.note}<//>`}

    ${variants.map((v, i) => html`
      <${Band} key=${i} title=${v.name} tight=${true}>
        <${Specimens}>
          <${Specimen} label=${tr('designLab.light', 'Light')} src=${frameSrc(id, i, 'light', look)} />
          <${Specimen} label=${tr('designLab.dark', 'Dark')} src=${frameSrc(id, i, 'dark', look)} />
        <//>
      <//>`)}

    <${Band} title=${tr('designLab.phone', 'On a phone')} tight=${true}>
      <${Specimens}>
        <${Specimen} phone=${true} label=${(variants[0]?.name ?? '') + ' · ' + tr('designLab.light', 'Light')} src=${frameSrc(id, 0, 'light', look)} />
        <${Specimen} phone=${true} label=${(variants[0]?.name ?? '') + ' · ' + tr('designLab.dark', 'Dark')} src=${frameSrc(id, 0, 'dark', look)} />
      <//>
    <//>

    <${Band} title=${tr('designLab.facts', 'What it is')} tight=${true}>
      <${NamedRow} label=${tr('designLab.use', 'Use')}>${entry.use.join(' · ')}. ${(entry.useFor ?? []).join(' ')}<//>
      <${NamedRow} label=${tr('designLab.data', 'Data')}><code>${entry.data.shape}</code><//>
      ${Object.entries(entry.data.fields).map(([k, v]) => html`<${NamedRow} key=${k} label=${k}>${v}<//>`)}
      ${entry.variants.length > 0 && html`
        <${NamedRow} label=${tr('designLab.variants', 'Variants')}>
          ${entry.variants.map((v) => `${v.name}${v.class ? ` (${v.class})` : v.prop ? ` (${v.prop})` : ''}: ${v.when}`).join(' · ')}
        <//>`}
      <${NamedRow} label=${tr('designLab.pages', 'Pages')}>${entry.pages.length ? entry.pages.map(pageName).join(', ') : tr('designLab.noPages', 'no page draws it')}<//>
      <${NamedRow} label=${tr('designLab.tokens', 'Theme tokens')}><code>${entry.tokens.join(' ')}</code><//>
      <${NamedRow} label=${tr('designLab.code', 'Code')}><code>${[entry.module, entry.sheet].filter(Boolean).join(' · ')}</code><//>
    <//>`;
}

function Library() {
  const [entries, setEntries] = useState(/** @type {any[]|null} */ (null));
  const [error, setError] = useState('');
  const [open, setOpen] = useState(/** @type {string|null} */ (null));
  const [look, setLook] = useState({ theme: 'aimeat', style: 'aimeat' });

  useEffect(() => {
    apiGet('/v1/ui/components')
      .then((r) => setEntries(r.data.components))
      .catch((e) => setError(e.message || String(e)));
  }, []);

  const sorted = useMemo(() => entries ?? [], [entries]);
  if (error) return html`<${ErrorNote} text=${error} />`;
  if (!entries) return html`<${QuietNote}>…<//>`;
  return html`
    <${LookPicker} look=${look} onChange=${setLook} />
    ${open
      ? html`<${PartDetail} key=${look.theme + look.style} id=${open} onBack=${() => setOpen(null)} look=${look} />`
      : html`<${Overview} key=${look.theme + look.style} entries=${sorted} onOpen=${setOpen} look=${look} />`}`;
}

export default function DesignLabTab() {
  const [mode, setMode] = useState('library');
  return html`
    <${ModeSwitch} label=${tr('designLab.modeLabel', 'What the lab shows')}>
      <${FoldButton} on=${mode === 'library'} onClick=${() => setMode('library')}>${tr('designLab.modeLibrary', 'The library')}<//>
      <${FoldButton} on=${mode === 'decisions'} onClick=${() => setMode('decisions')}>${tr('designLab.modeDecisions', 'The decisions')}<//>
    <//>
    ${mode === 'library' ? html`<${Library} />` : html`<${DecisionsView} />`}`;
}
