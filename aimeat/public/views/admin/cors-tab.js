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
 *   aimeat_admin_cors_set tool calls.
 * @structure CorsTab({ data, switchPage }) — load · RightNow · Strip · the two ListSections from
 *   cors-tab.form.js · OrderSection · AskAiSection · the actions (save, clear)
 * @version-history
 *   v2.0.0 — 2026-09-08 — The poster face and the one read: the three cards become five sections,
 *     the native selects become a picker that narrows as you type, the cookie doors and the
 *     precedence ladder appear on a screen for the first time, and every write re-reads on a live
 *     update.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { CopyButton } from '/components/CopyButton.js';
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
  const row = (title, why, chip, value, last) => html`
    <div class="adm-mrow ${last ? 'adm-mrow--last' : ''}">
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <span>${chip}</span>
      <span class="adm-mval">${value}</span>
    </div>`;
  return html`
    <section class="og-sec og-sec--first" id="adm-cors-01">
      <div class="og-sec-h"><h2>${C('now.title')}<small>01</small></h2>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => switchPage('config')}>${C('now.toSettings')}</button></div></div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status">${word}</div>
          <p class="adm-alert-line">${line}</p>
          <div class="adm-ov-up">${log}</div>
        </div>
        <div>
          ${row(
            ov.default.wildcard ? C('now.default') : C('now.defaultNamed', { n: num(named.length) }),
            ov.default.wildcard ? C('now.defaultWhy') : C('now.defaultNamedWhy', { list: named.join(', ') }),
            html`<${Badge} type="healthy" />`, ov.default.env)}
          ${row(C('now.cookieDoors'),
            ov.cookie_doors.named.length === 0 ? C('now.cookieDoorsWhy') : C('now.cookieDoorsNamedWhy', { n: num(ov.cookie_doors.named.length), list: ov.cookie_doors.named.join(', ') }),
            html`<${Badge} type="healthy" />`, C('now.named', { n: num(ov.cookie_doors.named.length) }))}
          ${row(C('now.people'), C('now.peopleWhy'), countChip(people), C('now.ofAccounts', { n: num(ov.people.total) }))}
          ${row(C('now.agents'), C('now.agentsWhy'), countChip(agents), C('now.ofAgents', { n: num(ov.agents.total) }))}
          ${row(C('now.records'), C('now.recordsWhy'), countChip(records), 'PUT /v1/memory/cors/:key', true)}
        </div>
      </div>
    </section>`;
}

/** The numeral strip: the default in one word, who is different, and the cookie doors. */
function Strip({ ov, toSection }) {
  const named = ov.default.origins.filter(o => o !== '*');
  const cell = (onClick, value, label, sub, cls = '') => onClick
    ? html`<button type="button" onClick=${onClick}><b class=${cls}>${value}</b><span>${label}</span><small>${sub}</small></button>`
    : html`<div><b class=${cls}>${value}</b><span>${label}</span><small>${sub}</small></div>`;
  return html`
    <div class="og-strip">
      ${ov.default.wildcard
        ? cell(null, C('strip.any'), C('strip.anyLabel'), C('strip.anySub'), 'adm-cors-any')
        : cell(null, num(named.length), C('strip.namedLabel'), C('strip.namedSub'))}
      ${cell(() => toSection('02'), num(ov.people.with_list.length), C('strip.people'), C('strip.peopleSub', { n: num(ov.people.total) }))}
      ${cell(() => toSection('03'), num(ov.agents.with_list.length), C('strip.agents'), C('strip.agentsSub', { n: num(ov.agents.total) }))}
      ${cell(null, num(ov.cookie_doors.paths.length), ov.cookie_doors.named.length === 0 ? C('strip.doors') : C('strip.doorsNamed'), C('strip.doorsSub'))}
    </div>`;
}

/** Section 04: the four lists in the order the door asks them. */
function OrderSection({ ov, switchPage }) {
  const step = (n, key, value, last) => html`
    <div class="adm-cors-step ${last ? 'adm-cors-step--last' : ''}">
      <span class="adm-cors-step-num">${n}</span>
      <span><b>${C('order.' + key)}</b><span class="adm-why">${C('order.' + key + 'Why', { value: ov.default.origins.join(', ') || '—' })}</span></span>
      ${value}
    </div>`;
  return html`
    <section class="og-sec" id="adm-cors-04">
      <div class="og-sec-h"><h2>${C('order.title')}<small>04</small></h2></div>
      <p class="adm-cors-lead">${C('order.lead')}</p>
      ${step(1, 'record', html`<span class="adm-mval">PUT /v1/memory/cors/:key</span>`)}
      ${step(2, 'agent', html`<span class="adm-mval">PUT /v1/agents/:name/cors</span>`)}
      ${step(3, 'person', html`<span class="adm-mval">PUT /v1/ghii/cors</span>`)}
      ${step(4, 'default', html`<span class="adm-mval"><button type="button" class="og-door og-door--quiet" onClick=${() => switchPage('config')}>${C('order.settings')}</button></span>`, true)}
    </section>`;
}

/** Section 05: the paste for the operator's own AI. */
function AskAiSection() {
  const paste = buildCorsPrompt({ url: getNodeUrl() });
  return html`
    <section class="og-sec" id="adm-cors-05">
      <div class="og-sec-h"><h2>${C('ai.title')}<small>05</small></h2>
        <div class="og-doors"><${CopyButton} text=${paste} label=${C('ai.copy')} className="og-door og-door--quiet" /></div></div>
      <p class="adm-cors-lead">${C('ai.lead')}</p>
      <div class="og-box">
        <span class="og-box-label">${C('ai.label')}</span>
        <div class="adm-cors-paste">${paste}</div>
      </div>
    </section>`;
}

export default function CorsTab(props) {
  const { data, switchPage } = props;
  useViewCSS('/css/views/admin-cors.css');
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
      ${failed ? html`<div class="adm-cors-empty">${C('loadFailed')}</div>` : html`<${Spinner} text=${t('dashboard.loading')} />`}`;
  }

  const listed = new Set([...ov.people.with_list.map(p => p.ghii), ...ov.agents.with_list.map(a => a.gaii)]);
  const peopleRows = ov.people.with_list.map(p => ({ id: p.ghii, name: p.owner_name, sub: p.ghii, origins: p.allowed_origins }));
  const agentRows = ov.agents.with_list.map(a => ({ id: a.gaii, name: a.gaii.split('@')[0], sub: `${C('agents.of')} ${a.owner} · ${a.gaii}`, origins: a.allowed_origins }));
  const peopleFree = (data?.ghiiUsers || []).filter(u => !listed.has(u.ghii)).map(u => ({ id: u.ghii, name: u.owner_name || u.username || u.ghii, sub: u.ghii }));
  const agentsFree = ((data?.agents && data.agents.agents) || []).filter(a => !listed.has(a.gaii)).map(a => ({ id: a.gaii, name: a.display_name || a.gaii.split('@')[0], sub: a.gaii }));

  return html`
    <div class="adm-cors">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <p class="adm-intro">${C('intro')}</p>
      <${RightNow} ov=${ov} switchPage=${switchPage} />
      <${Strip} ov=${ov} toSection=${toSection} />
      <${ListSection} kind="people" number="02" rows=${peopleRows} total=${num(ov.people.total)} candidates=${peopleFree}
        onSave=${savePerson} onClear=${clearPerson} door=${C('people.toGhii')} onDoor=${() => switchPage('ghii')} />
      <${ListSection} kind="agents" number="03" rows=${agentRows} total=${num(ov.agents.total)} candidates=${agentsFree}
        onSave=${saveAgent} onClear=${clearAgent} door=${C('agents.toAgents')} onDoor=${() => switchPage('agents')} />
      <${OrderSection} ov=${ov} switchPage=${switchPage} />
      <${AskAiSection} />
      <${ConfirmUI} />
    </div>`;
}
