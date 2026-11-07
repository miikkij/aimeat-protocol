/**
 * @file public/views/admin/receivers-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's page Receivers (design canvas "Vastaanottimet", artboard Admin): every
 *   address on this node through which an outside program writes into an owner's data. The counts
 *   (active, writes and refusals today, wrong keys, waiting), the node setting
 *   visibility.receivers_mode in words with the way to the Config page where it is changed, the
 *   receivers waiting for the operator's decision, and every receiver with its owner, with Stop
 *   (a reason the owner reads is required) and Start. Over GET /v1/admin/receivers and POST
 *   /v1/admin/receivers/{owner}/{name}/stop|start|decide, the routes the MCP tool
 *   aimeat_admin_receivers calls. The operator never sees a message's content or a key. Drawn from
 *   the library components the admin pages use since 2026-09-27; the file writes no class.
 * @structure ReceiversAdminTab · Strip · ModeSection · WaitingSection · WaitingItem · AllSection · StopDialog
 * @usage registered in admin.js NAV_GROUPS as id 'receivers' (group navNode, after internet-openings).
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { ago, date, dateTime } from '/js/format.js';
import { apiGet, apiPost } from '/js/api.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { useConfirm, Modal } from '/components/Modal.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, Num, When, Cell, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Stack } from '/components/Layout.js';
import { swallowed } from '/js/swallowed.js';
import { targetWords, shapeWords, stateTone, limitsWords, verbsWords } from '../profile/receivers/frame.js';

const html = htm.bind(h);
/** One word of this page. */
const O = (key, params) => t('receivers.admin.' + key, params);
/** A state as the operator reads it ("Waiting for you" is the operator's decision, not the owner's). */
const stateWord = (state) => O('state.' + (state || 'active'));
const enc = encodeURIComponent;

/** The tools the operator's own AI reads and decides the same list with. */
const AI_TOOLS = ['aimeat_admin_receivers'];
const MODES = ['self', 'operator', 'off'];

function Strip({ counts, toSection }) {
  return html`<${FigureStrip} wrap items=${[
    { key: 'active', n: num(counts.active), label: O('strip.active'), sub: O('strip.activeSub', { n: num(counts.owners) }), onClick: () => toSection('adm-rc-all') },
    { key: 'writes', n: num(counts.writes_today), label: O('strip.writes'), sub: O('strip.writesSub') },
    { key: 'refused', n: num(counts.refused_today), label: O('strip.refused'), sub: O('strip.refusedSub'), tone: counts.refused_today > 0 ? 'warn' : undefined },
    { key: 'keys', n: num(counts.wrong_keys), label: O('strip.wrongKeys'), sub: O('strip.wrongKeysSub'), tone: counts.wrong_keys > 0 ? 'notice' : undefined },
    { key: 'waiting', n: num(counts.waiting), label: O('strip.waiting'), sub: O('strip.waitingSub'), tone: counts.waiting > 0 ? 'notice' : undefined, onClick: () => toSection('adm-rc-waiting') },
  ]} />`;
}

/** The node setting in words, and the way to the Config page, searched for it. */
function ModeSection({ number, mode, configured, toConfig }) {
  return html`
    <${Section} id="adm-rc-mode" num=${number} title=${O('mode.title')}
      doors=${html`<${Action} small soft onClick=${toConfig}>${O('mode.toConfig')}<//>`}>
      <${Note} kind="lead">${O('mode.lead')}<//>
      <${Facts} wide rows=${[
        { key: 'now', k: O('mode.now'), v: O('mode.' + mode), sub: O('mode.configured', { value: configured || 'auto' }) },
        ...MODES.map((m) => ({ key: m, k: O('mode.' + m), v: O('mode.' + m + 'Hint'), state: m === mode ? 'fine' : 'off' })),
      ]} />
      <${Note} kind="hint">${O('mode.setting')} <${Code}>visibility.receivers_mode<//> · <${Code}>AIMEAT_RECEIVERS_MODE<//><//>
    <//>`;
}

function WaitingItem({ r, onDecide }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (decision) => { setBusy(true); await onDecide(r, decision, reason.trim()); setBusy(false); };
  return html`
    <${Box} tone="waiting" name=${r.display_name || r.name} marks=${html` <${Code}>${r.owner}/${r.name}<//>`}
      end=${html`<${Mark} kind="status" tone="attention">${stateWord(r.state)}<//>`}
      doors=${html`
        <${Loud} control disabled=${busy} onClick=${() => go('approve')}>${O('approve')}<//>
        <${Action} small tone="danger" disabled=${busy} onClick=${() => go('refuse')}>${O('refuse')}<//>`}>
      <${Facts} rows=${[
        { key: 'owner', k: O('col.owner'), v: r.owner },
        { key: 'target', k: O('f.target'), v: targetWords(r.target) },
        { key: 'shape', k: O('f.shape'), v: shapeWords(r), warn: !r.schema },
        { key: 'verbs', k: O('f.verbs'), v: verbsWords(r.verbs), mono: true },
        { key: 'limits', k: O('f.limits'), v: limitsWords(r.limits) },
        { key: 'asked', k: O('f.asked'), v: dateTime(r.approved_at || r.created_at) },
        { key: 'until', k: O('f.until'), v: date(r.expires_at) },
      ]} />
      <${Fields}>
        <${TextField} label=${O('refuseReason')} hint=${O('refuseReasonHint')} value=${reason} maxLength=${500} onInput=${setReason} />
      <//>
    <//>`;
}

function WaitingSection({ number, list, onDecide }) {
  const waiting = list.filter((r) => r.state === 'awaiting_operator');
  return html`
    <${Section} id="adm-rc-waiting" num=${number} title=${O('waiting.title')} count=${waiting.length ? num(waiting.length) : undefined}>
      <${Note} kind="lead">${O('waiting.lead')}<//>
      ${waiting.length === 0
        ? html`<${Note} kind="quiet">${O('waiting.none')}<//>`
        : html`<${Stack} gap="medium">${waiting.map((r) => html`<${WaitingItem} key=${r.uid} r=${r} onDecide=${onDecide} />`)}<//>`}
    <//>`;
}

function AllSection({ number, list, onStop, onStart }) {
  return html`
    <${Section} id="adm-rc-all" num=${number} title=${O('all.title')} count=${num(list.length)}>
      <${List} cols="name-who-state-count-when-doors" labels
        head=${[O('col.name'), O('col.owner'), O('col.state'), { label: O('col.today'), num: true }, O('col.last'), '']}
        empty=${html`<${Note} kind="quiet">${O('all.none')}<//>`}
        rows=${list} render=${(r) => html`
          <${Row} key=${r.owner + '/' + r.uid} faded=${r.state === 'paused' || r.state === 'expired'}>
            <${Name} meta=${`${targetWords(r.target)} · ${shapeWords(r)}`} desc=${r.state === 'stopped' && r.stop_reason ? O('stoppedBecause', { reason: r.stop_reason }) : undefined}
              note=${r.refused_today ? O('refusedToday', { n: num(r.refused_today) }) : undefined}>${r.display_name || r.name}<//>
            <${Who} sub=${r.name}>${r.owner}<//>
            <${Cell}><${Mark} kind="status" tone=${stateTone(r.state)}>${stateWord(r.state)}<//><//>
            <${Num} title=${O('todayLine', { n: num(r.delivered_today || 0), refused: num(r.refused_today || 0) })}>${num(r.delivered_today || 0)}<//>
            <${When}>${r.last_delivery_at ? ago(r.last_delivery_at) : O('never')}<//>
            <${Doors}>${r.state === 'stopped'
              ? html`<${Action} small row onClick=${() => onStart(r)}>${O('start')}<//>`
              : html`<${Action} small row tone="danger" onClick=${() => onStop(r)}>${O('stop')}<//>`}<//>
          <//>`} />
    <//>`;
}

function StopDialog({ r, onClose, onStop }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 3;
  const go = async () => { if (!ok) return; setBusy(true); const done = await onStop(r, reason.trim()); setBusy(false); if (done) onClose(); };
  const footer = html`
    <${Action} onClick=${onClose}>${O('cancel')}<//>
    <${Loud} control danger disabled=${!ok || busy} onClick=${go}>${O('stop')}<//>`;
  return html`
    <${Modal} open onClose=${onClose} title=${O('stopTitle', { name: r.display_name || r.name })} size="sm" footer=${footer}>
      <${Stack} gap="medium">
        <${Note} kind="lead">${O('stopLead', { owner: r.owner })}<//>
        <${Fields}>
          <${TextField} label=${O('stopReason')} hint=${O('stopReasonHint')} value=${reason} maxLength=${500} autoFocus
            invalid=${reason.length > 0 && !ok} onInput=${setReason} onEnter=${go} />
        <//>
      <//>
    <//>`;
}

export default function ReceiversAdminTab({ data, switchPage }) {
  const [res, setRes] = useState(null);
  const [failed, setFailed] = useState(false);
  const [stopping, setStopping] = useState(null);
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/admin/receivers');
      setRes(r.data);
      setFailed(false);
    } catch (e) { swallowed('admin receivers: list', e); setFailed(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['receivers', 'config'], () => load()), [load]);

  const toSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // The Config page reads its search from the address when it opens (config-tab.js, `q`).
  const toConfig = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('q', 'visibility.receivers_mode');
    history.replaceState(null, '', url);
    switchPage?.('config');
  };

  const write = async (fn, word) => {
    try { await fn(); showOk(word); await load(); return true; }
    catch (e) { swallowed('admin receivers: write', e); showErr((e && e.message) || t('common.error')); return false; }
  };
  const path = (r, act) => `/v1/admin/receivers/${enc(r.owner)}/${enc(r.name)}/${act}`;
  const nameOf = (r) => r.display_name || r.name;
  const decide = (r, decision, reason) => write(() => apiPost(path(r, 'decide'), { decision, ...(reason ? { reason } : {}) }),
    O(decision === 'approve' ? 'approved' : 'refused', { name: nameOf(r), owner: r.owner }));
  const stop = (r, reason) => write(() => apiPost(path(r, 'stop'), { reason }), O('stopped', { name: nameOf(r), owner: r.owner }));
  const start = (r) => confirm(O('startAsk', { name: nameOf(r), owner: r.owner }),
    () => write(() => apiPost(path(r, 'start'), {}), O('started', { name: nameOf(r), owner: r.owner })),
    { title: O('start'), confirmLabel: O('start') });

  if (!res) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      ${failed ? html`<${Note} kind="quiet">${O('loadFailed')}<//>` : html`<${Spinner} />`}`;
  }
  const configured = data?.configSchema?.schema?.['visibility.receivers_mode']?.value;
  return html`
    <${ConfirmUI} />${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    ${stopping ? html`<${StopDialog} r=${stopping} onClose=${() => setStopping(null)} onStop=${stop} />` : null}
    <${Note} kind="lead">${O('lead')}<//>
    <${Strip} counts=${res.counts} toSection=${toSection} />
    <${ModeSection} number="01" mode=${res.mode} configured=${configured} toConfig=${toConfig} />
    <${WaitingSection} number="02" list=${res.receivers} onDecide=${decide} />
    <${AllSection} number="03" list=${res.receivers} onStop=${(r) => setStopping(r)} onStart=${start} />
    <${Note} kind="aside" size="small">
      <b>${O('stopNoteTitle')}</b> ${O('stopNote')}
    <//>
    <${Note} kind="aside" size="small">
      <b>${O('ai.title')}</b> ${O('ai.text')}
      <${Marks}>${AI_TOOLS.map((n) => html`<${Code} key=${n}>${n}<//>`)}<//>
    <//>`;
}
