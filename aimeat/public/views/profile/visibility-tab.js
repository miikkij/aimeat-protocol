/**
 * @file visibility-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile "Visibility" tab: how people and AIs find the owner's place and what they do
 *   there. The machine room for the AI visibility report (GET /v1/visibility/report), the on-page
 *   behaviour report (GET /v1/visibility/behaviour) and their switches. The owner's AI reads the same
 *   two objects with aimeat_visibility_report and aimeat_visibility_behaviour, so the page and the
 *   chat answer with one set of numbers.
 *
 *   ONE QUESTION AT A TIME, as on the Usage tab: people by where they came from, what the AIs read,
 *   purchases, what AI agents met, what people do on the apps, and the settings. Each part says in
 *   one sentence what its numbers are worth, and the page says plainly what it cannot see: the
 *   question a person asked the AI.
 *
 *   IT BORROWS NOTHING AND INVENTS NOTHING: SettingsPage, Tabs, FigureStrip, List, Note, Check and
 *   TextField; the page writes no class.
 * @structure PARTS · PERIODS · VisibilityTab (default) · the six parts as small functions
 * @usage Registered in views/profile.js as the `visibility` tab; menu entry in landing-page.cards.js.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (AI visibility, the owner panel for layers A to E), approved by Jouni on the sandbox.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Tabs, TabPanel } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Num } from '/components/List.js';
import { Row as Line, Space } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { Check } from '/components/Check.js';
import { TextField } from '/components/TextField.js';
import { Action } from '/components/Action.js';
import { apiGet, apiPut, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

// profile.visibility holds the memory visibility words, so this page's text is under profile.aivis.
const v = (key) => t(`profile.aivis.${key}`);

const PARTS = ['people', 'ai', 'purchases', 'agents', 'apps', 'settings'];
const PERIODS = [7, 30, 90];

const CHANNELS = ['ai', 'search', 'social', 'referral', 'direct', 'internal'];

/** Money in 6-decimal micro-units, morsels whole. */
function amount(currency, n) {
  if (currency === 'MORSEL') return `${n} ${t('profile.aivis.morsels')}`;
  return `${(Number(n) / 1e6).toFixed(2)} ${currency}`;
}

const table = (head, rows, empty) => html`
  <${List} keepCols cols=${head.length > 3 ? 'name-n-n-n' : head.length > 2 ? 'name-n-n' : 'name-n'}
    head=${head.map((hd, i) => (i ? { label: hd, num: true } : hd))}
    empty=${empty}
    rows=${rows}
    render=${(row, ri) => html`<${Row} key=${ri}>${row.map((cell, i) => (i
      ? html`<${Num} key=${i}>${cell}<//>`
      : html`<${Name} key=${i}>${cell}<//>`))}<//>`} />`;

function People({ r }) {
  return html`
    <${FigureStrip} lead items=${[
      { key: 'people', n: r.totals.people, label: v('figPeople') },
      { key: 'fromAi', n: r.channels.ai, label: v('figFromAi') },
      { key: 'fetches', n: r.totals.assistant_fetches, label: v('figAssistant') },
      { key: 'purchases', n: r.totals.purchases, label: v('figPurchases') },
    ]} />
    <${SubHeading} level=${3} desc=${v('channelsWhy')}>${v('channelsTitle')}<//>
    ${table([v('colChannel'), v('colPeople')], CHANNELS.map((c) => [v(`ch.${c}`), r.channels[c] ?? 0]), v('empty'))}
    <${SubHeading} level=${3} desc=${v('referralsWhy')}>${v('referralsTitle')}<//>
    ${table([v('colAi'), v('colPeople')], r.ai_referrals.map((a) => [a.family, a.people]), v('emptyAi'))}
    <${Note} kind="hint" size="note">${v('notSeen')}<//>
    ${r.totals.opted_out ? html`<${Note} kind="hint" size="note">${v('optedOut').replace('{n}', r.totals.opted_out)}<//>` : null}`;
}

function Ai({ r }) {
  return html`
    <${SubHeading} level=${3} desc=${v('assistantWhy')}>${v('assistantTitle')}<//>
    ${table([v('colAi'), v('colFetches')], r.assistant_fetches.map((a) => [a.family, a.fetches]), v('emptyAi'))}
    <${SubHeading} level=${3} desc=${v('crawlerWhy')}>${v('crawlerTitle')}<//>
    ${table([v('colAi'), v('colFetches')], r.crawler_fetches.map((a) => [a.family, a.fetches]), v('emptyAi'))}
    <${SubHeading} level=${3} desc=${v('pathsWhy')}>${v('pathsTitle')}<//>
    ${table([v('colTarget'), v('colPeople'), v('colAiFetches')],
      r.top_paths.map((p) => [p.target, p.people, Object.values(p.assistant).reduce((n, x) => n + x, 0) + Object.values(p.crawler).reduce((n, x) => n + x, 0)]),
      v('empty'))}
    <${SubHeading} level=${3} desc=${v('discoveryWhy')}>${v('discoveryTitle')}<//>
    ${table([v('colFile'), v('colFetches')], r.discovery.map((d) => [d.doc, d.fetches]), v('empty'))}`;
}

function Purchases({ r }) {
  const via = (p) => (p.via === 'agent' ? v('viaAgent') : v('viaPage'));
  const from = (p) => (p.channel === 'none' ? v('ch.none') : p.family ? `${v(`ch.${p.channel}`)}: ${p.family}` : v(`ch.${p.channel}`));
  return html`
    <${SubHeading} level=${3} desc=${v('purchasesWhy')}>${v('purchasesTitle')}<//>
    ${table([v('colFrom'), v('colHow'), v('colPurchases'), v('colAmount')],
      r.purchases.map((p) => [from(p), via(p), p.purchases, Object.entries(p.amounts).map(([c, n]) => amount(c, n)).join(', ')]),
      v('emptyPurchases'))}`;
}

function Agents({ r }) {
  const a = r.agents;
  return html`
    <${SubHeading} level=${3} desc=${v('agentsWhy')}>${v('agentsTitle')}<//>
    ${a.findings.length
      ? a.findings.map((f, i) => html`<${Note} key=${i} kind="aside" size="small">${f.text}<//>`)
      : html`<${Note} kind="quiet">${v('emptyAgents')}<//>`}
    <${SubHeading} level=${3}>${v('checkoutsTitle')}<//>
    ${table([v('colAi'), v('colStarted'), v('colCompleted'), v('colStopped')],
      a.checkouts.map((c) => [c.family, c.started, c.completed, c.canceled + c.expired + c.failed]), v('empty'))}
    <${SubHeading} level=${3}>${v('toolsTitle')}<//>
    ${table([v('colAi'), v('colCalls'), v('colOk'), v('colNotOk')],
      a.tool_calls.map((c) => [c.family, c.calls, c.ok, c.refused + c.error]), v('empty'))}`;
}

/** A behaviour finding in the reader's language, from its fields (the server's line is English, for the AI). */
function findingLine(f) {
  const screen = v(`screen.${f.vc}`);
  const key = f.kind === 'dead' ? 'findDead' : f.kind === 'rage' ? 'findRage' : 'findScroll';
  return v(key)
    .replace('{Screen}', screen.charAt(0).toUpperCase() + screen.slice(1))
    .replace('{screen}', screen)
    .replace('{n}', f.count)
    .replace('{element}', f.element || '');
}

function Apps({ b, onFix, fixing }) {
  return html`
    <${SubHeading} level=${3} desc=${v('appsWhy')}>${v('appsTitle')}<//>
    ${b.apps.length ? null : html`<${Note} kind="quiet">${v('emptyApps')}<//>`}
    ${b.apps.map((a) => html`
      <${Space} key=${a.app} below="large">
        <${SubHeading} level=${4} desc=${v('appLine').replace('{views}', a.views).replace('{dead}', a.dead_clicks.reduce((n, d) => n + d.clicks, 0)).replace('{rage}', a.rage_clicks.reduce((n, d) => n + d.clicks, 0))}>${a.app}<//>
        ${a.findings.map((f, i) => html`<${Note} key=${i} kind="aside" size="small">${findingLine(f)}<//>`)}
        ${a.findings.length ? html`
          <${Line} gap="small">
            <${Action} small disabled=${fixing === a.app} onClick=${() => onFix(a.app)}>${fixing === a.app ? v('fixing') : v('fixNow')}<//>
          <//>` : null}
      <//>`)}
    <${Note} kind="hint" size="note">${v('appsPrivacy')}<//>`;
}

function Settings({ s, bs, apps, onSave }) {
  const [clarity, setClarity] = useState(s.clarity_project_id || '');
  const [ga4, setGa4] = useState(s.ga4_measurement_id || '');
  return html`
    <${SubHeading} level=${3} desc=${v('countingWhy')}>${v('countingTitle')}<//>
    <${Check} checked=${s.enabled} onChange=${(on) => onSave('settings', { enabled: on })}>${v('countingOn')}<//>
    ${s.node_enabled ? null : html`<${Note} kind="quiet">${v('nodeOff')}<//>`}

    <${SubHeading} level=${3} desc=${v('tagsWhy')}>${v('tagsTitle')}<//>
    <${TextField} label=${v('clarityLabel')} value=${clarity} onInput=${setClarity} />
    <${TextField} label=${v('ga4Label')} value=${ga4} onInput=${setGa4} />
    <${Line} gap="small">
      <${Action} small onClick=${() => onSave('settings', { clarity_project_id: clarity.trim() || null, ga4_measurement_id: ga4.trim() || null })}>${v('saveTags')}<//>
    <//>
    ${s.tags_warning ? html`<${Note} kind="aside" size="small">${v('tagsWarning')}<//>` : null}

    <${SubHeading} level=${3} desc=${v('behaviourWhy')}>${v('behaviourTitle')}<//>
    ${apps.map((name) => html`
      <${Check} key=${name} checked=${!bs.off_apps.includes(name)} onChange=${(on) => onSave('behaviour', { app: name, app_enabled: on })}>${name}<//>`)}

    <${SubHeading} level=${3} desc=${v('fixerWhy')}>${v('fixerTitle')}<//>
    <${Check} checked=${bs.fixer} onChange=${(on) => onSave('behaviour', { fixer: on })} hint=${v('fixerHint')}>${v('fixerOn')}<//>
    ${bs.runs?.length ? html`
      <${SubHeading} level=${4}>${v('runsTitle')}<//>
      ${table([v('colApp'), v('colWhen'), v('colDraft')],
        bs.runs.map((run) => [run.app, run.at.slice(0, 16).replace('T', ' '), run.draft ? v('draftYes') : (run.note || v('draftNo'))]), v('empty'))}` : null}`;
}

export default function VisibilityTab() {
  const [part, setPart] = useState('people');
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [behaviour, setBehaviour] = useState(null);
  const [settings, setSettings] = useState(null);
  const [bSettings, setBSettings] = useState(null);
  const [apps, setApps] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fixing, setFixing] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [r, b, s, bs, mine] = await Promise.all([
        apiGet(`/v1/visibility/report?days=${days}`),
        apiGet(`/v1/visibility/behaviour?days=${Math.min(days, 56)}`),
        apiGet('/v1/visibility/settings'),
        apiGet('/v1/visibility/behaviour/settings'),
        // Every app of the owner, so one with no visits yet can be switched off before it has any.
        apiGet('/v1/apps?mine=1&limit=200'),
      ]);
      setReport(r?.data ?? null);
      setBehaviour(b?.data ?? null);
      setSettings(s?.data ?? null);
      setBSettings(bs?.data ?? null);
      setApps((mine?.data?.apps ?? []).map((a) => a.filename).filter(Boolean).sort());
    } catch (err) {
      swallowed('visibility-tab: load failed', err);
      setError(err?.message || v('loadFailed'));
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const save = async (which, body) => {
    setMessage('');
    try {
      await apiPut(which === 'settings' ? '/v1/visibility/settings' : '/v1/visibility/behaviour/settings', body);
      setMessage(v('saved'));
      await load();
    } catch (err) {
      swallowed('visibility-tab: save failed', err);
      setError(err?.message || v('saveFailed'));
    }
  };

  const fix = async (app) => {
    if (!window.confirm(v('fixConfirm').replace('{app}', app))) return;
    setFixing(app);
    setMessage('');
    try {
      const res = await apiPost('/v1/visibility/behaviour/fix', { app });
      const run = res?.data;
      setMessage(run?.draft ? v('fixDone').replace('{app}', app) : (run?.note || v('draftNo')));
      await load();
    } catch (err) {
      swallowed('visibility-tab: fix failed', err);
      setError(err?.message || v('saveFailed'));
    } finally {
      setFixing('');
    }
  };

  const controls = html`
    <${Line} wrap align="start" justify="between" gap="medium" below="large">
      <${Tabs} tone="filter" label=${v('partLabel')} value=${part} onSelect=${setPart}
        items=${PARTS.map((p) => ({ value: p, label: v(`part.${p}`) }))} />
      ${part === 'settings' ? null : html`
        <${Tabs} tone="filter" label=${v('periodLabel')} value=${days} onSelect=${setDays}
          items=${PERIODS.map((d) => ({ value: d, label: v('days').replace('{n}', d) }))} />`}
    <//>`;

  const ready = report && behaviour && settings && bSettings;
  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuBusiness'), t('profile.tabs.visibility')]}
      title=${v('title')}
      desc=${v('intro')}>
      ${controls}
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${message ? html`<${Note} kind="message">${message}<//>` : null}
      ${!ready && !error ? html`<${Note} kind="loading">${v('loading')}<//>` : null}
      ${ready && !report.counting && part !== 'settings' ? html`<${Note} kind="quiet">${v('countingOff')}<//>` : null}
      ${ready ? html`<${TabPanel} value=${`${part}-${days}`} label=${v(`part.${part}`)}>
        ${part === 'people' ? html`<${People} r=${report} />` : null}
        ${part === 'ai' ? html`<${Ai} r=${report} />` : null}
        ${part === 'purchases' ? html`<${Purchases} r=${report} />` : null}
        ${part === 'agents' ? html`<${Agents} r=${report} />` : null}
        ${part === 'apps' ? html`<${Apps} b=${behaviour} onFix=${fix} fixing=${fixing} />` : null}
        ${part === 'settings' ? html`<${Settings} s=${settings} bs=${bSettings} apps=${apps} onSave=${save} />` : null}
      <//>` : null}
    <//>`;
}
