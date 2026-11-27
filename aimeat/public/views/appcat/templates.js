/**
 * @file public/views/appcat/templates.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalogue's view "My templates" (?view=templates, signed-in only): the person's own
 *   app templates, the memory records under `template.catalog.<id>.manifest` that GET
 *   /v1/appdev/templates lists. The page head with the copy action that asks the person's own AI to
 *   make a template from an app, the page's first-use guidance (PageStart `appcat-templates`), and one
 *   numbered row per template. An opened row shows what the template's `recipe` holds (look, frame,
 *   screens, moments, data, checks) in the reader's words (the look by its Design Book title, a
 *   moment by the name the app structure page gives it), or its description and reuse notes when it
 *   has no recipe; the copy action that starts a new app from it, the copy action that asks the
 *   person's own AI to change it, and Remove, which asks first and then calls DELETE
 *   /v1/appdev/templates/:id. The list is read again on the `memory` live event.
 *
 *   Writes no class; the parts are components.
 * @structure useTemplates(signedIn) → { rows, loaded, failed, reload } · useLookNames(rows) ·
 *   momentWords(recipe) · TemplatesView({ data })
 * @usage const tpl = useTemplates(!!cat.me); html`<${TemplatesView} data=${tpl} />`
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-omistaja-tekee-omia-sovelluspohjia-ja-aloittaa-seuraavan-app).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { PageHead } from '/components/PageHead.js';
import { PageStart } from '/components/PageStart.js';
import { PageSection } from '/components/PageSection.js';
import { List, Row, Name, Desc, Num, Cell, Lead, Panel } from '/components/List.js';
import { Loud, Action, Actions } from '/components/Action.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { EmptyState } from '/components/EmptyState.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { apiGet } from '/js/api.js';
import { tOr } from '/js/i18n.js';
import { getTemplateProposals, deleteTemplateProposal } from '/js/services/appdev.js';
import { swallowed } from '/js/swallowed.js';
import { x, xn } from '/views/appcat/i18n.js';
import { findApp, notice } from '/views/appcat/store.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { appIcon, appName, fmtDate } from '/views/appcat/model.js';
import { momentName } from '/views/appcat/structure-data.js';

const html = htm.bind(h);
/** The catalogue's own cut, so the rows read as the app lists do (lists.js CUT). */
const CUT = 'n-mark-name-desc-state-n-arrow';
/** The frames a recipe names (models/template-recipe.ts); each has its words under appcat.templates.frame. */
const FRAMES = new Set(['pages', 'tool', 'stage', 'reading', 'game', 'story']);

const newestFirst = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));

/**
 * The person's templates: read on sign-in and again on every `memory` live event (the templates are
 * memory records). The shell calls it once, so the rail's count and the view share one read.
 * @param {boolean} signedIn
 * @returns {{ rows: any[], loaded: boolean, failed: boolean, reload: () => void }}
 */
export function useTemplates(signedIn) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    if (!signedIn) { setRows([]); setLoaded(false); setFailed(false); return; }
    getTemplateProposals()
      .then((d) => { setRows((d.templates || []).filter(Boolean).slice().sort(newestFirst)); setFailed(false); setLoaded(true); })
      .catch((err) => { swallowed('appcat: templates', err); setFailed(true); setLoaded(true); });
  }, [signedIn]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => (signedIn ? onLiveUpdate(['memory'], reload) : undefined), [signedIn, reload]);
  return { rows, loaded, failed, reload };
}

/**
 * The titles of the Design Book's style kits and genres, by id, so a recipe's look reads as a name
 * ("Mappi") instead of an id ("kit-mappi"). Read once, and only when a template names a look or a
 * genre; an id the Design Book does not answer for keeps its id.
 * @param {any[]} rows
 * @returns {Record<string, string>}
 */
function useLookNames(rows) {
  const [names, setNames] = useState({});
  const wanted = rows.some((p) => p && p.recipe && (p.recipe.look || p.recipe.genre));
  useEffect(() => {
    if (!wanted) return undefined;
    let alive = true;
    // The style kits the person can read are Design Book parts; the genres are the node's served
    // app templates. Either list failing leaves the other's names in place.
    const read = (path, pick) => apiGet(path).then(pick).catch((err) => { swallowed('appcat: template look names', err); return []; });
    Promise.all([
      read('/v1/designbook?kind=kit&limit=100', (a) => a?.data?.parts || []),
      read('/v1/app-templates', (a) => (a?.data?.templates || []).filter((tpl) => tpl?.kind === 'genre')),
    ])
      .then((lists) => {
        if (!alive) return;
        const out = {};
        for (const part of lists.flat()) if (part?.id && part.title) out[part.id] = part.title;
        setNames(out);
      })
      .catch((err) => swallowed('appcat: template look names', err));
    return () => { alive = false; };
  }, [wanted]);
  return names;
}

/**
 * A recipe's needs and moments in the reader's words, each said once: a need and the moment that
 * answers it ("session" and "ask:signIn") share one name.
 */
function momentWords(r) {
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const needs = list(r.needs).map((n) => tOr('appcat.templates.need.' + String(n).split(':')[0], n));
  return [...new Set([...needs, ...list(r.moments).map(momentName)])].join(', ');
}

/** The recipe's parts as Facts rows: a row only for a part the recipe has. */
function recipeRows(r, names) {
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const look = [r.look, r.genre].filter(Boolean).map((id) => names[id] || id).join(' · ');
  const screens = list(r.screens).map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean).join(', ');
  const moments = momentWords(r);
  const data = list(r.data);
  const checks = list(r.criteria).length;
  return [
    look && { k: x('templates.look'), v: look },
    r.frame && { k: x('templates.frameLabel'), v: FRAMES.has(r.frame) ? x('templates.frame.' + r.frame) : r.frame },
    screens && { k: x('templates.screens'), v: screens },
    moments && { k: x('templates.moments'), v: moments },
    data.length && { k: x('templates.data'), v: data.map((d, i) => html`<${FactLine} key=${i}>${typeof d === 'string' ? d : [d.what, d.where].filter(Boolean).join(', ')}<//>`) },
    checks && { k: x('templates.checks'), v: xn('templates.checksN', checks, { n: checks }) },
  ];
}

/** Ask first, then remove the template and read the list again. */
async function removeTemplate(p, reload) {
  if (!(await confirmAsk(x('templates.removeConfirm', { title: p.title || p.id }), { danger: true }))) return;
  try {
    await deleteTemplateProposal(p.id);
    notice(x('templates.removed'));
  } catch (err) {
    notice(x('templates.removeFailed', { msg: (err && err.message) || String(err) }), 'error');
  }
  reload();
}

/**
 * One template's row: the number, the source app's icon, the title, the app it was made from, the
 * date and the arrow; opened, its description, its parts, its actions and the note.
 * @param {{ p: any, i: number, open: boolean, onToggle: () => void, reload: () => void, names: Record<string, string> }} props
 */
function TemplateRow({ p, i, open, onToggle, reload, names }) {
  const src = p.derivedFrom || {};
  const app = src.owner && src.filename ? findApp(src.owner, src.filename) : null;
  const from = app ? appName(app) : (src.filename || '');
  const recipe = p.recipe && typeof p.recipe === 'object' ? p.recipe : null;
  const facts = recipe ? recipeRows(recipe, names) : [p.reuseNotes && { k: x('templates.reuse'), v: p.reuseNotes, pre: true }];
  const title = p.title || p.id;
  return html`<${Row} order=${i} open=${open} onToggle=${onToggle}>
    <${Cell} sign>${String(i + 1).padStart(2, '0')}<//>
    <${Lead} text=${app ? appIcon(app) : undefined} />
    <${Name}>${title}<//>
    <${Desc} clip>${from ? x('templates.made', { app: from }) : ''}<//>
    <${Cell}>${fmtDate(p.createdAt)}<//>
    <${Num}><//>
    <${Cell}>${open ? '↓' : '→'}<//>
    ${open ? html`<${Panel} text=${p.description || undefined}>
      ${facts.some(Boolean) ? html`<${Facts} wide flush rows=${facts} />` : null}
      <${Actions}>
        <${Loud} copy=${x('templates.startPrompt', { title })} copiedLabel=${x('templates.copied')}>${x('templates.start')}<//>
        <${Action} copy=${x('templates.changePrompt', { title })} copiedLabel=${x('templates.copied')}>${x('templates.change')}<//>
        <${Action} onClick=${() => removeTemplate(p, reload)}>${x('templates.remove')}<//>
      <//>
      <${Note} kind="hint">${x('templates.note')}<//>
    <//>` : null}
  <//>`;
}

/**
 * The view: the head, the first-use guidance and the list. `data` is useTemplates()'s answer.
 * @param {{ data: { rows: any[], loaded: boolean, failed: boolean, reload: () => void } }} props
 */
export function TemplatesView({ data }) {
  const { rows, loaded, failed, reload } = data;
  // One row open at a time: pressing it again closes it, pressing another moves the panel, and a row
  // that left the list (removed here or elsewhere) is not left open.
  const [openId, setOpenId] = useState(null);
  useEffect(() => { if (openId && !rows.some((p) => p.id === openId)) setOpenId(null); }, [rows, openId]);
  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id));
  const names = useLookNames(rows);

  const n = rows.length;
  const makePrompt = x('templates.makePrompt');
  let body;
  if (!loaded) body = html`<${EmptyState} start loading title=${x('templates.loading')} />`;
  else if (failed && !n) body = html`<${EmptyState} start title=${x('templates.failed')} />`;
  else if (!n) body = html`<${EmptyState} start title=${x('templates.emptyTitle')} text=${x('templates.emptyText')} />`;
  else {
    body = html`<${List} cols=${CUT} index>
      ${rows.map((p, i) => html`<${TemplateRow} key=${p.id} p=${p} i=${i} open=${openId === p.id} onToggle=${() => toggle(p.id)} reload=${reload} names=${names} />`)}
    <//>`;
  }
  return html`
    <${PageHead} low label=${x('header.title')} title=${x('templates.title')} help="concept.appTemplate"
      sub=${loaded ? xn('templates.sub', n, { n }) : ''} desc=${x('templates.desc')}
      actions=${html`<${Loud} mark="+" title=${x('templates.make')} copy=${makePrompt} copiedLabel=${x('templates.copied')}>${x('templates.make')}<//>`} />
    <${PageStart} id="appcat-templates" title=${x('templates.title')} />
    <${PageSection} list plain>${body}<//>`;
}

export default TemplatesView;
