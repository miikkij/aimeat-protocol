/**
 * @file public/views/appcat/org-wall.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organisation's app wall in the App Catalog (?view=org&org=<organism id>): the
 *   apps colleagues made and opened to one organism, to look at from four sides (newest, by team,
 *   by capability, today's training), with a "Copy prompt" that asks the person's own AI how an app
 *   is put together and what they could build with the same capabilities.
 *
 *   WHY (Jouni, 2026-11-16). In a training everyone builds an app in an hour, and an app opened only
 *   to the company showed nowhere: "Jonkinlainen ilmoitustaulu puuttuu jota voisi katsella ja
 *   fiilistellä eri kulmista." Opens and activity show; no stars and no popularity order ("Jätetään
 *   ranking pois. Ennemminkin copy prompt"). A training is an organism of its own, so its closing
 *   show is the "today" side of that organism's wall, in the order the apps were finished, with a
 *   full-screen button for the projector.
 *
 *   Data: GET /v1/organisms/:id/apps (services/app/organism-wall.ts); the organisms the person
 *   belongs to: GET /v1/organisms?member=<owner>. Reloads on the `apps` live-update domain.
 * @structure SIDES · wallPrompt(app, me) · groupBy(apps, side) · OrgWall({ owner })
 * @usage html`<${OrgWall} owner=${me} />`   // from views/appcat.js when view === 'org'
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn, getLocale, onLocaleChange } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { date } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Mark, Marks } from '/components/Mark.js';
import { Action, Actions } from '/components/Action.js';
import { showLoginModal } from '/js/services/auth.js';
import { Modal } from '/components/Modal.js';
import { PromptCard } from '/components/PromptCard.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { Select } from '/components/Select.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { FigureStrip } from '/components/FigureStrip.js';

const w = (key, vars) => t('appcat.orgWall.' + key, vars);
const SIDES = ['new', 'team', 'cap', 'today'];

/** The prompt the person copies into their own AI about one app: a colleague's, or their own. */
export function wallPrompt(app, me) {
  const caps = app.capabilities.map((c) => c.title).join(', ') || w('promptNoCaps');
  const teams = app.teams.length ? ` (${app.teams.join(', ')})` : '';
  return w(app.owner === me ? 'promptOwn' : 'prompt', { name: app.name, by: app.owner, teams, caps, url: app.url || '' });
}

/** The apps in groups: by the author's teams, or by capability. An app may sit in several groups. */
function groupBy(apps, side) {
  const groups = new Map();
  for (const a of apps) {
    const keys = side === 'team' ? (a.teams.length ? a.teams : [w('noTeam')]) : (a.capabilities.length ? a.capabilities.map((c) => c.title) : [w('noCaps')]);
    for (const k of keys) groups.set(k, [...(groups.get(k) || []), a]);
  }
  return [...groups.entries()].sort((x, y) => x[0].localeCompare(y[0]));
}

function readOrg() { return new URLSearchParams(location.search).get('org') || ''; }
function writeOrg(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('org', id); else url.searchParams.delete('org');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

export function OrgWall({ owner }) {
  const [orgs, setOrgs] = useState(null);
  const [org, setOrg] = useState(readOrg);
  const [side, setSide] = useState('new');
  const [wall, setWall] = useState(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [expired, setExpired] = useState(false);
  const [asking, setAsking] = useState(null);
  const stage = useRef(null);

  useEffect(() => {
    if (!owner) return;
    apiGet(`/v1/organisms?member=${encodeURIComponent(owner)}`)
      .then((res) => {
        const list = (res?.data?.organisms || []).map((o) => ({ id: o.id, name: o.name || o.id }));
        setOrgs(list);
        if (!readOrg() && list.length) { setOrg(list[0].id); writeOrg(list[0].id); }
      })
      .catch((err) => { swallowed('org-wall: organisms', err); setOrgs([]); });
  }, [owner]);

  const load = useCallback(async () => {
    if (!org) return;
    try {
      const res = await apiGet(`/v1/organisms/${encodeURIComponent(org)}/apps?lang=${encodeURIComponent(getLocale())}`);
      setWall(res?.data ?? null);
      setFailed(false);
      setDenied(false);
      setExpired(false);
    } catch (err) {
      // A link to an organism the person is not in is a refusal to say so, not a fault to retry.
      if (err?.status === 403 || err?.status === 404) { setDenied(true); setFailed(false); return; }
      // A sign-in that ended (api.js already tried to refresh it) asks for a new sign-in, not a retry.
      if (err?.status === 401) { setExpired(true); setFailed(false); return; }
      swallowed('org-wall: load', err);
      setFailed(true);
    }
  }, [org]);

  useEffect(() => { setWall(null); setDenied(false); setExpired(false); load(); }, [load]);
  // After a sign-in anywhere on the page, ask again.
  useEffect(() => {
    const again = () => load();
    window.addEventListener('aimeat-auth-change', again);
    return () => window.removeEventListener('aimeat-auth-change', again);
  }, [load]);
  useEffect(() => onLiveUpdate(['apps'], () => load()), [load]);
  // The capability titles and team names come in the page's language: a switch asks again.
  useEffect(() => onLocaleChange(() => load()), [load]);

  const choose = (id) => { setOrg(id); writeOrg(id); };
  const fullScreen = () => {
    const ask = stage.current?.requestFullscreen?.();
    if (ask && typeof ask.catch === 'function') ask.catch((err) => swallowed('org-wall: full screen', err));
  };

  const signIn = () => {
    const opened = showLoginModal({ onLogin: () => window.dispatchEvent(new Event('aimeat-auth-change')) });
    if (!opened) location.href = '/v1/profile';
  };
  if (!owner || expired) {
    return html`
      <${Note} kind="lead">${w(owner ? 'expired' : 'signIn')}<//>
      <${Actions}><${Action} onClick=${signIn}>${w('signInAction')}<//><//>`;
  }
  if (orgs && orgs.length === 0) return html`<${Note} kind="lead">${w('noOrgs')}<//>`;

  const apps = wall?.apps || [];
  const today = wall?.day || '';
  const shown = side === 'today'
    ? apps.filter((a) => String(a.published_at).slice(0, 10) === today).sort((x, y) => String(x.published_at).localeCompare(String(y.published_at)))
    : apps;
  const week = apps.filter((a) => Date.now() - Date.parse(a.published_at) < 7 * 86_400_000).length;
  const capCount = new Set(shown.flatMap((a) => a.capabilities.map((c) => c.id))).size;

  const row = (a) => html`
    <${Row} key=${a.owner + '/' + a.filename}>
      <${Name} href=${a.url || undefined} newTab desc=${a.description}>${a.icon ? a.icon + ' ' : ''}${a.name}<//>
      <${Cell} meta sub=${a.teams.join(', ')}>${a.owner}<//>
      <${Cell}><${Marks}>${a.capabilities.map((c) => html`<${Mark} key=${c.id} small>${c.title}<//>`)}<//><//>
      <${Cell} meta sub=${a.opens_today ? w('todayN', { n: a.opens_today }) : ''}>${tn('appcat.orgWall.opensN', a.opens)}<//>
      <${Cell} meta>${date(a.published_at)}<//>
      <${Doors}>
        ${a.url ? html`<${Action} small href=${a.url} target="_blank" rel="noopener">${w('open')}<//>` : null}
        <${Action} small onClick=${() => setAsking(a)}>${w('copyPrompt')}<//>
      <//>
    <//>`;

  const list = (rows) => html`
    <${List} cols="name-who-tags-n-when-doors" head=${[w('colApp'), w('colWho'), w('colCaps'), w('colOpens'), w('colWhen'), '']}
      empty=${side === 'today' ? w('emptyToday') : w('empty')} loading=${!wall && !failed}>
      ${rows.map(row)}
    <//>`;

  // The picker shows when there is a choice, or when the address names an organism not among the person's.
  const picker = orgs && (orgs.length > 1 || (orgs.length && !orgs.some((o) => o.id === org)));
  if (denied) {
    return html`
      <${Note} kind="lead">${w('notMember')}<//>
      ${picker ? html`<${Select} ariaLabel=${w('pickOrg')} value=${org} placeholder=${w('pickOrg')} onChange=${choose}
        options=${orgs.map((o) => [o.id, o.name])} />` : null}`;
  }

  return html`
    <div ref=${stage}>
      ${picker ? html`<${Select} ariaLabel=${w('pickOrg')} value=${org} onChange=${choose}
        options=${orgs.map((o) => [o.id, o.name])} />` : null}
      <${SubHeading} level=${2} desc=${w('lede')}>${w('title', { org: wall?.organism?.name || '' })}<//>
      <${ModeTabs}>
        ${SIDES.map((s) => html`<${ModeTab} key=${s} on=${side === s} onClick=${() => setSide(s)}>${w('side.' + s)}<//>`)}
      <//>
      ${failed ? html`<${Note} kind="hint">${w('failed')}<//>` : html`
        <${FigureStrip} items=${[
          { key: 'apps', n: shown.length, label: w('figApps') },
          side === 'today' ? { key: 'caps', n: capCount, label: w('figCaps') } : { key: 'week', n: week, label: w('figWeek') },
        ]} />
        <${Note} kind="hint">${side === 'today' ? w('orderToday') : w('order')}<//>
        ${side === 'today' && shown.length ? html`<${Action} small onClick=${fullScreen}>${w('fullScreen')}<//>` : null}
        ${side === 'team' || side === 'cap'
          ? groupBy(shown, side).map(([title, rows]) => html`<${SubHeading} key=${title} level=${3}>${title} · ${rows.length}<//>${list(rows)}`)
          : list(shown)}`}
    </div>
    <${Modal} open=${!!asking} onClose=${() => setAsking(null)} title=${asking ? w('promptTitle', { name: asking.name }) : ''}>
      ${asking ? html`<${PromptCard} loud label=${w('promptLabel')} prompt=${wallPrompt(asking, owner)} copyLabel=${w('copy')} copiedLabel=${w('copied')} />` : null}
    <//>`;
}

export default OrgWall;
