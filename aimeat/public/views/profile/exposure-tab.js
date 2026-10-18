/**
 * @file public/views/profile/exposure-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings "What others can see": everything of the person's that someone outside can
 *   read, and how to close each (plan doc-mvcn6c7e4e5q, V6.2). The screen half of GET
 *   /v1/exposure/mine; the person's AI reads the same report with aimeat_exposure_report, so the page
 *   and the chat answer with one list.
 *
 *   THE COUNTS FIRST, then the things. The strip counts by level, widest first (open to everyone,
 *   anyone with the link, every account signed in here, the members of one organism); the list under
 *   it is the report's own order, widest first. Each row says what the thing is, where it is (its
 *   address, when a stranger can open it), who can read it (AudienceBadge) and how to close it.
 *
 *   HOW TO CLOSE, on this page. Where the person can close a thing with one press, the row offers it
 *   (a record, a file, a board, a skill or a package made private; a workspace page no longer shared)
 *   and asks first. Where the control lives on another page, the row opens that page. Every row can
 *   also copy the report's `how_to_close` for the person's AI, which names the tool and the route.
 *
 *   HONEST ABOUT ITS EDGES. A kind the report could not read (`failed`) is named, and its count is
 *   missing rather than zero; a kind cut at the list's cap (`capped`) is named, with its count whole;
 *   what the person's classification hides from this view (`hidden_by_classification`) is counted;
 *   and the report's `notes` say what it does not count. The notes are the server's own sentences.
 *
 *   Live data by the `aimeat-live-update` event: the report is read again when something it lists
 *   changes, never on a timer.
 * @structure LEVELS · KINDS · closeOf(item) · placeOf(item) · ExposureTab (default)
 * @usage Registered in views/profile.js as the `exposure` tab; menu entry in landing-page.cards.js (Account).
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.2).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { setWorkspaceShare } from '/js/services/organisms.js';
import { exposureAudienceOf } from '/js/audience.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { AudienceBadge } from '/components/AudienceBadge.js';
import { openTab } from '/components/Rail.js';

const html = htm.bind(h);
const x = (key, vars) => t(`exposure.${key}`, vars);
const enc = encodeURIComponent;
/** A storage key as a path: each segment encoded, the slashes kept. */
const keyPath = (key) => String(key).split('/').map(enc).join('/');

/** The report's levels, widest first (services/exposure/exposure-types.ts LEVELS). */
const LEVELS = ['public', 'link', 'signed-in', 'organism'];

/** The kinds the report lists, as the person knows them (services/exposure/exposure-types.ts KINDS). */
const KINDS = ['memory', 'file', 'app', 'workspace_share', 'organism', 'board', 'knowledge', 'package',
  'datapackage', 'skill', 'portfolio', 'company', 'exchange', 'agent'];

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

/**
 * The Settings page that holds the control, for a kind this page cannot close itself: the tab and
 * the key of its name. An app's open-to, listing and code are set in the App Catalog (appcat).
 */
const PLACE = {
  memory: ['memory', 'profile.tabs.memory'], file: ['memory', 'profile.tabs.memory'],
  datapackage: ['memory', 'profile.tabs.memory'], workspace_share: ['organisms', 'profile.tabs.organisms'],
  organism: ['organisms', 'profile.tabs.organisms'], board: ['boards', 'profile.tabs.boards'],
  knowledge: ['knowledge', 'knowledge.tabLabel'], package: ['packages', 'profile.tabs.packages'],
  skill: ['skills', 'skills.tabLabel'], portfolio: ['portfolio', 'portfolio.tabLabel'],
  company: ['companies', 'profile.tabs.companies'], agent: ['agents', 'profile.tabs.agents'],
};

/** A level's locale key: the report's 'signed-in' is `signedIn` in the files. */
const levelKey = (lv) => (lv === 'signed-in' ? 'signedIn' : lv);

function Strip({ report }) {
  const failed = report.failed.length > 0;
  return html`<${FigureStrip} lead wrap items=${LEVELS.map((lv) => ({
    key: lv,
    n: report.counts.by_level[lv] ?? 0,
    tone: lv === 'public' && report.counts.by_level[lv] ? 'notice' : undefined,
    label: x(`level.${levelKey(lv)}`),
    sub: failed ? x('levelSubPartial') : x(`level.${levelKey(lv)}Sub`),
  }))} />`;
}

/** What the report could not do, said before the list so nobody reads a short list as a clean one. */
function Edges({ report }) {
  const words = (kinds) => kinds.map(kindWord).join(', ');
  return html`
    ${report.failed.length ? html`<${Note} kind="message" error>${x('failed', { kinds: words(report.failed) })}<//>` : null}
    ${report.capped.length ? html`<${Note} kind="aside" size="small">${x('capped', { kinds: words(report.capped) })}<//>` : null}
    ${report.hidden_by_classification ? html`<${Note} kind="aside" size="small">${x('hidden', { n: report.hidden_by_classification })}<//>` : null}`;
}

function ItemRow({ item, busy, onClose }) {
  const close = closeOf(item);
  const place = close ? null : PLACE[item.kind];
  const appHref = !close && item.kind === 'app' ? `/v1/appcat?q=${enc(item.title)}` : null;
  const forAi = x('aiPrompt', { title: item.title, how: item.how_to_close });
  return html`
    <${Row}>
      <${Name} href=${item.url || undefined} newTab meta=${item.url || x('noAddress')} clip>${item.title}<//>
      <${Cell} meta>${kindWord(item.kind)}<//>
      <${Cell}><${AudienceBadge} audience=${exposureAudienceOf(item)} /><//>
      <${Doors}>
        ${close ? html`<${Action} small row tone="danger" disabled=${busy} onClick=${() => onClose(item, close)}>${x('closeIt')}<//>` : null}
        ${place ? html`<${Action} small row onClick=${() => openTab(place[0])}>${x('goThere', { page: t(place[1]) })}<//>` : null}
        ${appHref ? html`<${Action} small row href=${appHref} newTab>${x('goThere', { page: t('catalog.title') })}<//>` : null}
        <${Action} small row soft copy=${forAi}>${x('copyForAi')}<//>
      <//>
    <//>`;
}

export default function ExposureTab() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/v1/exposure/mine');
      setReport(res?.data ?? null);
      setError('');
    } catch (err) {
      swallowed('exposure-tab: load failed', err);
      setError(err?.message || x('loadFailed'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const onClose = async (item, close) => {
    if (!window.confirm(x('closeConfirm', { title: item.title }))) return;
    const ref = `${item.kind}|${item.id}`;
    setBusy(ref);
    setMessage('');
    try {
      await close();
      setMessage(x('closed', { title: item.title }));
      await load();
    } catch (err) {
      swallowed('exposure-tab: close failed', err);
      setError(err?.message || x('closeFailed'));
    } finally {
      setBusy('');
    }
  };

  const items = report?.items ?? [];
  const total = report?.counts?.total ?? 0;
  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.exposure')]}
      title=${x('title')}
      desc=${x('intro')}
      strip=${report ? html`<${Strip} report=${report} />` : html`<${FigureStrip} lead loading=${4} />`}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${message ? html`<${Note} kind="message">${message}<//>` : null}
      ${!report && !error ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${report ? html`
        <${Edges} report=${report} />
        <${Section} id="ex-items" num="01" title=${x('itemsTitle')} count=${total}>
          <${List} cols="name-kind-state-doors"
            head=${[x('colWhat'), x('colKind'), x('colWho'), '']}
            empty=${report.failed.length ? x('emptyPartial') : x('empty')}
            rows=${items}
            render=${(item) => html`<${ItemRow} key=${`${item.kind}|${item.id}|${item.level}`} item=${item}
              busy=${busy === `${item.kind}|${item.id}`} onClose=${onClose} />`} />
          ${items.length < total ? html`<${Note} kind="hint">${x('countedNotListed', { n: total - items.length })}<//>` : null}
          <${Note} kind="hint">${x('askYourAi')}<//>
        <//>
        <${Section} fold id="ex-notes" num="02" title=${x('notesTitle')} sub=${x('notesSub')}>
          ${report.notes.map((n, i) => html`<${Note} key=${i} kind="hint">${n}<//>`)}
        <//>` : null}
    <//>`;
}
