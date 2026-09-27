/**
 * @file public/views/admin/cors-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin CORS page in the poster face (design canvas "AIMEAT Admin CORS", direction A).
 *   One read, GET /v1/admin/cors/overview, which the aimeat_admin_cors_overview tool returns too,
 *   and five sections in the order an operator asks: what a browser on another origin gets right
 *   now (the status word, the default list, the three cookie doors that take no wildcard, and who
 *   is different), the numeral strip, the people with a list of their own, the agents with one,
 *   how the four lists rank when more than one applies, and the paste for the operator's own AI.
 *   The two writes go through the same PUT routes as before, which now call the same service the
 *   aimeat_admin_cors_set tool calls. Every part is a library component; the page passes data and
 *   writes no class.
 * @structure CorsTab({ data, switchPage }) — load · RightNow · Strip · the two ListSections from
 *   cors-tab.form.js · OrderSection · AskAiSection · the actions (save, clear)
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (admin group G2): Section, Verdict and Readings,
 *     FigureStrip, the List (cut n-name-doors) for the precedence ladder, SettingBox (`pre`) for the
 *     paste, Action for the doors. The page sheet admin-cors.css goes.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 -- 2026-09-13 -- Compose section headings from the shared B1 shape.
 *   v2.0.0 — 2026-09-08 — The poster face and the one read: the three cards become five sections,
 *     the native selects become a picker that narrows as you type, the cookie doors and the
 *     precedence ladder appear on a screen for the first time, and every write re-reads on a live
 *     update.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { List, Row, Name, Num, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { getNodeUrl } from '/js/services/auth.js';
import { getCorsOverview, setGhiiCors, clearGhiiCors, setAgentCors, clearAgentCors } from '/js/services/admin.js';
import { ListSection } from './cors-tab.form.js';
import { buildCorsPrompt } from './cors-tab.prompt.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.cors.' + key, params);

/** "one person", "3 people and one agent": who keeps a list, as words for the status sentence. Only
 *  the kinds that have one are named, so a page with people and no agents never says "and nobody". */
function whoWord(people, agents) {
  const parts = [];
  if (people > 0) parts.push(people === 1 ? C('now.peopleOne') : C('now.peopleMany', { n: num(people) }));
  if (agents > 0) parts.push(agents === 1 ? C('now.agentsOne') : C('now.agentsMany', { n: num(agents) }));
  return parts.join(' ' + C('now.and') + ' ');
}

/** The status word and its sentence: the default list, and whether anyone is different from it. */
function statusOf(ov) {
  const named = ov.default.origins.filter(o => o !== '*');
  const people = ov.people.with_list.length;
  const agents = ov.agents.with_list.length;
  const some = people + agents > 0;
  const who = { who: whoWord(people, agents) };
  if (ov.default.wildcard) return { word: C('now.wordAny'), line: some ? C('now.lineAnySome', who) : C('now.lineAnyNone') };
  if (named.length > 0) return { word: C('now.wordNamed'), line: some ? C('now.lineNamedSome', { n: num(named.length), ...who }) : C('now.lineNamedNone', { n: num(named.length) }) };
  return { word: C('now.wordNone'), line: some ? C('now.lineNamedSome', { n: 0, ...who }) : C('now.lineNamedNone', { n: 0 }) };
}

/** Section 01: the status word, its sentence, the log line, and the five rows. */
function RightNow({ ov, switchPage }) {
  const named = ov.default.origins.filter(o => o !== '*');
  const { word, line } = statusOf(ov);
  const log = (ov.default.wildcard ? C('now.logAny') : C('now.logNamed', { list: ov.default.origins.join(', ') || '—' }))
    + (ov.anonymous_mode ? ' · ' + C('now.logAnon') : '');
  const people = ov.people.with_list.length;
  const agents = ov.agents.with_list.length;
  const records = ov.records.with_list;
  const countChip = (n) => n === 0
    ? html`<${Badge} type="muted" label=${C('now.chipNone')} />`
    : html`<${Badge} type="info" label=${C('now.chipSet', { n: num(n) })} />`;
  return html`
    <${Section} first id="adm-cors-01" num="01" title=${C('now.title')}
      doors=${html`<${Action} small soft onClick=${() => switchPage('config')}>${C('now.toSettings')}<//>`}>
      <${Verdict} word=${word} line=${line} stamp=${log}>
        <${Readings} rows=${[
          { key: 'default', name: ov.default.wildcard ? C('now.default') : C('now.defaultNamed', { n: num(named.length) }),
            why: ov.default.wildcard ? C('now.defaultWhy') : C('now.defaultNamedWhy', { list: named.join(', ') }),
            mark: html`<${Badge} type="healthy" />`, value: ov.default.env },
          { key: 'doors', name: C('now.cookieDoors'),
            why: ov.cookie_doors.named.length === 0 ? C('now.cookieDoorsWhy') : C('now.cookieDoorsNamedWhy', { n: num(ov.cookie_doors.named.length), list: ov.cookie_doors.named.join(', ') }),
            mark: html`<${Badge} type="healthy" />`, value: C('now.named', { n: num(ov.cookie_doors.named.length) }) },
          { key: 'people', name: C('now.people'), why: C('now.peopleWhy'), mark: countChip(people), value: C('now.ofAccounts', { n: num(ov.people.total) }) },
          { key: 'agents', name: C('now.agents'), why: C('now.agentsWhy'), mark: countChip(agents), value: C('now.ofAgents', { n: num(ov.agents.total) }) },
          { key: 'records', name: C('now.records'), why: C('now.recordsWhy'), mark: countChip(records), value: 'PUT /v1/memory/cors/:key', last: true },
        ]} />
      <//>
    <//>`;
}

/** The numeral strip: the default in one word, who is different, and the cookie doors. */
function Strip({ ov, toSection }) {
  const named = ov.default.origins.filter(o => o !== '*');
  return html`<${FigureStrip} wrap items=${[
    ov.default.wildcard
      ? { key: 'default', n: C('strip.any'), tone: 'coral', label: C('strip.anyLabel'), sub: C('strip.anySub') }
      : { key: 'default', n: num(named.length), label: C('strip.namedLabel'), sub: C('strip.namedSub') },
    { key: 'people', n: num(ov.people.with_list.length), label: C('strip.people'), sub: C('strip.peopleSub', { n: num(ov.people.total) }), onClick: () => toSection('02') },
    { key: 'agents', n: num(ov.agents.with_list.length), label: C('strip.agents'), sub: C('strip.agentsSub', { n: num(ov.agents.total) }), onClick: () => toSection('03') },
    { key: 'doors', n: num(ov.cookie_doors.paths.length), label: ov.cookie_doors.named.length === 0 ? C('strip.doors') : C('strip.doorsNamed'), sub: C('strip.doorsSub') },
  ]} />`;
}

/** Section 04: the four lists in the order the door asks them. */
function OrderSection({ ov, switchPage }) {
  const step = (n, key, value) => html`
    <${Row} key=${key}>
      <${Num}><${Figure} small step n=${n} /><//>
      <${Name} desc=${C('order.' + key + 'Why', { value: ov.default.origins.join(', ') || '—' })}>${C('order.' + key)}<//>
      <${Doors}>${value}<//>
    <//>`;
  const route = (r) => html`<${Note} kind="meta" mono inline>${r}<//>`;
  return html`
    <${Section} id="adm-cors-04" num="04" title=${C('order.title')}>
      <${Note} kind="lead">${C('order.lead')}<//>
      <${List} cols="n-name-doors">
        ${step(1, 'record', route('PUT /v1/memory/cors/:key'))}
        ${step(2, 'agent', route('PUT /v1/agents/:name/cors'))}
        ${step(3, 'person', route('PUT /v1/ghii/cors'))}
        ${step(4, 'default', html`<${Action} small soft onClick=${() => switchPage('config')}>${C('order.settings')}<//>`)}
      <//>
    <//>`;
}

/** Section 05: the paste for the operator's own AI. */
function AskAiSection() {
  const paste = buildCorsPrompt({ url: getNodeUrl() });
  return html`
    <${Section} id="adm-cors-05" num="05" title=${C('ai.title')}
      doors=${html`<${Action} small soft copy=${paste}>${C('ai.copy')}<//>`}>
      <${Note} kind="lead">${C('ai.lead')}<//>
      <${SettingBox} pre label=${C('ai.label')}>${paste}<//>
    <//>`;
}

export default function CorsTab(props) {
  const { data, switchPage } = props;
  const [ov, setOv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await getCorsOverview();
      if (!r.ok) throw new Error(r.error?.message || 'read failed');
      setOv(r.data);
      setFailed(false);
    } catch (e) {
      setFailed(true);
      showErr(e.message);
    }
  }, [showErr]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['features', 'config', 'ghii', 'agents'], () => load()), [load]);

  const toSection = (n) => document.getElementById('adm-cors-' + n)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /** One write through the door, one re-read, one word to the operator. */
  const write = async (fn, word) => {
    try {
      const r = await fn();
      if (!r.ok) throw new Error(r.error?.message || 'write failed');
      showOk(C(word));
      await load();
      return true;
    } catch (e) {
      // The operator reads the refusal in the toast and the form keeps what they typed.
      swallowed('cors-tab: write', e);
      showErr(e.message);
      return false;
    }
  };
  const savePerson = (ghii, origins) => write(() => setGhiiCors(ghii, origins), 'saved');
  const saveAgent = (gaii, origins) => write(() => setAgentCors(gaii, origins), 'saved');
  const clearPerson = (ghii) => confirm(C('clearConfirm'), () => write(() => clearGhiiCors(ghii), 'cleared'), { danger: true });
  const clearAgent = (gaii) => confirm(C('clearConfirm'), () => write(() => clearAgentCors(gaii), 'cleared'), { danger: true });

  if (!ov) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      ${failed ? html`<${Note} kind="quiet">${C('loadFailed')}<//>` : html`<${Spinner} text=${t('dashboard.loading')} />`}`;
  }

  const listed = new Set([...ov.people.with_list.map(p => p.ghii), ...ov.agents.with_list.map(a => a.gaii)]);
  const peopleRows = ov.people.with_list.map(p => ({ id: p.ghii, name: p.owner_name, sub: p.ghii, origins: p.allowed_origins }));
  const agentRows = ov.agents.with_list.map(a => ({ id: a.gaii, name: a.gaii.split('@')[0], sub: `${C('agents.of')} ${a.owner} · ${a.gaii}`, origins: a.allowed_origins }));
  const peopleFree = (data?.ghiiUsers || []).filter(u => !listed.has(u.ghii)).map(u => ({ id: u.ghii, name: u.owner_name || u.username || u.ghii, sub: u.ghii }));
  const agentsFree = ((data?.agents && data.agents.agents) || []).filter(a => !listed.has(a.gaii)).map(a => ({ id: a.gaii, name: a.display_name || a.gaii.split('@')[0], sub: a.gaii }));

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note} kind="hint">${C('intro')}<//>
      <${RightNow} ov=${ov} switchPage=${switchPage} />
      <${Strip} ov=${ov} toSection=${toSection} />
      <${ListSection} kind="people" number="02" rows=${peopleRows} total=${num(ov.people.total)} candidates=${peopleFree}
        onSave=${savePerson} onClear=${clearPerson} door=${C('people.toGhii')} onDoor=${() => switchPage('ghii')} />
      <${ListSection} kind="agents" number="03" rows=${agentRows} total=${num(ov.agents.total)} candidates=${agentsFree}
        onSave=${saveAgent} onClear=${clearAgent} door=${C('agents.toAgents')} onDoor=${() => switchPage('agents')} />
      <${OrderSection} ov=${ov} switchPage=${switchPage} />
      <${AskAiSection} />
      <${ConfirmUI} />
    <//>`;
}
