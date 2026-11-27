/**
 * @file public/views/profile/exposure-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings "What others can see": everything of the person's that someone outside can
 *   read, and how to close each (plan doc-mvcn6c7e4e5q, V6.2). The screen half of GET
 *   /v1/exposure/mine; the person's AI reads the same report with aimeat_exposure_report, so the page
 *   and the chat answer with one list.
 *
 *   HOW IT EXPLAINS ITSELF (.claude/rules/page-guidance.md): the title's question mark is
 *   concept.audience (who can read a thing, level by level, and when to give a permission instead),
 *   and the page's start (PageStart) says what the page is for, gives the prompt that has one's own
 *   AI read the same report, and says what happens next.
 *
 *   THE COUNTS FIRST, then the things. The strip counts by level, widest first (open to everyone,
 *   anyone with the link, every account signed in here, the members of one organism); the list under
 *   it is the report's own order, widest first. Each row says what the thing is, where it is (its
 *   address, when a stranger can open it), who can read it (AudienceBadge) and how to close it.
 *
 *   HOW TO CLOSE, on this page. Where the person can close a thing with one press, the row offers it
 *   (a record, a file, a board, a skill or a package made private; a workspace page no longer shared)
 *   and asks first in the site's own confirm dialog (components/Modal.js useConfirm). Where the control lives on another page, the row opens that page. Every row can
 *   also copy how to close it for the person's AI, which names the tool and the route, said in the
 *   page's language from the report's `close` (exposure/words.js; the English `how_to_close` stays the
 *   fallback).
 *
 *   HONEST ABOUT ITS EDGES. A kind the report could not read (`failed`) is named, and its count is
 *   missing rather than zero; a kind cut at the list's cap (`capped`) is named, with its count whole;
 *   what the person's classification hides from this view (`hidden_by_classification`) is counted;
 *   and the report's `notes` say what it does not count, said in the page's language from `note_codes`.
 *
 *   Live data by the `aimeat-live-update` event: the report is read again when something it lists
 *   changes, never on a timer.
 *
 *   CONFLICTS FIRST (plan doc-mvdipuyqraas, L4.2, L4.3). Where classification is on, the report gives
 *   each item its classification, and the page draws it on the ClassificationBadge beside the
 *   AudienceBadge. An item open to more people than its classification allows is a conflict: the
 *   section Conflicts comes first, and each of its rows offers "Lower the level", which sets the
 *   item to the widest level its classification allows (`lower_to`) through the route that changes
 *   that item, after the site's confirm dialog. There is no "Raise the classification": a conflict
 *   is a level too wide for its classification, and a higher classification allows fewer people, so
 *   raising it would widen the gap. Where the item is lowered on another page (an app that needs an
 *   access code), the row opens that page.
 * @structure LEVELS · KINDS · closeOf(item) · lowerOf(item) · placeOf(item) · ExposureTab (default)
 * @usage Registered in views/profile.js as the `exposure` tab; menu entry in landing-page.cards.js (Account).
 * @version-history
 *   v1.9.1 — 2026-11-28 — The text for the person's AI copies under common.copyForAi ("Copy the prompt
 *     for your AI"), the one name of a prompt copy.
 *   v1.9.0 — 2026-11-27 — Usability round 3. The open things are grouped by kind, each kind one closed
 *     row that says how many and at which levels. A record, a file or a knowledge item the report names
 *     by its key is named by the key's last part in words, the key under it (nameOf); an address is
 *     shown decoded (readableAddress: sandbox%40node read as an escape). The title is the menu's and
 *     the crumb's name for the page; the close action's words say what it does (exposure.closeIt).
 *   v1.8.0 — 2026-11-27 — Usability pass. With nothing open at any level the strip is not drawn
 *     (hideZeros, except while a place could not be read). Conflicts are drawn only when there is a
 *     conflict or an exception to say. The Data row is drawn once something is shared as data or the
 *     report counts a data item, and stands before the list when the list is empty, whose line then
 *     says that the rest is under Data: an empty list said "everything is private" while a public data
 *     package was counted. "What this list does not count" is an open section named "Limits of this
 *     list": it was a fold with no way to open it, and a limit of a safety list is a safety fact. The
 *     list's heading is a noun phrase. A failed read, close or lowering is said in the page's words.
 *     Numbered after the filter.
 *   v1.7.0 — 2026-11-08 — The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart under the head and the title's question mark, concept.audience. The head's second
 *     sentence about one's own AI and the hint under the list with the question to ask it go: the
 *     start's prompt says it, and the head keeps two sentences.
 *   v1.6.0 — 2026-11-02 — The data packages, the named shares and the outside parties are ONE Data row with
 *     the counts and a way to "Data you share" (exposure/named.js secData; WP11, board Mita-muut-nakevat);
 *     the strip counts the four levels. The report itself keeps every item.
 *   v1.5.1 — 2026-11-01 — The heading and the sentence about asking one's own AI as on the board (WP10e B16).
 *   v1.5.0 — 2026-11-01 — How to close an item, a title the node words and the notes in the page's
 *     language, from the report's `close`, `title_parts` and `note_codes` (exposure/words.js; WP9c).
 *   v1.4.0 — 2026-11-01 — LEVELS gains `named`, outside the widest-first order a cap reads; the strip
 *     counts the named shares and the outside parties; sections for the named shares ("End share"),
 *     the outside parties ("Manage" in the Data Wallet) and every data package at its own level
 *     ("Change" on the Offers page), and the list of everything else leaves those three kinds out
 *     (exposure/named.js; WP9a, design canvas "Data ulos", board Mita-muut-nakevat).
 *   v1.3.0 — 2026-10-18 — Each item's classification beside who can read it, and the conflicts first with
 *     "Lower the level" (plan doc-mvdipuyqraas, L4.2, L4.3).
 *   v1.2.0 — 2026-10-18 — The figures are the stacked strip (number, word and line on shared rows), and
 *     "Copy for your AI" says so in the site's toast.
 *   v1.1.0 — 2026-10-18 — From the browser check of 1c0b57fba: the list is the cut item-kind-state-doors
 *     (the name keeps 12rem, the doors wrap, a card under 1180px with 40px doors), "Close it" asks in
 *     the site's confirm dialog instead of window.confirm, and the way to another page reads as a verb.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.2).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { setWorkspaceShare, updateOrganism } from '/js/services/organisms.js';
import { exposureAudienceOf } from '/js/audience.js';
import { labelName } from '/js/services/classification.js';
import { ClassificationBadge } from '/components/ClassificationBadge.js';
import { Marks } from '/components/Mark.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { FoldSection } from '/components/FoldSection.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { AudienceBadge } from '/components/AudienceBadge.js';
import { openTab } from '/components/Rail.js';
import { useConfirm } from '/components/Modal.js';
import { PageStart } from '/components/PageStart.js';
import * as dp from '/js/services/dataproducts.js';
import { secData, dataShown, NAMED_KINDS } from './exposure/named.js';
import { closeText, titleOf, noteTexts } from './exposure/words.js';

const html = htm.bind(h);
const x = (key, vars) => t(`exposure.${key}`, vars);
const enc = encodeURIComponent;
/** A storage key as a path: each segment encoded, the slashes kept. */
const keyPath = (key) => String(key).split('/').map(enc).join('/');

/** The report's levels (services/exposure/exposure-types.ts LEVELS): the four widest first, then `named`. */
const LEVELS = ['public', 'link', 'signed-in', 'organism', 'named'];
/** The widest-first order a classification's cap reads; `named` stands outside it (WP4's ruling). */
const CAP_LEVELS = LEVELS.filter((lv) => lv !== 'named');

/** The kinds the report lists, as the person knows them (services/exposure/exposure-types.ts KINDS). */
const KINDS = ['memory', 'file', 'app', 'workspace_share', 'organism', 'board', 'knowledge', 'package',
  'datapackage', 'skill', 'portfolio', 'company', 'exchange', 'agent', 'named_share', 'outside_party'];

const kindWord = (kind) => (KINDS.includes(kind) ? x(`kind.${kind}`) : kind);

/** A record or a file another identity of the person holds (an agent): the id is `<gaii>:<key>`. */
const heldByAgent = (id) => /^[^:]*#[^:]*@[^:]*:/.test(String(id));

/**
 * The one press that closes the item on this page, or null when the control is elsewhere. Each is
 * the route `how_to_close` names; making a thing private is never held for approval.
 */
function closeOf(item) {
  const id = item.id;
  switch (item.kind) {
    case 'memory':
      return heldByAgent(id) ? null : () => apiPatch(`/v1/memory/${enc(id)}`, { patch: {}, visibility: 'private' });
    case 'file':
      return heldByAgent(id) ? null : () => apiPatch(`/v1/storage/${keyPath(id)}/visibility`, { visibility: 'private' });
    case 'board':
      return () => apiPatch(`/v1/boards/${enc(id)}/visibility`, { visibility: 'private' });
    case 'skill':
      return () => apiPatch(`/v1/skills/${enc(id)}`, { visibility: 'owner' });
    case 'package':
      return () => apiPatch(`/v1/packages/${enc(id)}`, { visibility: 'private' });
    case 'workspace_share': {
      const [org, ws, type, ...rest] = String(id).split('/');
      if (!org || !ws || !type || !rest.length) return null;
      return () => setWorkspaceShare(org, ws, { docs: { [`${type}/${rest.join('/')}`]: false } });
    }
    default:
      return null;
  }
}

/** A record's, a file's or a skill's stored visibility for a level the report names in `lower_to`. */
function visibilityFor(to, skill) {
  if (to.level === 'signed-in' || to.level === 'link') return 'members';
  if (to.level === 'organism' && to.organism_id) return `organism:${to.organism_id}`;
  return skill ? 'owner' : 'private';
}

/**
 * The one press that lowers a conflict to the widest level its classification allows, or null when
 * the item is lowered on its own page. `lower_to` is the report's (services/exposure/
 * exposure-classification.ts lowerTo); each press is the route that changes that item, the same one
 * `how_to_close` names.
 */
function lowerOf(item) {
  const to = item.classification?.lower_to;
  if (!item.classification?.conflict || !to) return null;
  const id = item.id;
  switch (item.kind) {
    case 'memory':
      return heldByAgent(id) ? null : () => apiPatch(`/v1/memory/${enc(id)}`, { patch: {}, visibility: visibilityFor(to) });
    case 'file':
      return heldByAgent(id) ? null : () => apiPatch(`/v1/storage/${keyPath(id)}/visibility`, { visibility: visibilityFor(to) });
    case 'skill':
      return () => apiPatch(`/v1/skills/${enc(id)}`, { visibility: visibilityFor(to, true) });
    case 'board':
      return () => apiPatch(`/v1/boards/${enc(id)}/visibility`, { visibility: 'private' });
    case 'app':
      if (to.level === 'link') return () => apiPatch(`/v1/apps/${enc(id)}`, { listing: 'unlisted' });
      if (to.level === 'signed-in') return () => apiPatch(`/v1/apps/${enc(id)}`, { open_to: 'signed-in' });
      return null;
    case 'workspace_share': {
      const [org, ws, type, ...rest] = String(id).split('/');
      if (!org || !ws || !type || !rest.length) return null;
      if (to.level === 'signed-in') return () => setWorkspaceShare(org, ws, { access: 'account' });
      if (to.level === 'organism') return () => setWorkspaceShare(org, ws, { access: 'organism' });
      return () => setWorkspaceShare(org, ws, { docs: { [`${type}/${rest.join('/')}`]: false } });
    }
    case 'organism': {
      const [org, part] = String(id).split('#');
      if (part === 'members') return () => updateOrganism(org, { member_visibility: to.level === 'signed-in' ? 'authenticated' : 'members' });
      return () => updateOrganism(org, { visibility: 'private' });
    }
    default:
      return null;
  }
}

/**
 * The Settings page that holds the control, for a kind this page cannot close itself: the tab and
 * the key of its name. An app's open-to, listing and code are set in the App Catalog (appcat).
 */
const PLACE = {
  memory: ['memory', 'profile.tabs.memory'], file: ['memory', 'profile.tabs.memory'],
  datapackage: ['sharedData', 'profile.tabs.sharedData'], workspace_share: ['organisms', 'profile.tabs.organisms'],
  organism: ['organisms', 'profile.tabs.organisms'], board: ['boards', 'profile.tabs.boards'],
  knowledge: ['knowledge', 'knowledge.tabLabel'], package: ['packages', 'profile.tabs.packages'],
  skill: ['skills', 'skills.tabLabel'], portfolio: ['portfolio', 'portfolio.tabLabel'],
  company: ['companies', 'profile.tabs.companies'], agent: ['agents', 'profile.tabs.agents'],
};

/** A level's locale key: the report's 'signed-in' is `signedIn` in the files. */
const levelKey = (lv) => (lv === 'signed-in' ? 'signedIn' : lv);

/** A level in words, private included: the cap a classification allows, or where a conflict goes. */
const levelWords = (lv) => (lv === 'private' ? x('cls.private') : x(`level.${levelKey(lv)}`));

/** The sentence a conflict's or an exception's mark says: the classification, its cap, and the level now. */
function capSentence(item, key) {
  const c = item.classification;
  return x(key, { label: labelName(c), cap: levelWords(c.max_audience), now: levelWords(item.level) });
}

/** Who can read it, and how sensitive it is: the two badges side by side. */
function WhoCell({ item }) {
  const c = item.classification;
  return html`<${Cell}><${Marks}>
    <${AudienceBadge} audience=${exposureAudienceOf(item)} />
    ${c ? html`<${ClassificationBadge} label=${c} from=${c.from}
      conflict=${c.conflict} conflictTitle=${c.conflict ? capSentence(item, 'cls.conflictTitle') : undefined}
      excepted=${c.excepted} exceptedTitle=${c.excepted ? capSentence(item, 'cls.exceptedTitle') : undefined} />` : null}
  <//><//>`;
}

/** How many items of the kinds the Data row stands for the report counted, at every level (counts.by_kind). */
function namedCounted(report) {
  const byKind = report?.counts?.by_kind || {};
  return NAMED_KINDS.reduce((sum, kind) => sum + Object.values(byKind[kind] || {}).reduce((s, n) => s + (Number(n) || 0), 0), 0);
}

function Strip({ report }) {
  const failed = report.failed.length > 0;
  // The named shares and the outside parties are counted on the Data row and on "Data you share"
  // (WP11), so the strip counts the four levels only. With nothing open at any level the strip is
  // not drawn (the list's one line says everything is private); while a place could not be read its
  // zeros are not known to be zeros, so the strip stays and says so.
  return html`<${FigureStrip} lead wrap stacked hideZeros=${!failed} items=${[
    ...CAP_LEVELS.map((lv) => ({
      key: lv,
      n: report.counts.by_level[lv] ?? 0,
      tone: lv === 'public' && report.counts.by_level[lv] ? 'notice' : undefined,
      label: x(`level.${levelKey(lv)}`),
      sub: failed ? x('levelSubPartial') : x(`level.${levelKey(lv)}Sub`),
    })),
  ]} />`;
}

/** What the report could not do, said before the list so nobody reads a short list as a clean one. */
function Edges({ report }) {
  const words = (kinds) => kinds.map(kindWord).join(', ');
  return html`
    ${report.failed.length ? html`<${Note} kind="message" error>${x('failed', { kinds: words(report.failed) })}<//>` : null}
    ${report.capped.length ? html`<${Note} kind="aside" size="small">${x('capped', { kinds: words(report.capped) })}<//>` : null}
    ${report.hidden_by_classification ? html`<${Note} kind="aside" size="small">${x('hidden', { n: report.hidden_by_classification })}<//>` : null}`;
}

/** An address as a person reads it: the escapes decoded (sandbox%40node reads sandbox@node). */
function readableAddress(url) {
  try { return decodeURIComponent(String(url)); } catch (err) { swallowed('exposure-tab: address', err); return String(url); }
}

/** The kinds whose title the report gives as the stored key itself (a record, a file, a knowledge item). */
const KEYED = new Set(['memory', 'file', 'knowledge']);

/**
 * What a person calls the item. A record, a file or a knowledge item the report names by its key
 * (seed.exposure.price-list) is named by the key's last part in words ("Price list"); the key itself
 * stays under it, with the address. Every other title is the report's, in the page's language.
 */
function nameOf(item) {
  const title = titleOf(item);
  if (!KEYED.has(item.kind) || title !== item.id) return { name: title, key: null };
  const last = String(item.id).split(/[/.]/).filter(Boolean).pop() || String(item.id);
  const words = last.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ').trim() || last;
  return { name: words.charAt(0).toUpperCase() + words.slice(1), key: String(item.id) };
}

/** The line under the name: the key when the name was made from it, and the address in readable form. */
function whereOf(item) {
  const { key } = nameOf(item);
  const address = item.url ? readableAddress(item.url) : x('noAddress');
  return key ? `${key} · ${address}` : address;
}

function ItemRow({ item, busy, onClose, onCopied }) {
  const close = closeOf(item);
  const place = close ? null : PLACE[item.kind];
  const appHref = !close && item.kind === 'app' ? `/v1/appcat?q=${enc(item.title)}` : null;
  const forAi = x('aiPrompt', { title: titleOf(item), how: closeText(item) });
  return html`
    <${Row}>
      <${Name} href=${item.url || undefined} newTab meta=${whereOf(item)}>${nameOf(item).name}<//>
      <${Cell} meta>${kindWord(item.kind)}<//>
      <${WhoCell} item=${item} />
      <${Doors}>
        ${close ? html`<${Action} small row tone="danger" disabled=${busy} onClick=${() => onClose(item, close)}>${x('closeIt')}<//>` : null}
        ${place ? html`<${Action} small row onClick=${() => openTab(place[0])}>${x('goThere', { page: t(place[1]) })}<//>` : null}
        ${appHref ? html`<${Action} small row href=${appHref} newTab>${x('goThere', { page: t('catalog.title') })}<//>` : null}
        <${Action} small row soft copy=${forAi} onCopied=${onCopied}>${t('common.copyForAi')}<//>
      <//>
    <//>`;
}

/**
 * One conflict: what it is, the sentence that says its classification's cap, both badges, and the
 * press that lowers it (or the page where it is lowered), with the words for the person's AI.
 */
function ConflictRow({ item, busy, onLower, onCopied }) {
  const lower = lowerOf(item);
  const place = lower ? null : PLACE[item.kind];
  const appHref = !lower && item.kind === 'app' ? `/v1/appcat?q=${enc(item.title)}` : null;
  const c = item.classification;
  const forAi = x('cls.aiPrompt', { title: titleOf(item), label: labelName(c), cap: levelWords(c.max_audience), how: closeText(item) });
  return html`
    <${Row} rail="notice">
      <${Name} href=${item.url || undefined} newTab meta=${whereOf(item)} desc=${capSentence(item, 'cls.capSentence')}>${nameOf(item).name}<//>
      <${Cell} meta>${kindWord(item.kind)}<//>
      <${WhoCell} item=${item} />
      <${Doors}>
        ${lower ? html`<${Action} small row disabled=${busy} onClick=${() => onLower(item, lower)}>${x('cls.lowerIt')}<//>` : null}
        ${place ? html`<${Action} small row onClick=${() => openTab(place[0])}>${x('goThere', { page: t(place[1]) })}<//>` : null}
        ${appHref ? html`<${Action} small row href=${appHref} newTab>${x('goThere', { page: t('catalog.title') })}<//>` : null}
        <${Action} small row soft copy=${forAi} onCopied=${onCopied}>${t('common.copyForAi')}<//>
      <//>
    <//>`;
}

/** @param {{ showToast?: (msg: string, kind?: unknown) => void }} props the profile shell's tab props */
export default function ExposureTab({ showToast }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const { confirm, ConfirmUI } = useConfirm();

  const [shared, setShared] = useState(null);
  // Which kinds' rows the person opened (each kind of open thing is one closed row).
  const [kindOpen, setKindOpen] = useState({});

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/v1/exposure/mine');
      setReport(res?.data ?? null);
      setError('');
    } catch (err) {
      swallowed('exposure-tab: load failed', err);
      // The page's own words: the server's sentence is English and names the route.
      setError(x('loadFailed'));
    }
    // What the person shares as data, for the one Data row (the view "Data you share" reads; WP11).
    dp.sharedData().then((r) => setShared(r || { packages: [], counts: {} })).catch((err) => swallowed('exposure-tab: shared data', err));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const onClose = (item, close) => confirm(x('closeConfirm', { title: titleOf(item) }), () => runClose(item, close),
    { title: x('closeTitle'), confirmLabel: x('closeIt'), danger: true });

  const runClose = async (item, close) => {
    const ref = `${item.kind}|${item.id}`;
    setBusy(ref);
    setMessage('');
    try {
      await close();
      setMessage(x('closed', { title: titleOf(item) }));
      await load();
    } catch (err) {
      swallowed('exposure-tab: close failed', err);
      setError(x('closeFailed'));
    } finally {
      setBusy('');
    }
  };

  const onLower = (item, lower) => {
    const to = levelWords(item.classification.lower_to.level);
    confirm(x('cls.lowerConfirm', { title: titleOf(item), level: to, label: labelName(item.classification) }), () => runLower(item, lower, to),
      { title: x('cls.lowerTitle'), confirmLabel: x('cls.lowerIt') });
  };

  const runLower = async (item, lower, to) => {
    const ref = `${item.kind}|${item.id}`;
    setBusy(ref);
    setMessage('');
    try {
      const out = await lower();
      // Some services answer a refusal as { ok: false } rather than throwing (services/organisms.js).
      if (out && out.ok === false) throw new Error(out.error?.message || x('cls.lowerFailed'));
      setMessage(x('cls.lowered', { title: titleOf(item), level: to }));
      await load();
    } catch (err) {
      swallowed('exposure-tab: lower failed', err);
      setError(x('cls.lowerFailed'));
    } finally {
      setBusy('');
    }
  };

  // The site's toast after a copy, as the other copy doors say it (the link's own "✓ Copied" too).
  const copied = () => showToast?.(x('copiedForAi'));

  const all = report?.items ?? [];
  // The named shares, the parties and the data packages are the one Data row; each is listed and
  // closed on "Data you share" (WP11).
  const items = all.filter((i) => !NAMED_KINDS.includes(i.kind));
  const namedCount = Math.max(namedCounted(report), all.length - items.length);
  const total = (report?.counts?.total ?? 0) - (all.length - items.length);
  const cls = report?.classification ?? null;
  const conflicts = all.filter((i) => i.classification?.conflict);
  // What is drawn, in this order: the conflicts when there are any (or an exception to say), the
  // list of what is open, the Data row once something is shared as data (before the list when the
  // list itself is empty, so what is open stands first), and the limits of the list, open: a limit
  // of a safety list is a safety fact. The Data row is drawn whenever the report counts a data item,
  // even before "Data you share" answers, so an empty list never reads as "nothing is open".
  const showConflicts = !!cls && ((cls.conflicts || 0) > 0 || (cls.excepted || 0) > 0);
  const showData = dataShown(shared) || namedCount > 0;
  const notes = report ? noteTexts(report).filter(Boolean) : [];
  const order = [
    showConflicts ? 'ex-conflicts' : null,
    showData && items.length === 0 ? 'ex-data' : null,
    'ex-items',
    showData && items.length > 0 ? 'ex-data' : null,
    notes.length ? 'ex-notes' : null,
  ].filter(Boolean);
  const num = (id) => String(order.indexOf(id) + 1).padStart(2, '0');
  const first = order[0];
  const parts = {
    'ex-conflicts': () => html`
      <${Section} id="ex-conflicts" num=${num('ex-conflicts')} title=${x('cls.conflictsTitle')} count=${cls.conflicts} first=${first === 'ex-conflicts'}>
        <${List} cols="item-kind-state-doors" keepCols
          head=${[x('colWhat'), x('colKind'), x('colWho'), '']}
          empty=${x('cls.conflictsEmpty')}
          rows=${conflicts}
          render=${(item) => html`<${ConflictRow} key=${`c|${item.kind}|${item.id}|${item.level}`} item=${item}
            busy=${busy === `${item.kind}|${item.id}`} onLower=${onLower} onCopied=${copied} />`} />
        ${conflicts.length < cls.conflicts ? html`<${Note} kind="hint">${x('cls.conflictsHidden', { n: cls.conflicts - conflicts.length })}<//>` : null}
        ${cls.conflicts ? html`<${Note} kind="hint">${x('cls.conflictsWhy')}<//>` : null}
        ${cls.excepted ? html`<${Note} kind="hint">${x('cls.excepted', { n: cls.excepted })}<//>` : null}
      <//>`,
    'ex-data': () => secData({ shared, num: num('ex-data'), first: first === 'ex-data' }),
    // The open things grouped by kind, each kind one closed row that says how many and at which
    // levels (usability round 3: 21 rows in one list); the kinds in the report's KINDS order.
    'ex-items': () => html`
      <${Section} id="ex-items" num=${num('ex-items')} title=${x('itemsTitle')} count=${total} first=${first === 'ex-items'}>
        ${items.length === 0 ? html`<${List} cols="item-kind-state-doors" keepCols
          empty=${report.failed.length ? x('emptyPartial') : showData ? x('emptyButData') : x('empty')} rows=${[]} render=${() => null} />` : null}
        ${KINDS.filter((kind) => items.some((i) => i.kind === kind)).map((kind) => {
          const group = items.filter((i) => i.kind === kind);
          const byLevel = CAP_LEVELS.map((lv) => [lv, group.filter((i) => i.level === lv).length]).filter(([, n]) => n > 0);
          return html`
            <${FoldSection} key=${'k-' + kind} inner id=${'ex-kind-' + kind} title=${x(`kindGroup.${kind}`)}
              sub=${[String(group.length), ...byLevel.map(([lv, n]) => `${levelWords(lv)} ${n}`)].join(' · ')}
              open=${!!kindOpen[kind]} onToggle=${() => setKindOpen((o) => ({ ...o, [kind]: !o[kind] }))}>
              <${List} cols="item-kind-state-doors" keepCols head=${[x('colWhat'), x('colKind'), x('colWho'), '']}
                rows=${group}
                render=${(item) => html`<${ItemRow} key=${`${item.kind}|${item.id}|${item.level}`} item=${item}
                  busy=${busy === `${item.kind}|${item.id}`} onClose=${onClose} onCopied=${copied} />`} />
            <//>`;
        })}
        ${items.length < total ? html`<${Note} kind="hint">${x('countedNotListed', { n: total - items.length })}<//>` : null}
      <//>`,
    'ex-notes': () => html`
      <${Section} id="ex-notes" num=${num('ex-notes')} title=${x('notesTitle')}>
        ${notes.map((n, i) => html`<${Note} key=${i} kind="hint">${n}<//>`)}
      <//>`,
  };
  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.exposure')]}
      title=${/* One name for the page: the menu's and the crumb's (exposure.title said it another way). */
        t('profile.tabs.exposure')}
      help="concept.audience"
      desc=${x('intro')}
      start=${html`<${PageStart} id="exposure" />`}
      strip=${report ? html`<${Strip} report=${report} />` : html`<${FigureStrip} lead stacked loading=${4} />`}
      after=${html`<${ConfirmUI} />`}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${message ? html`<${Note} kind="message">${message}<//>` : null}
      ${!report && !error ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${report ? html`
        <${Edges} report=${report} />
        ${order.map((id) => parts[id]())}` : null}
    <//>`;
}
