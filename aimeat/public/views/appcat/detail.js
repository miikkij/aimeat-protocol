/**
 * @file public/views/appcat/detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's app detail view (features F57–F69, F122–F124): a layer over the whole
 *   window (components/Overlay.js) with the toolbar (close, the app's icon and name, the ✏️ into the
 *   About editor), the body that alone scrolls, and in it the back link, the masthead, the band and
 *   then the sections, each a chapter with its number over its slab ("03 / 19"), beside the
 *   "On this page" rail that lights the section being read (detail-rail.js). Escape closes it when no
 *   dialog and no app viewer is open (F122, F170); closing forgets the open app and any AI proposal.
 *
 *   The sections are files of their own, /views/appcat/sections/<id>.js, each exporting
 *   `meta = { id, title: '<i18n key of its headline>', show: (d) => boolean }` (optional `doors(d)`:
 *   the doors that stand on the slab, as About's Edit) and a default component `({ d })` that draws
 *   the body only. They are loaded by a lazy import in the order of F65 and a section whose file is
 *   not there yet is skipped; one that throws draws nothing and the rest stand (the console says why).
 *
 *   `d`, the context every section receives:
 *   - app (the listing row), manifest (its manifest, {} without), owner (the owner the node's calls
 *     use, F352), rowOwner (the row's own owner), filename, ref ("owner/filename" of the row), me,
 *     isOwn, isOwnPublished, published (a row exists), lang ('en' | 'fi' | 'es'), meta (name,
 *     description, descriptions, icon, tags, category, usesCortex, forkedFrom: the manifest with what
 *     About saved this page session, F316);
 *   - reload() reads the listing again; notice(text, kind); scrollTo(sectionId) brings a section up;
 *     openDialog(name, props); close() closes the detail; html() resolves to the app's bytes as text:
 *     the published bytes, or the saved working copy when there is one (the bytes the old page held);
 *   - version (the newest version number, adopted from the versions list), setVersion(n),
 *     versionsTick (changes after a publish, so the versions list reads again), bumpVersions();
 *   - work: the working-copy state (detail-state.js: hasWork, savedAt, proposal, checkpoints, ckBusy,
 *     ai, b64, bytes), and its acts are imported from /views/appcat/detail-state.js;
 *   - aboutEditing, editAbout(on); launch() (the published app in a new tab), openDraft() (the saved
 *     draft on its real address); shotUrl (the node's screenshot, cache-busted per open);
 *   - legal (the node's legal state of an own published app, null until read) and legalLoaded(data),
 *     which a Legal section calls after its own read or save so the masthead chip follows (F331);
 *   - isFavourite(ref).
 * @structure Detail({ app, onClose }) · SECTION_IDS
 * @usage html`<${Detail} app=${cat.detail} onClose=${closeDetail} />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — The sections' files are named literally (SECTION_LOADERS), so the
 *     catalogue's build follows them.
 *   v1.1.0 — 2026-09-27 — Parity pass: the toolbar's icon, pencil and the back link are Overlay options
 *     (glyph, onEdit, back); the layer reads at the browser's line height (normalLeading) with the
 *     catalogue's small words (smallWords); the rail in the ink tone (light in the dark theme, as
 *     .dtl-rail); d.scrollTo puts a section's top on the body's top (the legal chip's scrollIntoView).
 *   v1.0.0 — 2026-09-27 — The detail view (appcat detail builder A): the old catalogue's #detail-view,
 *     renderDetailView's frame and head, and detail-rail.js on the component library.
 *   v0.1.0 — 2026-09-27 — The contract (the detail's builder fills it in).
 */
import { h } from 'preact';
import { useEffect, useErrorBoundary, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Overlay } from '/components/Overlay.js';
import { Rail } from '/components/Rail.js';
import { Section } from '/components/Section.js';
import { apiGet } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { x, lang } from '/views/appcat/i18n.js';
import { useCatalog, closeDetail, notice, reloadCatalog, appRef } from '/views/appcat/store.js';
import { openDialog, anyDialogOpen } from '/views/appcat/dialogs/host.js';
import { openPublished, appUrl, sameOwner } from '/views/appcat/dialogs/app-io.js';
import { isViewerOpen } from '/views/appcat/viewer.js';
import { b64ToText } from '/views/appcat/workcopy.js';
import { useDetailState, openApp, serverOwner, whenBytes, sessionEdit, setVersion, bumpVersions, setAboutEditing, discardProposal, openStagingPreview } from '/views/appcat/detail-state.js';
import { useDetailRail } from '/views/appcat/detail-rail.js';
import { DetailHead, DetailBand } from '/views/appcat/detail-head.js';

const html = htm.bind(h);

/** The sections in the order of F65. */
export const SECTION_IDS = ['work', 'ai', 'about', 'datamap', 'needs', 'history', 'versions', 'visitors', 'manage',
  'skills', 'search', 'marks', 'legal', 'audit', 'promote', 'odps', 'monetize', 'cost', 'agents', 'actions'];

/**
 * Each section's file, named literally so the catalogue's build (and a reader) can follow it; loaded
 * lazily the first time a detail opens.
 */
const SECTION_LOADERS = {
  work: () => import('/views/appcat/sections/work.js'),
  ai: () => import('/views/appcat/sections/ai.js'),
  about: () => import('/views/appcat/sections/about.js'),
  datamap: () => import('/views/appcat/sections/datamap.js'),
  needs: () => import('/views/appcat/sections/needs.js'),
  history: () => import('/views/appcat/sections/history.js'),
  versions: () => import('/views/appcat/sections/versions.js'),
  visitors: () => import('/views/appcat/sections/visitors.js'),
  manage: () => import('/views/appcat/sections/manage.js'),
  skills: () => import('/views/appcat/sections/skills.js'),
  search: () => import('/views/appcat/sections/search.js'),
  marks: () => import('/views/appcat/sections/marks.js'),
  legal: () => import('/views/appcat/sections/legal.js'),
  audit: () => import('/views/appcat/sections/audit.js'),
  promote: () => import('/views/appcat/sections/promote.js'),
  odps: () => import('/views/appcat/sections/odps.js'),
  monetize: () => import('/views/appcat/sections/monetize.js'),
  cost: () => import('/views/appcat/sections/cost.js'),
  agents: () => import('/views/appcat/sections/agents.js'),
  actions: () => import('/views/appcat/sections/actions.js'),
};

/** id → the section's module, or null once its file was not there. Loaded once per page. */
const modules = {};
let loading = null;
function loadSections() {
  if (!loading) {
    loading = Promise.all(SECTION_IDS.map((id) => SECTION_LOADERS[id]().then(
      (mod) => { modules[id] = mod && mod.meta && mod.default ? mod : null; },
      (err) => { modules[id] = null; console.warn(`[appcat] detail section "${id}" is not there yet`, err); },
    )));
  }
  return loading;
}

const DOM_ID = (id) => 'appcat-sec-' + id;
const two = (n) => (n < 10 ? '0' : '') + n;

/** A section that throws draws nothing; the rest of the detail stands. */
function Guard({ id, children }) {
  const [error] = useErrorBoundary((err) => console.warn(`[appcat] detail section "${id}" failed`, err));
  return error ? null : children;
}

/** Whether a section shows for this app; a `show` that throws counts as no. */
function shows(mod, d) {
  try { return !!mod.meta.show(d); } catch (err) { console.warn(`[appcat] detail section "${mod.meta.id}" show()`, err); return false; }
}

/** The detail view, drawn while an app is open. */
export function Detail({ app, onClose }) {
  const cat = useCatalog();
  const given = app || cat.detail;
  if (!given) return null;
  return html`<${DetailView} given=${given} onClose=${onClose || closeDetail} />`;
}

/** The working-copy state before an app's own has been opened (one render, while openApp runs). */
const BLANK = { ref: '', owner: '', b64: null, bytes: 'loading', hasWork: false, savedAt: null, proposal: null, proposalNote: '',
  checkpoints: null, ckBusy: false, ai: null, aboutEditing: false, versionsTick: 0, shotAt: 0, version: 0 };

function DetailView({ given, onClose }) {
  const cat = useCatalog();
  const state = useDetailState();
  const me = cat.me || getSession()?.owner || null;
  // The row as the listing has it now (a reload after a save brings new words), else the one given.
  const ref = appRef(given);
  const row = (cat.all || []).find((r) => appRef(r) === ref) || given;
  const opened = state.ref === ref;
  const work = opened ? state : BLANK;
  const [, setLoaded] = useState(0);
  const [legal, setLegal] = useState(null);
  const bodyRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { loadSections().then(() => setLoaded((n) => n + 1)); }, []);
  // Opening an app: its bytes, working copy, checkpoints and AI key, and the listing read again (F115).
  // Keyed on the app and the person, not on the row object: a listing read again brings a new row
  // for the same app, and that must not reload its bytes or drop a proposal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { openApp(row, me); }, [ref, me]);
  useEffect(() => { reloadCatalog(); }, [ref]);
  // Closing forgets the app and any AI proposal (F122).
  useEffect(() => () => { discardProposal(); openApp(null, null); }, []);

  const isOwn = sameOwner(row.owner, me);
  const isOwnPublished = !!(isOwn && me && row);
  const owner = opened ? work.owner : serverOwner(row.owner, me);

  // The legal state of an own published app, for the masthead chip (F61, F331).
  const filename = row.filename;
  useEffect(() => {
    setLegal(null);
    if (!isOwnPublished) return undefined;
    let live = true;
    apiGet(appUrl(owner, filename, 'legal'))
      .then((j) => { if (live) setLegal((j && j.data) || null); })
      .catch((err) => { console.warn('[appcat] the legal state could not be read', err); });
    return () => { live = false; };
  }, [owner, filename, isOwnPublished]);

  // Escape closes the detail when nothing above it is open (F122, F170).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || anyDialogOpen() || isViewerOpen()) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const manifest = row.manifest || {};
  const edits = sessionEdit(ref) || {};
  const meta = {
    name: edits.name ?? manifest.name ?? row.filename.replace(/\.html?$/i, ''),
    description: edits.description ?? manifest.description ?? '',
    descriptions: edits.descriptions ?? manifest.descriptions ?? null,
    icon: edits.icon || manifest.icon || '📝',
    tags: edits.tags ?? manifest.tags ?? [],
    category: manifest.category || 'utility',
    usesCortex: manifest.usesCortex || [],
    forkedFrom: manifest.forkedFrom || null,
  };

  const shown = SECTION_IDS.map((id) => modules[id]).filter(Boolean);
  const ids = [];
  const d = {
    app: row, manifest, owner, rowOwner: row.owner, filename: row.filename, ref, me, isOwn, isOwnPublished,
    published: true, lang: lang(), meta,
    reload: () => reloadCatalog(),
    notice: (text, kind) => notice(text, kind),
    // The section's top on the body's top, as the old legal chip's scrollIntoView (F331).
    scrollTo: (id) => scrollRef.current?.(DOM_ID(id), 0),
    openDialog,
    close: onClose,
    html: () => whenBytes().then((b64) => (b64 ? b64ToText(b64) : '')),
    version: opened ? work.version : (row.version_number || 1),
    setVersion, versionsTick: work.versionsTick, bumpVersions,
    work,
    aboutEditing: work.aboutEditing,
    editAbout: (on) => setAboutEditing(on),
    launch: () => openPublished(appUrl(row.owner, row.filename) + '?mode=inline', row),
    openDraft: () => openStagingPreview(owner, row.filename),
    shotUrl: opened && owner && row.filename ? appUrl(owner, row.filename, 'screenshot') + '?t=' + work.shotAt : '',
    legal,
    legalLoaded: (data) => setLegal(data || null),
    isFavourite: (r) => !!(cat.favourites && cat.favourites.has && cat.favourites.has(r)),
  };
  const visible = shown.filter((mod) => shows(mod, d));
  visible.forEach((mod) => ids.push(DOM_ID(mod.meta.id)));
  const rail = useDetailRail(bodyRef, ids, ref);
  scrollRef.current = rail.scrollToId;
  const total = two(visible.length);

  const railNode = html`<${Rail} tone="ink" title=${x('detail.railTitle')} groups=${[{
    label: x('detail.railTitle'),
    items: visible.map((mod, i) => ({ key: mod.meta.id, mark: two(i + 1), label: x(mod.meta.title), on: rail.current === i, onClick: () => rail.goTo(i) })),
  }]} />`;

  // The toolbar (F57, F124): the icon, the name, and the pencil into the About editor while it is shut.
  return html`<${Overlay} normalLeading smallWords label=${meta.name} glyph=${meta.icon} title=${meta.name}
      onEdit=${work.aboutEditing ? null : () => setAboutEditing(true)} editLabel=${x('detail.editDetails')}
      back=${{ label: '← ' + x('view.library'), onClick: onClose }} onClose=${onClose}
      closeLabel=${x('common.close')} rail=${railNode} bodyRef=${bodyRef}>
    <${DetailHead} d=${d} />
    <${DetailBand} d=${d} />
    ${visible.map((mod, i) => {
      const Body = mod.default;
      const doors = typeof mod.meta.doors === 'function' ? mod.meta.doors(d) : null;
      return html`<${Section} key=${ref + ':' + mod.meta.id} id=${DOM_ID(mod.meta.id)} first=${i === 0}
          chapter=${two(i + 1) + ' / ' + total} title=${x(mod.meta.title)} doors=${doors}>
        <${Guard} id=${mod.meta.id}><${Body} d=${d} /><//>
      <//>`;
    })}
  <//>`;
}

export default Detail;
