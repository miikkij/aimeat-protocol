/**
 * @file security-tab.classification.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin Security page's classification section (TARGET-082 V5): the node's switch
 *   (off, each owner decides, or on for all content) with a button to where it is set; the node
 *   policy read as sentences (what unlabelled content reads as, whether an AI may classify, the
 *   Content Classifier's kind, provider and daily caps, what it judges on write, how long the audit
 *   log keeps its rows, how many labels and rules a level may hold); an AI's waiting proposal to
 *   loosen the node policy, with Accept and Reject for an operator in their own session; the labels
 *   and the detection rules as read-only lists; and the node-wide audit log, newest first, with a
 *   filter by what happened. The Content Classifier's settings (its kind of model, the two daily caps,
 *   what it judges on write) and the log's days are changed here in a form (ClassifierForm), saved as
 *   the whole node policy with PUT /v1/classification/policy. Editing the labels and rules is not on
 *   this page: the operator's AI changes them through the MCP tool aimeat_classification (action
 *   policy_set), and the section says so.
 * @structure ClassificationSection({ number, switchPage, confirm, onOk, onError }) · ClassifierForm ·
 *   policyRows · capWords · auditList · readerParts · Proposal · Dropped · draftOf · whole
 * @version-history
 *   v1.4.0 — 2026-09-30 — Browser check fixes: a change of the node's switch in the log says "setting
 *     changed" instead of "reclassified"; the reader is its account name with its node on the grey
 *     line under it (the whole identity on its title), so "alice@node" no longer breaks mid-word.
 *   v1.3.0 — 2026-09-29 — A change of the node's switch in the log (services/classification/switch.ts)
 *     says so in words: the item is the switch, the classification column its new state, and the
 *     purpose the old and the new state. The policy view's `dropped` (what the server left out of
 *     the stored policy because the node's policy covers it) is a short list when it is not empty.
 *   v1.2.0 — 2026-09-29 — Jouni's review: the operator changes the Content Classifier's settings and the
 *     log's days on the page (Change on either row opens the form; a server refusal is shown under
 *     it); a daily cap may be "no cap"; the log names the server's own classifier "Content
 *     Classifier" and says a reclassification in words instead of the server's ids.
 *   v1.1.0 — 2026-09-29 — Browser check fixes: the log's classification takes a column as wide as its
 *     words and the reader's column wraps, so the table stays inside its section (stacked with each
 *     value's column name under 1180px); one typewriter face per column for the item, the reader and
 *     the classification, as the refusal log has; "1 row shown"; a rule's whole pattern on its title;
 *     Accept and Reject in one case; the section space above the proposal and above each labelled
 *     list; the lists of labels and rules say each value's column name when they stack.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dateTime as fmtDateTime } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num } from './shared.js';
import { whenText } from './security-tab.refusals.js';
import {
  readPolicy, writePolicy, reviewPolicy, readAudit, labelName, labelById, aiWord, aiTone, leaveWord, audienceWord,
  actionWord, actionTone, rowActionWord, readerKindWord, readerName, purposeWords, isSwitchRow, modeWord, itemKindWord, ACTIONS,
} from '/js/services/classification.js';
import { Section } from '/components/Section.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Label } from '/components/Mark.js';
import { Readings } from '/components/Readings.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Name, When, Cell, Desc, Doors, More } from '/components/List.js';
import { Space, Row as Line } from '/components/Layout.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Choice } from '/components/Choice.js';

const html = htm.bind(h);
const S = (key, params) => t('admin.security.cls.' + key, params);
const PAGE = 200;
const MAX_ROWS = 1000;
const errText = (e) => (e && (e.message || e.code)) || t('common.error');

/**
 * A row in words with a quiet button on the right, as the settings section draws them. No `door`, no button.
 * @param {string} key @param {{ title: any, why: any, door?: any, onClick?: () => any, last?: boolean }} row
 */
function doorRow(key, { title, why, door, onClick, last }) {
  return { key, name: title, why, end: door ? html`<${Action} small soft onClick=${onClick}>${door}<//>` : undefined, last };
}

/** The Content Classifier's daily caps as sentences; null is no cap (services/classification/defaults.ts). */
function capWords(c) {
  const owner = c.dailyPerOwner == null ? S('capOwnerNone') : S('capOwner', { n: num(c.dailyPerOwner) });
  const server = c.dailyNode == null ? S('capServerNone') : S('capServer', { n: num(c.dailyNode) });
  return [owner, server, c.dailyPerOwner != null || c.dailyNode != null ? S('capQueue') : ''].filter(Boolean).join(' ');
}

/**
 * The node policy as sentences: the switch, then what the policy sets. The Content Classifier's row
 * and the log's row open the form that changes them (`onEdit`).
 */
function policyRows(v, switchPage, onEdit) {
  const p = v.effective || {};
  const c = p.classifier || {};
  const dflt = labelById(p, p.defaultLabel);
  const onWrite = (c.onWrite || []).map((k) => t('classification.kinds.' + k)).join(', ');
  const mode = ['off', 'owner', 'all'].includes(v.mode) ? v.mode : 'off';
  return [
    doorRow('switch', {
      title: S('mode.' + mode),
      why: S('mode.' + mode + 'Why', { config: t('dashboard.config') }),
      door: t('dashboard.config'), onClick: () => switchPage('config'),
    }),
    doorRow('default', { title: S('defaultLabel', { label: dflt ? labelName(dflt) : p.defaultLabel || '?' }), why: S('defaultLabelWhy') }),
    doorRow('aiMode', {
      title: S('aiMode.' + (p.aiMode || 'suggest')),
      why: S('aiMode.' + (p.aiMode || 'suggest') + 'Why', { pct: num(Math.round((p.aiThreshold ?? 0.85) * 100)) }),
    }),
    doorRow('classifier', {
      title: S(c.type === 'llm' ? 'classifierLlm' : 'classifierJev'),
      why: [S('classifierProvider', { provider: c.provider || S('providerDefault') }), capWords(c),
        onWrite ? S('onWrite', { kinds: onWrite }) : S('onWriteNone')].join(' '),
      door: S('change'), onClick: onEdit,
    }),
    doorRow('retention', {
      title: p.auditRetentionDays == null ? S('retentionKeep') : S('retention', { days: num(p.auditRetentionDays) }),
      why: S('retentionWhy'),
      door: S('change'), onClick: onEdit,
    }),
    doorRow('limits', {
      title: S('limits', { labels: num(p.limits?.labels ?? 0), rules: num(p.limits?.rules ?? 0) }),
      why: S('limitsWhy'), last: true,
    }),
  ];
}

/**
 * The node-wide audit log, on the refusal log's cut (listing.css when-state-path-where-kind-desc).
 * The cut's fourth column is as wide as its words and its fifth shares what is left, so the
 * classification (a few words) takes the fourth and the reader (an address that breaks anywhere)
 * the fifth: a long reader can no longer squeeze the classification over the purpose. The item, the
 * classification and the reader are each one typewriter column, the kind of item and of reader the
 * grey line under their value. Under 1180px the rows stack and each value says its column's name.
 * @param {any} p the effective policy @param {Array<any>|null} rows
 */
function auditList(p, rows) {
  return html`
    <${List} cols="when-state-path-where-kind-desc" stackWide labels loading=${!rows} empty=${S('auditEmpty')}
      head=${[S('col.time'), S('col.action'), S('col.item'), S('col.label'), S('col.reader'), S('col.purpose')]}
      rows=${rows || []} render=${(r) => {
        const who = readerParts(r.reader);
        return html`
        <${Row} key=${r.id || `${r.minute}|${r.reader}|${r.action}|${r.key}`}>
          <${When}>${whenText(r.lastAt || r.minute)}<//>
          <${Cell} line><${Mark} kind="status" tone=${actionTone(r.action)}>${rowActionWord(r)}<//><//>
          <${Cell} code sub=${itemKindWord(r)}>${r.key}<//>
          <${Cell} code>${isSwitchRow(r) ? modeWord(r.label) : (labelName(labelById(p, r.label)) || r.label)}<//>
          <${Cell} code title=${r.reader} sub=${[readerKindWord(r.readerKind), readerName(r.reader, r.readerKind) ? '' : who.node].filter(Boolean).join(' · ')}>${readerName(r.reader, r.readerKind) || who.name}<//>
          <${Desc}>${[purposeWords(p, r), r.count > 1 ? S('times', { n: num(r.count) }) : ''].filter(Boolean).join(' · ')}<//>
        <//>`;
      }} />`;
}

/**
 * A reader's identity as the account and the node it lives on, so the list shows the account name
 * and puts the node on the grey line under it (as the operator's lists of owners and agents do)
 * instead of breaking "alice@node" in the middle of a word. A reader without a node (an anonymous
 * reader) is its own name.
 * @param {string} reader
 * @returns {{ name: string, node: string }}
 */
function readerParts(reader) {
  const s = String(reader || '');
  const at = s.lastIndexOf('@');
  return at > 0 ? { name: s.slice(0, at), node: s.slice(at + 1) } : { name: s, node: '' };
}

/** An AI's proposal to loosen the node policy: who, when, what it gives away, and the two answers. */
function Proposal({ p, busy, onReview }) {
  const lines = (p.loosens || []).map((s, i) => ({ key: String(i), s }));
  // p.by is the proposer's principal (an identifier), so it keeps its own case; the words around it
  // are the locale's. Accept and Reject are two answers of the same weight: the same action link.
  return html`
    <${Space} above="section">
      <${Note} kind="aside">
        <b>${S('proposalTitle')}</b> ${S('proposalBody', { by: p.by, date: fmtDateTime(p.at) })}
        ${p.humanSaid ? html` ${S('proposalSaid', { said: p.humanSaid })}` : null}
        ${lines.length ? html`
          <${Label} block>${S('proposalGives')}<//>
          <${List} cols="name" small rows=${lines} render=${(r) => html`<${Row} key=${r.key}><${Cell}>${r.s}<//><//>`} />` : null}
        <${Actions}>
          <${Action} small disabled=${busy} onClick=${() => onReview('accept')}>${S('accept')}<//>
          <${Action} small disabled=${busy} onClick=${() => onReview('reject')}>${S('reject')}<//>
        <//>
      <//>
    <//>`;
}

/** What the server left out of the stored policy because the node's policy now covers it, one line each. */
function Dropped({ lines }) {
  if (!lines || !lines.length) return null;
  const rows = lines.map((s, i) => ({ key: String(i), s }));
  return html`
    <${Space} above="section">
      <${Note} kind="aside">
        <b>${S('dropped')}</b>
        <${List} cols="name" small rows=${rows} render=${(r) => html`<${Row} key=${r.key}><${Cell}>${r.s}<//><//>`} />
      <//>
    <//>`;
}

const KINDS = ['memory', 'file', 'row'];

/** The form's draft from the policy: numbers as text, and "no cap" and "keep every row" as boxes. */
function draftOf(p) {
  const c = p?.classifier || {};
  const text = (n, fallback) => String(n ?? fallback);
  return {
    type: c.type === 'llm' ? 'llm' : 'jev',
    owner: text(c.dailyPerOwner, 200), ownerNone: c.dailyPerOwner === null,
    server: text(c.dailyNode, 2000), serverNone: c.dailyNode === null,
    onWrite: (c.onWrite || []).filter((k) => KINDS.includes(k)),
    days: text(p?.auditRetentionDays, 365), keepAll: p?.auditRetentionDays === null,
  };
}

/** A whole number from `lo` to `hi` typed in a field, or undefined when it is not one. */
function whole(s, lo, hi) {
  const v = String(s ?? '').trim();
  const n = Number(v);
  return v !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
}

/**
 * The form that changes the Content Classifier's settings and how long the log keeps its rows: the
 * kind of model, the two daily caps (a number, or no cap), what it judges when content is written,
 * and the log's days (or every row). The labels and the rules are not here: the operator's AI edits
 * them.
 * @param {{ d: any, set: (patch: object) => void, busy: boolean, msg: any, onSave: () => any, onCancel: () => any }} props
 */
function ClassifierForm({ d, set, busy, msg, onSave, onCancel }) {
  const number = (key, value, none, noneKey, lo, hi) => html`
    <${Field} label=${S('edit.' + key)} hint=${S('edit.' + key + 'Hint')}>
      <${Line} wrap gap="medium">
        <${TextField} type="number" size="short" min=${String(lo)} max=${String(hi)} step="1" ariaLabel=${S('edit.' + key)}
          value=${value} disabled=${none} onInput=${(v) => set({ [key]: v })} />
        <${Check} inline checked=${none} onChange=${(on) => set({ [noneKey]: on })}>${S(noneKey === 'keepAll' ? 'edit.keepAll' : 'edit.noCap')}<//>
      <//>
    <//>`;
  return html`
    <${Space} above="section">
      <${Label} block>${S('edit.title')}<//>
      <${Fields}>
        <${Choice} label=${S('edit.type')} hint=${S('edit.typeHint')} value=${d.type} onChange=${(v) => set({ type: v })}
          options=${[['jev', S('edit.typeJev')], ['llm', S('edit.typeLlm')]]} />
        ${number('owner', d.owner, d.ownerNone, 'ownerNone', 0, 1000000)}
        ${number('server', d.server, d.serverNone, 'serverNone', 0, 1000000)}
        <${Choice} multi label=${S('edit.onWrite')} hint=${S('edit.onWriteHint')} value=${d.onWrite} onChange=${(v) => set({ onWrite: v })}
          options=${KINDS.map((k) => [k, t('classification.kinds.' + k)])} />
        ${number('days', d.days, d.keepAll, 'keepAll', 1, 36500)}
      <//>
      <${FormActions}>
        <${Action} small disabled=${busy} onClick=${onSave}>${S('edit.save')}<//>
        <${Action} small soft disabled=${busy} onClick=${onCancel}>${S('edit.cancel')}<//>
      <//>
      ${msg ? html`<${Note} kind="message" error=${!!msg.error}>${msg.text}<//>` : null}
    <//>`;
}

export function ClassificationSection({ number, switchPage, confirm, onOk, onError }) {
  const [view, setView] = useState(null);
  const [failed, setFailed] = useState(false);
  const [rows, setRows] = useState(null);
  const [action, setAction] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [formMsg, setFormMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const v = await readPolicy('node'); setView(v); setFailed(!v); }
    catch (e) { setFailed(true); onError(errText(e)); }
  // onError is re-created by the page each render; listing it would re-create load every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadRows = useCallback(async (a, max) => {
    try { setRows(await readAudit('node', { action: a, limit: max })); }
    catch (e) { setRows([]); onError(errText(e)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRows(action, limit); }, [loadRows, action, limit]);
  const again = useRef(null);
  again.current = () => { load(); loadRows(action, limit); };
  useEffect(() => onLiveUpdate(['classification', 'config'], () => again.current()), []);

  const pick = (a) => { setRows(null); setLimit(PAGE); setAction(a); };
  // Accepting gives something away for every person on this server, so it asks first.
  const review = (decision) => {
    const run = async () => {
      setBusy(true);
      try {
        const r = await reviewPolicy('node', decision);
        if (r?.view) setView(r.view); else await load();
        onOk(S(decision === 'accept' ? 'accepted' : 'rejected'));
      } catch (e) { onError(errText(e)); }
      setBusy(false);
    };
    if (decision === 'accept') confirm(S('confirmAccept'), run, { title: S('title') }); else run();
  };

  const edit = () => { setFormMsg(null); setDraft((d) => d || draftOf(view?.effective)); };
  const cancelEdit = () => { setDraft(null); setFormMsg(null); };
  // The whole node policy goes back: it is read again just before the write, so labels and rules an
  // AI changed while the form was open are kept, and only the form's fields change.
  const saveEdit = async () => {
    const d = draft;
    const owner = d.ownerNone ? null : whole(d.owner, 0, 1000000);
    const server = d.serverNone ? null : whole(d.server, 0, 1000000);
    const days = d.keepAll ? null : whole(d.days, 1, 36500);
    if (owner === undefined || server === undefined) { setFormMsg({ text: S('edit.capRange'), error: true }); return; }
    if (days === undefined) { setFormMsg({ text: S('edit.daysRange'), error: true }); return; }
    setSaving(true);
    try {
      const fresh = await readPolicy('node');
      const base = fresh?.stored || fresh?.effective;
      if (!base) throw new Error(S('loadFailed'));
      const policy = {
        ...base, auditRetentionDays: days,
        classifier: { ...(base.classifier || {}), type: d.type, dailyPerOwner: owner, dailyNode: server, onWrite: d.onWrite },
      };
      const r = await writePolicy('node', policy);
      if (r?.view) setView(r.view); else await load();
      setDraft(null);
      setFormMsg(null);
      onOk(S('edit.saved'));
    } catch (e) { setFormMsg({ text: errText(e), error: true }); }
    setSaving(false);
  };

  const p = view?.effective || {};
  const labels = (p.labels || []).slice().sort((a, b) => a.rank - b.rank);
  const rules = p.rules || [];
  const filters = ['all', ...ACTIONS].map((a) => ({ value: a, label: a === 'all' ? S('filterAll') : actionWord(a) }));
  return html`
    <${Section} id="adm-sec-cls" num=${number} title=${S('title')}
      doors=${html`<${Action} small soft onClick=${() => switchPage('config')}>${t('dashboard.config')}<//>`}>
      <${Note} kind="lead">${S('lead')}<//>
      ${!view ? (failed ? html`<${Note} kind="quiet">${S('loadFailed')}<//>` : html`<${Note} kind="loading" />`) : html`
        <${Readings} rows=${policyRows(view, switchPage, edit)} />
        ${draft ? html`<${ClassifierForm} d=${draft} set=${(patch) => setDraft((cur) => ({ ...cur, ...patch }))} busy=${saving}
          msg=${formMsg} onSave=${saveEdit} onCancel=${cancelEdit} />` : null}
        <${Dropped} lines=${view.dropped} />
        ${view.proposal ? html`<${Proposal} p=${view.proposal} busy=${busy} onReview=${review} />` : null}

        <${Space} above="section">
          <${Label} block>${S('labels', { n: num(labels.length) })}<//>
          <${List} cols="name-state-meta-meta-doors" labels empty=${S('noLabels')}
            head=${[S('col.label'), S('col.ai'), S('col.leave'), S('col.audience'), '']}
            rows=${labels} render=${(l) => html`
              <${Row} key=${l.id} faded=${l.status === 'retired'}>
                <${Name} meta=${[l.id, S('rank', { n: num(l.rank) }), l.status === 'retired' ? S('retired') : ''].filter(Boolean).join(' · ')} desc=${l.description || undefined}>${labelName(l)}<//>
                <${Cell} line><${Mark} kind="status" tone=${aiTone(l.aiVisibility)}>${aiWord(l.aiVisibility)}<//><//>
                <${Cell} meta>${leaveWord(l.mayLeaveOrganism)}${l.audit ? ' · ' + S('audited') : ''}<//>
                <${Cell} meta>${audienceWord(l.audience)}<//>
                <${Doors} />
              <//>`} />
        <//>

        <${Space} above="section">
          <${Label} block>${S('rules', { n: num(rules.length) })}<//>
          <${List} cols="name-state-meta-meta-doors" labels empty=${S('noRules')}
            head=${[S('col.rule'), S('col.state'), S('col.kind'), S('col.minLabel'), '']}
            rows=${rules} render=${(r) => html`
              <${Row} key=${r.id} faded=${!r.enabled}>
                <${Name} meta=${r.pattern} title=${r.pattern} clip>${r.name || r.id}<//>
                <${Cell} line><${Mark} kind="status" tone=${r.enabled ? 'fine' : 'off'}>${S(r.enabled ? 'ruleOn' : 'ruleOff')}<//><//>
                <${Cell} meta>${S('ruleKind.' + (['keyword', 'regex', 'classifier'].includes(r.kind) ? r.kind : 'keyword'))}<//>
                <${Cell} meta>${S('atLeast', { label: labelName(labelById(p, r.minLabel)) || r.minLabel })}<//>
                <${Doors} />
              <//>`} />
          <${Note} kind="hint">${S('editNote')}<//>
        <//>

        <${Space} above="section">
          <${Label} block>${S('audit')}<//>
          <${Tabs} tone="filter" value=${action} onSelect=${pick} items=${filters} />
          ${auditList(p, rows)}
          <${More} label=${S('next')} disabled=${!rows}
            onMore=${rows && rows.length >= limit && limit < MAX_ROWS ? () => setLimit((k) => Math.min(k + PAGE, MAX_ROWS)) : null}
            note=${rows ? (rows.length === 1 ? S('shownOne') : S('shown', { n: num(rows.length) })) : undefined} />
        <//>`}
    <//>`;
}
