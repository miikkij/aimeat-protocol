/**
 * @file public/views/admin/aml-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin › Customer due diligence (`aml`): the operator's view of the customer due
 *   diligence (KYC) that obliged organisms do on this server. The facts are GET /v1/admin/kyc
 *   (services/kyc/overview.ts kycOperatorView): the sanctions lists and their freshness, and per
 *   organism the counts of its customer cards. The answer never names a customer and never counts
 *   suspicions (AMLR art. 73), and the page says so in one line.
 *
 *   In order: 01 the figures summed over the organisms; 02 the sanctions lists, one row per source,
 *   with "Fetch the lists now" (POST /v1/admin/kyc/lists/refresh) and its answer as one line per
 *   source; 03 the organisms, an organism with cards and no officer marked as a finding; 04 which AI
 *   may read customer due diligence data (compliance.kyc_ai). The settings open on the Config page
 *   searched on their key (config-tab.js reads ?q=). Re-read on every `aimeat-live-update`.
 *   Made of the component kit: it passes data and never a class.
 * @structure SOURCE_ORDER · sourcesValue · totalsOf · countWords · toSetting · AmlAdminTab (default)
 * @usage Registered in views/admin.js NAV_GROUPS as the `aml` page.
 * @version-history
 *   v1.0.2 — 2026-11-19 — The organisms list says each column's name on a phone (`labels`); a card's
 *     status and risk in the KYC page's words (kyc.status.*, kyc.risk.*).
 *   v1.0.1 — 2026-11-19 — The answers are read from the envelope's `data`; settings in words, the key
 *     beside them as the identifier.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime, num } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, Num, Cell } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { Facts } from '/components/Facts.js';
import { ErrorNote } from '/components/ErrorNote.js';

const html = htm.bind(h);
/** The page's words: admin.aml.<key>. */
const X = (key, vars) => t('admin.aml.' + key, vars);
const XOr = (key, fallback, vars) => tOr('admin.aml.' + key, fallback, vars);
const SOURCE_ORDER = ['eu-fsf', 'un'];
/** The hosts of the official addresses (services/kyc/screening/store.ts SOURCE_URLS). */
const OFFICIAL_HOSTS = ['webgate.ec.europa.eu', 'scsanctions.un.org'];

/** The value of compliance.kyc_sanctions_sources in words: official, none or other addresses. */
export function sourcesValue(sources, lists) {
  if (!sources.length) return 'none';
  const hostOf = (u) => (URL.canParse(u) ? new URL(u).hostname : '');
  return (lists || []).some((l) => l.url && !OFFICIAL_HOSTS.includes(hostOf(l.url))) ? 'other' : 'official';
}
const STATUS_ORDER = ['open', 'active', 'blocked', 'ended'];
const RISK_ORDER = ['low', 'medium', 'high', 'prohibited', 'none'];

/** The figures of section 01, summed over the organisms. */
export function totalsOf(view) {
  const orgs = view?.organisms || [];
  const sum = (k) => orgs.reduce((a, o) => a + (Number(o[k]) || 0), 0);
  return { organisms: orgs.length, cards: sum('cards'), due: sum('due'), openHits: sum('openHits'), notScreened: sum('notScreened') };
}

/** "active 3 · open 1" from a count map, in a fixed order, with the page's words. */
export function countWords(map, order, prefix) {
  const keys = [...order, ...Object.keys(map || {}).filter((k) => !order.includes(k))];
  return keys.filter((k) => (map || {})[k] > 0).map((k) => `${tOr(prefix + k, k)} ${map[k]}`).join(' · ');
}

/** Open the Config page searched on one setting. */
function toSetting(switchPage, key) {
  const url = new URL(window.location.href);
  url.searchParams.set('q', key);
  history.replaceState(null, '', url);
  switchPage?.('config');
}

/** The answer of "Fetch the lists now", one line per source and the new hits. */
function RefreshResult({ result }) {
  if (!result) return null;
  const lines = (result.lists || []).map((l) => {
    const name = XOr('source.' + l.source, l.source);
    if (l.error) return X('refresh.error', { source: name, error: l.error });
    return l.changed ? X('refresh.changed', { source: name, entries: num(l.entries ?? 0), version: l.version || '–' })
      : X('refresh.unchanged', { source: name });
  });
  if (!lines.length) lines.push(X('refresh.noSources'));
  lines.push(X('refresh.flagged', { n: String(result.flagged ?? 0) }));
  return html`${lines.map((line, i) => html`<${Note} key=${String(i)}>${line}<//>`)}`;
}

export default function AmlAdminTab({ switchPage }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      // api() answers with the envelope; the overview is its `data`.
      setView((await apiGet('/v1/admin/kyc'))?.data || null);
      setError('');
    } catch (err) {
      swallowed('admin aml: load', err);
      setError(err?.message || X('loadFailed'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(null, () => load()), [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      setResult((await apiPost('/v1/admin/kyc/lists/refresh', {}))?.data || { lists: [], flagged: 0 });
      await load();
    } catch (err) {
      swallowed('admin aml: refresh lists', err);
      setResult({ lists: [], flagged: 0, failed: err?.message || X('refresh.failed') });
    }
    setBusy(false);
  };

  if (error && !view) return html`<${ErrorNote} text=${error} />`;
  if (!view) return html`<${Note} kind="quiet">${X('loading')}<//>`;

  const tot = totalsOf(view);
  const lists = view.lists || [];
  const sources = [...new Set([...(view.sources || []), ...lists.map((l) => l.source)])]
    .sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
  const ai = view.ai || 'local';
  const mode = view.mode || 'report';
  const settingDoor = (key) => html`<${Action} small soft onClick=${() => toSetting(switchPage, key)}>${X('changeSetting')}<//>`;

  return html`
    <${Section} id="adm-aml-01" num="01" title=${X('now.title')} first>
      <${FigureStrip} wrap items=${[
        { key: 'organisms', n: String(tot.organisms), label: X('fig.organisms'), sub: X('fig.organismsSub') },
        { key: 'cards', n: String(tot.cards), label: X('fig.cards'), sub: X('fig.cardsSub') },
        { key: 'due', n: String(tot.due), label: X('fig.due'), sub: X('fig.dueSub'), tone: tot.due ? 'notice' : undefined },
        { key: 'hits', n: String(tot.openHits), label: X('fig.hits'), sub: X('fig.hitsSub'), tone: tot.openHits ? 'notice' : undefined },
        { key: 'notScreened', n: String(tot.notScreened), label: X('fig.notScreened'), sub: X('fig.notScreenedSub'), tone: tot.notScreened ? 'notice' : undefined },
      ]} />
      <${Note}>${X('modeLine', { mode: t('admin.compliance.aml.mode.' + mode) })}<//>
      <${Note} kind="quiet">${X('privacy')}<//>
    <//>

    <${Section} id="adm-aml-02" num="02" title=${X('lists.title')}
      doors=${html`<${Loud} control disabled=${busy || !sources.length} onClick=${refresh}>${X(busy ? 'refresh.busy' : 'refresh.action')}<//>`}>
      <${Note} kind="lead">${X('lists.lead')}<//>
      <${List} cols="name-desc-code-n" head=${[X('col.source'), X('col.fetched'), X('col.version'), { label: X('col.entries'), num: true }]}
        empty=${X('lists.none')}>
        ${sources.map((s) => {
          const meta = lists.find((l) => l.source === s);
          return html`<${Row} key=${s} rail=${meta ? undefined : 'warn'}>
            <${Name} meta=${meta?.url || undefined} clip>${XOr('source.' + s, s)}<//>
            <${Desc}>${meta ? dateTime(meta.fetchedAt) : X('lists.notFetched')}<//>
            <${Cell} meta clip>${meta?.version || '–'}<//>
            <${Num}>${meta ? num(meta.entries) : '–'}<//>
          <//>`;
        })}
      <//>
      ${result?.failed ? html`<${Note} error>${result.failed}<//>` : html`<${RefreshResult} result=${result} />`}
      <${Facts} rows=${[{
        k: X('lists.setting'),
        v: X('lists.value.' + sourcesValue(sources, lists)),
        sub: html`${sources.length ? X('lists.settingOn', { sources: sources.map((s) => XOr('source.' + s, s)).join(', ') }) : X('lists.settingOff')}
          <${Code}>compliance.kyc_sanctions_sources<//>`,
        action: settingDoor('compliance.kyc_sanctions_sources'),
      }]} />
    <//>

    <${Section} id="adm-aml-03" num="03" title=${X('orgs.title')}>
      <${List} cols="name-n-n-n-n-n-state" labels
        head=${[X('col.organism'), { label: X('col.cards'), num: true }, { label: X('col.due'), num: true },
          { label: X('col.hits'), num: true }, { label: X('col.notScreened'), num: true }, { label: X('col.officers'), num: true }, X('col.state')]}
        empty=${X('orgs.none')}>
        ${(view.organisms || []).map((o) => {
          const noOfficer = o.cards > 0 && !o.officers;
          // The KYC page's own words for a card's status and risk (kyc.status.*, kyc.risk.*).
          const status = countWords(o.byStatus, STATUS_ORDER, 'kyc.status.');
          const risk = countWords(o.byRisk, RISK_ORDER, 'kyc.risk.');
          return html`<${Row} key=${o.id} rail=${noOfficer ? 'warn' : undefined}>
            <${Name} desc=${status ? X('orgs.byStatus', { list: status }) : undefined}
              meta=${risk ? X('orgs.byRisk', { list: risk }) : undefined}
              note=${noOfficer ? X('orgs.noOfficer') : undefined}>${o.name}<//>
            <${Num}>${num(o.cards)}<//>
            <${Num} sign=${o.due > 0}>${num(o.due)}<//>
            <${Num} sign=${o.openHits > 0}>${num(o.openHits)}<//>
            <${Num} sign=${o.notScreened > 0}>${num(o.notScreened)}<//>
            <${Num}>${num(o.officers)}<//>
            <${Cell}>${noOfficer
              ? html`<${Mark} kind="status" tone="attention">${X('mark.noOfficer')}<//>`
              : html`<${Mark} kind="status" tone=${o.openHits || o.due ? 'attention' : 'fine'}>${X(o.openHits || o.due ? 'mark.look' : 'mark.fine')}<//>`}<//>
          <//>`;
        })}
      <//>
    <//>

    <${Section} id="adm-aml-04" num="04" title=${X('ai.title')}>
      <${Facts} rows=${[{
        k: X('ai.setting'),
        v: html`<${Mark} kind="status" tone=${ai === 'node' ? 'attention' : 'fine'}>${tOr('dashboard.cfgOpt_compliance_kyc_ai_' + ai, XOr('ai.value.' + ai, ai))}<//>`,
        sub: html`${XOr('ai.meaning.' + ai, '')} <${Code}>compliance.kyc_ai<//>`,
        action: settingDoor('compliance.kyc_ai'),
      }]} />
      <${Note} kind="quiet">${X('ai.ownAi')}<//>
    <//>`;
}
