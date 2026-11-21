/**
 * @file public/views/profile/data-wallet/content-risk.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data Wallet's section "Marked content" (wish
 *   wish-riskimerkinn-t-oma-sis-lt-ei-merkitse-ja-ihminen-voi-hyv-ksy, plan
 *   docs/internal/content-risk-accept-plan.md). The node marks text from someone else that may try to
 *   steer an AI, beside the text and never in it, and the risk notice links here. This section lists
 *   what the person decides (GET /v1/content/risk/items: their own items and those of the workspaces
 *   they run), shows where each item is and the phrase each mark found, and holds the three decisions:
 *   accept (the text is meant to be so, such as a security team's exercise; POST
 *   /v1/content/risk/accept), take an acceptance back (POST /v1/content/risk/unaccept) and release a
 *   held item to other people's AIs (POST /v1/content/risk/release). The account holder in person holds
 *   every word these need, so the page calls the routes the AI's tool calls (aimeat_content_risk).
 *
 *   LIVE. The section reads again on the change domains `contentclass` and `memory` (the person's facts
 *   and risk records), and after each decision. Nothing here runs on a timer.
 *
 *   OFF. When the operator turned the marks off, the list answers 404 and the section says so in one
 *   line. An accept the operator forbids (content_risk.accept deny) answers ACCEPT_OFF, which the toast
 *   shows as the server worded it.
 * @structure useContentRisk() → risk · riskCount(risk) · secContentRisk(ctx, num)
 * @usage const risk = useContentRisk({ federated, confirm, toast }); … secContentRisk({ ...ctx, risk }, '08')
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial (wish-riskimerkinn-t-oma-sis-lt-ei-merkitse-ja-ihminen-voi-hyv-ksy).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { Section } from '/components/Section.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { HelpTip } from '/components/HelpTip.js';
import { Facts } from '/components/Facts.js';
import { n, dateWord, whoOf, wsName } from './frame.js';

const html = htm.bind(h);
const cr = (key, vars) => t('dwpage.cr.' + key, vars);
const STATUSES = ['open', 'held', 'accepted'];
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || fallback;

/**
 * The section's reads and decisions: every item the person decides, and accept, unaccept and release.
 * @param {{ federated: boolean, confirm: Function, toast: (m: string, err?: boolean) => void }} deps
 */
export function useContentRisk({ federated, confirm, toast }) {
  const [items, setItems] = useState(null);
  const [off, setOff] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (federated) return;
    try {
      const r = await apiGet('/v1/content/risk/items');
      setItems(r?.data?.items || []);
      setOff(false);
      setFailed(false);
    } catch (e) {
      if (e?.status === 404) { setOff(true); setItems([]); return; }
      swallowed('data-wallet: content risk items', e);
      setFailed(true);
    }
  }, [federated]);

  useEffect(() => { load(); }, [load]);
  const again = useRef(null);
  again.current = load;
  useEffect(() => onLiveUpdate(['contentclass', 'memory'], () => again.current()), []);

  /** One decision on one item, then the list as it now stands. */
  const decide = async (item, action, done) => {
    setBusy(item.ref);
    try {
      await apiPost(`/v1/content/risk/${action}`, { ref: item.ref });
      toast(cr(done));
      await load();
    } catch (e) { toast(errText(e, cr('failed')), true); }
    setBusy(null);
  };
  const accept = (item) => confirm(cr('confirmAccept'), () => decide(item, 'accept', 'accepted'));
  const unaccept = (item) => decide(item, 'unaccept', 'unaccepted');
  const release = (item) => confirm(cr('confirmRelease'), () => decide(item, 'release', 'released'));

  return { items, off, failed, filter, setFilter, busy, accept, unaccept, release };
}

/* ── The render ───────────────────────────────────────────────────────────────────────────────── */

/** The word beside the section's title and in the rail: how many items wait for a decision. */
export function riskCount(risk) {
  if (!risk?.items) return '';
  if (risk.off) return cr('notInUse');
  const waiting = risk.items.filter((it) => it.status !== 'accepted').length;
  return waiting ? cr('waitingN', { n: n(waiting) }) : cr('noneWaiting');
}

/** Where the item is, in the reader's words, from the id its marks are kept under. */
function placeWords(item, names) {
  const id = String(item.subject_id || '');
  const inWs = item.where?.kind === 'workspace';
  const ws = inWs ? wsName(names, item.where.organism_id, item.where.ws) : '';
  if (id.startsWith('memory:')) {
    if (inWs) return cr('place.document', { ws });
    return cr('place.memory', { key: id.split(':').slice(2).join(':') });
  }
  if (id.startsWith('file:')) return cr('place.file', { key: id.split(':').slice(2).join(':') });
  if (id.startsWith('comment:')) return cr('place.comment', { ws });
  if (id.startsWith('row:')) return cr('place.row', { space: id.split(':')[1] || '', ws });
  if (id.startsWith('dm:')) return cr('place.dm');
  if (id.startsWith('board:')) return cr('place.board');
  if (id.startsWith('agent-message:')) return cr('place.agentMessage');
  return item.place || id;
}

/** The phrases each mark found: what the person reads before deciding. */
function phrases(item) {
  if (item.changed) return html`<${Note} kind="hint">${cr('changed')}<//>`;
  const list = item.phrases || [];
  if (!list.length) return html`<${Note} kind="hint">${cr('noPhrases')}<//>`;
  return html`<${Facts} flush rows=${list.map((m) => ({
    k: cr('kind.' + m.kind),
    v: m.excerpt ? cr('quoted', { text: m.excerpt }) : cr('noExcerpt'),
    ...(m.accepted ? { sub: cr('isAccepted') } : {}),
  }))} />`;
}

function itemRow(risk, item, names) {
  const busy = risk.busy === item.ref;
  const who = item.written_by ? whoOf(item.written_by, names).name : null;
  const kinds = (item.kinds || []).map((k) => cr('kind.' + k)).join(', ');
  const meta = item.status === 'accepted' && item.accepted
    ? cr('acceptedBy', { who: whoOf(item.accepted.by, names).name, date: dateWord(item.accepted.at) })
    : who ? cr('writtenBy', { who, date: dateWord(item.since) }) : cr('markedOn', { date: dateWord(item.since) });
  return html`
    <${Row} key=${item.ref} below=${phrases(item)}>
      <${Name} meta=${cr('status.' + item.status)} desc=${meta}>${placeWords(item, names)}<//>
      <${Desc}>${kinds || cr('allAccepted')}<//>
      <${Doors}>
        ${item.status !== 'accepted' ? html`<${Action} small soft disabled=${busy} onClick=${() => risk.accept(item)}>${cr('accept')}<//>` : null}
        ${item.status === 'held' ? html`<${Action} small soft disabled=${busy} onClick=${() => risk.release(item)}>${cr('release')}<//>` : null}
        ${item.accepted ? html`<${Action} small soft disabled=${busy} onClick=${() => risk.unaccept(item)}>${cr('unaccept')}<//>` : null}
      <//>
    <//>`;
}

/** The section. `num` is its number on the page. */
export function secContentRisk(ctx, num) {
  const risk = ctx.risk;
  const lead = html`<${Note} kind="lead">${cr('lead')} <${HelpTip} term="content.risk_mark" label=${cr('term')} /><//>`;
  if (!risk.items) {
    return html`<${Section} id="dw-risk" num=${num} title=${cr('title')}>${lead}${risk.failed
      ? html`<${Note} kind="quiet">${cr('loadFailed')}<//>` : html`<${Note} kind="loading">${t('dwpage.loading')}<//>`}<//>`;
  }
  if (risk.off) return html`<${Section} id="dw-risk" num=${num} title=${cr('title')} count=${riskCount(risk)}>${lead}<${Note} kind="quiet">${cr('off')}<//><//>`;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, risk.items.filter((it) => it.status === s).length]));
  const shown = risk.items.filter((it) => it.status === risk.filter);
  const names = ctx.names;
  return html`
    <${Section} id="dw-risk" num=${num} title=${cr('title')} count=${riskCount(risk)}>
      ${lead}
      <${Tabs} tone="filter" value=${risk.filter} onSelect=${(v) => risk.setFilter(v)}
        items=${STATUSES.map((s) => ({ value: s, label: cr('filter.' + s), count: n(counts[s]) }))} />
      <${List} cols="name-desc-doors" labels head=${[cr('col.item'), cr('col.marks'), '']}
        empty=${cr('empty.' + risk.filter)} rows=${shown} render=${(it) => itemRow(risk, it, names)} />
      <${Note} kind="hint">${cr('hint')}<//>
    <//>`;
}
