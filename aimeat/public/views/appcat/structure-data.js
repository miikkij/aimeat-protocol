/**
 * @file public/views/appcat/structure-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the app structure page reads and writes, and the words it says about each step.
 *   The structure and the plan are the node's (GET and PUT /v1/apps/:owner/:filename/structure,
 *   services/app-structure.ts); the layouts, navigation modes and looks are the node's catalogue
 *   (GET /v1/apps/ui/catalogue), and the genres are the Design Book's (GET /v1/designbook?kind=genre),
 *   so a layout, a look or a genre added to the node shows here with no change. A thing the locale
 *   files have no words for yet shows the node's own English sentence.
 * @structure readStructure · writePlan · readCatalogue · readGenres · stepLine(step, words) ·
 *   choiceName(kind, id) · proposalsOf(structure, kind) · optionName(structure, kind, id) ·
 *   aiPrompt(structure, picks, wish) · appRefFromAddress()
 * @usage const s = await readStructure('alice', 'talkoot.html');
 * @version-history
 *   v1.2.0 — 2026-10-30 — The layouts the AI drew (proposalsOf, optionName), and a person's change to a choice.
 *   v1.1.0 — 2026-10-29 — A `custom` layout or nav reads as its name and the AI's note.
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { apiGet, apiPut } from '/js/api.js';
import { tOr } from '/js/i18n.js';
import { x } from '/views/appcat/i18n.js';

const path = (owner, filename) => `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/structure`;

/** The app the address names (?app=<owner>/<filename>), or null. */
export function appRefFromAddress() {
  const raw = new URLSearchParams(location.search).get('app') || '';
  const slash = raw.indexOf('/');
  if (slash < 1 || slash === raw.length - 1) return null;
  return { owner: raw.slice(0, slash), filename: raw.slice(slash + 1) };
}

export async function readStructure(owner, filename) {
  const r = await apiGet(path(owner, filename));
  return r?.data ?? null;
}

/** Write part of the plan; answers the structure as it now stands. */
export async function writePlan(owner, filename, patch) {
  const r = await apiPut(path(owner, filename), patch);
  return r?.data ?? null;
}

let catalogue = null;
/** The layouts, navigation modes and looks the node offers. Read once per page load. */
export async function readCatalogue() {
  if (catalogue) return catalogue;
  const r = await apiGet('/v1/apps/ui/catalogue');
  const c = r?.data?.catalogue ?? {};
  catalogue = {
    layouts: Array.isArray(c.layouts) ? c.layouts : [],
    navModes: Array.isArray(c.nav_modes) ? c.nav_modes : [],
    looks: Array.isArray(c.look_sheets) ? c.look_sheets : (c.looks || []).map((id) => ({ id, feel: '' })),
  };
  return catalogue;
}

/** The Design Book's genres: a start an app can fork. */
export async function readGenres() {
  const r = await apiGet('/v1/designbook?kind=genre&limit=100');
  return Array.isArray(r?.data?.parts) ? r.data.parts : [];
}

/**
 * The name of a layout, a navigation mode, a look or a listing in the reader's language; a layout
 * or a look the locale has no word for keeps its id, which is its name on the node.
 */
export function choiceName(kind, id) {
  if (!id) return '';
  return tOr(`appcat.structure.${kind}.${id}.name`, id);
}

/** The options the building AI drew for this app's layout or nav (plan.proposals), or none. */
export function proposalsOf(structure, kind) {
  const list = structure?.plan?.proposals?.[kind];
  return Array.isArray(list) ? list : [];
}

/** The name of a choice's value: an option the AI drew is named by the AI, anything else as choiceName. */
export function optionName(structure, kind, id) {
  return proposalsOf(structure, kind).find((p) => p.id === id)?.name || choiceName(kind, id);
}

/** One line on what a layout, a navigation mode or a look is for, or the node's own sentence. */
export function choiceLine(kind, id, fallback) {
  return tOr(`appcat.structure.${kind}.${id}.line`, fallback || '');
}

const by = (c) => (c?.by === 'ai' ? x('structure.byAi') : x('structure.byYou'));

/** The line under a step's name: where it stands now, in the reader's words. */
export function stepLine(step) {
  const d = step.detail || {};
  switch (step.id) {
    case 'purpose':
      return step.state === 'fine' ? (d.text || x('structure.line.purposeSpec')) : x('structure.line.purposeMissing');
    case 'data':
      if (d.source === 'map') return x('structure.line.dataMap', { rows: d.rows, personal: d.personal });
      if (d.source === 'plan') return d.summary;
      return x('structure.line.dataMissing');
    case 'layout':
    case 'look': {
      const [a, b] = step.id === 'layout' ? [d.layout, d.nav] : [d.look, d.genre];
      const ka = step.id === 'layout' ? 'layout' : 'look';
      const kb = step.id === 'layout' ? 'nav' : 'genre';
      if (!a && !b) return x('structure.line.choiceNone');
      // A custom layout or nav is described only by its note; an option the AI drew carries its
      // name; a person's note on any other choice is what they want changed. A closing full stop
      // goes, because the line around it ends with one.
      const bare = (note) => note.replace(/[.!?]\s*$/, '');
      const named = (k, c) => {
        if (!c) return '';
        if (c.value === 'custom' && c.note) return `${choiceName(k, c.value)}: ${bare(c.note)}`;
        const name = c.name || choiceName(k, c.value);
        return c.by === 'owner' && c.note ? `${name} (${x('structure.line.wish', { note: bare(c.note) })})` : name;
      };
      const names = [named(ka, a), named(kb, b)].filter(Boolean).join(' · ');
      const waiting = [a, b].some((c) => c && c.state === 'waiting');
      return waiting ? x('structure.line.choiceWaiting', { names }) : x('structure.line.choiceDone', { names, by: by(a || b) });
    }
    case 'build':
      if (d.version) return d.draft ? x('structure.line.buildLiveDraft', { version: d.version }) : x('structure.line.buildLive', { version: d.version });
      if (d.now?.text) return d.now.text;
      return d.draft ? x('structure.line.buildDraft') : x('structure.line.buildNone');
    case 'builders':
      return d.count ? x('structure.line.builders', { count: d.count }) : x('structure.line.buildersNone');
    case 'visibility':
      if (d.listing) return x('structure.line.visibilityLive', { listing: choiceName('visibility', d.listing) });
      if (d.intended) return x('structure.line.visibilityIntended', { listing: choiceName('visibility', d.intended) });
      return x('structure.line.visibilityMissing');
    case 'requirements':
      if (step.state === 'missing') {
        const parts = [];
        if (d.legalMissing?.length) parts.push(x('structure.line.legalMissing', { pages: d.legalMissing.map((k) => tOr(`appcat.structure.legal.${k}`, k)).join(', ') }));
        if (d.aiUnanswered) parts.push(x('structure.line.aiUnanswered', { n: d.aiUnanswered }));
        return parts.join(' ');
      }
      if (step.state === 'fine') return x('structure.line.requirementsFine');
      return d.personal ? x('structure.line.requirementsPersonal') : x('structure.line.requirementsLater');
    default:
      return step.said || '';
  }
}

/**
 * The prompt for an AI that cannot reach the node: the choices, said in plain words, for the person
 * to paste into their own chat. A connected AI reads the plan itself and needs none of this.
 */
export function aiPrompt(structure, picks, wish) {
  const lines = [x('structure.prompt.head', { name: structure.name })];
  for (const [kind, id] of Object.entries(picks)) {
    if (!id) continue;
    lines.push(`- ${x(`structure.prompt.${kind}`)}: ${optionName(structure, kind, id)} (${id})`);
  }
  if (wish) lines.push(`- ${x('structure.prompt.wish')}: ${wish}`);
  lines.push(x('structure.prompt.tail'));
  return lines.join('\n');
}
