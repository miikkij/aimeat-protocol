/**
 * @file public/views/profile/data-wallet/classification-exceptions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exceptions list of classification (TARGET-082, Jouni's decisions of 2026-09-30),
 *   drawn in two places: the Data Wallet's classification section (the person's own list, level
 *   owner, and the dialog that makes an exception from one of their classified items) and the admin
 *   Security page's classification section (the whole server's list, level node, for an operator).
 *   One row is one exception: the item, what it let happen in words with the reason under it, who
 *   made it (a person, or an app for an automatic one) with when and whether it is still in force,
 *   and "Withdraw exception" for a person's exception in force. The filters are all, made by
 *   people, and automatic by apps. A person's exception lets one item leave ('leave') or lets an AI
 *   see it and send it out ('ai-send') despite its classification, with a written reason and an
 *   optional last day; an app's automatic exception records an act and grants nothing.
 *   useExceptions holds the read and the handlers; exceptionsGroup and exceptionDialog are the
 *   render, on the page kit's own components.
 * @structure useExceptions({ level, off, confirm, ok, fail }) → ex · exceptionsGroup(ex, { admin }) ·
 *   exceptionDialog(ex) · exceptionRow · actMarks · scopeWords · stateWords · whoWords · untilIso · today
 * @usage
 *   const ex = useExceptions({ level: 'owner', off: federated, confirm, ok: toast, fail: (m) => toast(m, true) });
 *   html`${exceptionsGroup(ex)}${exceptionDialog(ex)}`; ex.open(item) opens the dialog for an explorer item.
 * @version-history
 *   v1.2.0 — 2026-10-02 — The question mark that explains an exception: classification.exception (components/HelpTip.js).
 *   v1.1.0 — 2026-09-30 — A withdrawn or ended row is no longer faded as a whole (its reason fell to
 *     about 2.3:1 in light): a grey status mark says "withdrawn" or "ended" with the act in grey
 *     words beside it, and the reason keeps its contrast. A withdrawn row says who withdrew it. The
 *     "made by people" and "automatic, by apps" filters each have their own empty line.
 *   v1.0.0 — 2026-09-30 — Initial (Jouni's decisions of 2026-09-30).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { date as fmtDate, num as fmtNum } from '/js/format.js';
import {
  readExceptions, makeException, withdrawException, exceptionActWord, exceptionState, labelName, sentence,
} from '/js/services/classification.js';
import { Space } from '/components/Layout.js';
import { List, Row, Name, Desc, Who, Doors } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { Modal } from '/components/Modal.js';
import { Fields } from '/components/Field.js';
import { TextArea, TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { t } from '/js/i18n.js';

const W = (key, vars) => t('classification.exc.' + key, vars);
/** Exceptions read at once. A month record holds at most 1000; the list shows the newest. */
const LIMIT = 500;
/** The longest reason the server takes (exception-admin.ts). */
const REASON_MAX = 1000;
const errText = (e) => e?.error?.message || e?.response?.error?.message || e?.message || t('common.error');
const dateWord = (iso) => (iso ? fmtDate(iso, { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
/** An identity's account name: `alice@node` → alice, `ghii:alice@node` → alice. */
const local = (s) => { const v = String(s || '').replace(/^ghii:/, ''); const i = v.lastIndexOf('@'); return i > 0 ? v.slice(0, i) : v; };

/** Today in the reader's own time zone, as a date field writes it (YYYY-MM-DD). */
function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** A date field's day as the end of that day in the reader's time zone, ISO; empty is no end. */
function untilIso(day) {
  if (!day) return null;
  const d = new Date(`${day}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The exceptions list of one level and its handlers: the read (again on every classification
 * change), the filter, withdrawing one, and the dialog that makes one for an explorer item.
 * `confirm(message, run)` asks first and runs `run` on yes (each page passes its own).
 * @param {{ level: 'owner'|'node', off?: boolean, confirm: Function,
 *   ok: (message: string) => void, fail: (message: string) => void }} deps
 */
export function useExceptions({ level, off, confirm, ok, fail }) {
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(null);

  const load = useCallback(async () => {
    if (off) return;
    try { setList(await readExceptions(level, { limit: LIMIT })); }
    catch (e) { swallowed('classification: exceptions', e); setList([]); }
  }, [level, off]);
  useEffect(() => { load(); }, [load]);
  const again = useRef(null);
  again.current = load;
  useEffect(() => onLiveUpdate(['classification'], () => again.current()), []);

  /** Withdraw a person's exception in force. It stays on the list, so it asks first. */
  const withdraw = (e) => confirm(W('confirmWithdraw'), async () => {
    setBusy(true);
    try { await withdrawException(e.id); ok(W('withdrawnToast')); await load(); }
    catch (err) { fail(errText(err)); }
    setBusy(false);
  });

  const open = (item) => setMaking({ item, action: 'leave', reason: '', until: '', error: null });
  const set = (patch) => setMaking((m) => (m ? { ...m, ...patch, error: null } : m));
  const send = async () => {
    const m = making;
    if (!m || !m.reason.trim()) return;
    setBusy(true);
    try {
      await makeException(m.item, { action: m.action, reason: m.reason, until: untilIso(m.until) });
      setMaking(null);
      ok(W('madeToast'));
      await load();
    } catch (err) { setMaking((cur) => (cur ? { ...cur, error: errText(err) } : cur)); }
    setBusy(false);
  };

  return { list, filter, setFilter, busy, withdraw, making, open, set, send, cancel: () => setMaking(null) };
}

/* ── The render ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Whose content the item is, for the server's list (and for an item an agent or an app holds in
 * the person's own list): an organism, the server's policy, an agent's or an app's namespace, or a
 * person.
 * @param {any} e @param {boolean} admin
 * @returns {string}
 */
function scopeWords(e, admin) {
  const s = String(e.scope || '');
  if (e.organismId) return admin ? W('scope.organism', { id: e.organismId }) : '';
  if (s.startsWith('node:')) return W('scope.node');
  const hash = s.indexOf('#');
  if (hash > 0) return W('scope.agent', { name: s.slice(0, hash), owner: local(s.slice(hash + 1)) });
  return admin ? W('scope.owner', { name: local(e.ownerGaii || s) }) : '';
}

/**
 * When it was made (its last time, for an app's act that merged), and where it stands now; a
 * withdrawn one says who withdrew it, by their account name.
 */
function stateWords(e, state) {
  const at = dateWord(e.lastAt || e.at);
  const now = state === 'withdrawn'
    ? (e.withdrawnBy ? W('state.withdrawnBy', { date: dateWord(e.withdrawnAt), name: local(e.withdrawnBy) }) : W('state.withdrawn', { date: dateWord(e.withdrawnAt) }))
    : state === 'expired' ? W('state.expired', { date: dateWord(e.until) })
    : state === 'recorded' ? (e.count > 1 ? W('state.times', { n: fmtNum(e.count) }) : W('state.recorded'))
    : e.until ? W('state.until', { date: dateWord(e.until) }) : W('state.noEnd');
  return `${at} · ${now}`;
}

/** Who made it: an app by its name, a person by their account name. */
function whoWords(e) {
  if (e.byKind === 'app') return { name: e.app || local(e.by), kind: W('by.app') };
  if (e.byKind === 'ai') return { name: local(e.by), kind: W('by.ai') };
  return { name: local(e.by), kind: W('by.person') };
}

/**
 * What it let happen, as a mark. In force, the act on the attention ground; an app's record, the act
 * on the grey ground; withdrawn or ended, a grey status mark that says so with the act beside it in
 * grey words. The row itself is never faded: the reason under the mark is what an auditor reads,
 * and it keeps its full contrast.
 */
function actMarks(e, state) {
  if (state === 'withdrawn' || state === 'expired') {
    return html`<${Mark} kind="status" tone="off">${W('mark.' + state)}<//> <${Mark} kind="word">${exceptionActWord(e)}<//>`;
  }
  return html`<${Mark} kind="status" tone=${state === 'active' ? 'attention' : 'off'}>${exceptionActWord(e)}<//>`;
}

/**
 * One exception: the item with its kind (and whose it is on the server's list), what it let happen
 * with the reason under it, who made it with when and where it stands, and Withdraw for a person's
 * exception in force.
 */
function exceptionRow(ex, e, now, admin) {
  const state = exceptionState(e, now);
  const meta = [e.target ? t('classification.kind.' + e.target.kind) : '', scopeWords(e, admin)].filter(Boolean).join(' · ');
  const who = whoWords(e);
  return html`
    <${Row} key=${e.id}>
      <${Name} meta=${meta}>${e.target ? e.target.key : W('wholePolicy')}<//>
      <${Desc} sub=${e.reason}>${actMarks(e, state)}<//>
      <${Who} sub=${[who.kind, stateWords(e, state)].join(' · ')}>${who.name}<//>
      <${Doors}>
        ${state === 'active' ? html`<${Action} small soft disabled=${ex.busy} onClick=${() => ex.withdraw(e)}>${W('withdraw')}<//>` : null}
      <//>
    <//>`;
}

/**
 * The group: its label, the filters (all, made by people, automatic by apps) with their counts, the
 * list, and a line on what an exception is. `admin` is the server's list.
 * @param {ReturnType<typeof useExceptions>} ex @param {{ admin?: boolean }} [opts]
 */
export function exceptionsGroup(ex, { admin = false } = {}) {
  const all = ex.list || [];
  const people = all.filter((e) => !e.auto);
  const apps = all.filter((e) => e.auto);
  const rows = ex.filter === 'people' ? people : ex.filter === 'apps' ? apps : all;
  // Each filter has its own empty line: "all" explains what comes here, the other two say only
  // that nobody of that kind has made one.
  const empty = ex.filter === 'people' ? W('emptyPeople') : ex.filter === 'apps' ? W('emptyApps') : W(admin ? 'emptyNode' : 'empty');
  const now = new Date().toISOString();
  const filters = [
    { value: 'all', label: W('filter.all'), count: all.length },
    { value: 'people', label: W('filter.people'), count: people.length },
    { value: 'apps', label: W('filter.apps'), count: apps.length },
  ];
  return html`
    <${Space} above="section">
      <${Label} block>${W('title')}<//>
      <${Tabs} tone="filter" value=${ex.filter} onSelect=${(v) => ex.setFilter(v)} items=${filters} />
      <${List} cols="name-score-desc-doors" labels loading=${!ex.list}
        head=${[W('col.item'), W('col.exception'), W('col.by'), '']}
        empty=${empty} rows=${rows} render=${(e) => exceptionRow(ex, e, now, admin)} />
      <${Note} kind="hint">${W(admin ? 'hintNode' : 'hint')}<//>
    <//>`;
}

/**
 * The dialog that makes an exception for one classified item: what it lets happen (the item may
 * leave, or an AI may send it), the reason (required), and an optional last day. The server's
 * refusal is shown under the fields.
 * @param {ReturnType<typeof useExceptions>} ex
 */
export function exceptionDialog(ex) {
  const m = ex.making;
  if (!m) return null;
  const said = m.reason.trim();
  const label = m.item.labelDetail ? labelName(m.item.labelDetail) : m.item.label;
  const options = ['leave', 'ai-send'].map((a) => ({ value: a, label: sentence(exceptionActWord({ action: a })), hint: W(a === 'leave' ? 'make.leaveHint' : 'make.aiSendHint') }));
  return html`
    <${Modal} open onClose=${() => ex.cancel()} size="md" title=${W('make.title')}
      footer=${html`
        <${Action} onClick=${() => ex.cancel()} disabled=${ex.busy}>${t('common.cancel')}<//>
        <${Loud} control onClick=${() => ex.send()} disabled=${ex.busy || !said}>${W('make.send')}<//>`}>
      <${Fields}>
        <${Note}>${W('make.body', { item: m.item.key, label })}<//>
        <${Choice} label=${W('make.action')} help="classification.exception" boxed cols=${2} dot name="cls-exception-action" value=${m.action}
          onChange=${(v) => ex.set({ action: v })} options=${options} />
        <${TextArea} label=${W('make.reason')} hint=${W('make.reasonHint', { n: fmtNum(REASON_MAX) })} rows=${3} maxLength=${REASON_MAX}
          value=${m.reason} onInput=${(v) => ex.set({ reason: v })} />
        <${TextField} type="date" label=${W('make.until')} hint=${W('make.untilHint')} min=${today()} value=${m.until}
          onInput=${(v) => ex.set({ until: v })} />
        ${m.error ? html`<${Note} kind="message" error>${m.error}<//>` : null}
      <//>
    <//>`;
}
