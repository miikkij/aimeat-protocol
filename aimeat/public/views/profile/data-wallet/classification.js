/**
 * @file public/views/profile/data-wallet/classification.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data Wallet's classification section (TARGET-082 V5): whether classification is
 *   on for the person's own content and the switch when the operator leaves it to each person (on
 *   and locked when the operator turned it on for everyone; one sentence when the operator has not
 *   turned it on), the labels that apply (what an AI sees, whether content may leave the organism,
 *   who may read it), an AI's waiting proposal to loosen the person's policy with Accept and Reject
 *   (the person's own session is the only place it can be accepted), the items where an AI's or a
 *   rule's suggestion waits for the person, the person's classified items, and the person's audit
 *   log, newest first, filtered by what happened, with how long it keeps its rows. useClassification holds the reads and the handlers;
 *   secClassification is the render, on the page's own components (the trail's list cut for the
 *   log, the Settings list for the labels, the aside for the proposal).
 * @structure acceptStep(policy, item, decision) · useClassification() → cls · secClassification(ctx, num)
 * @usage const cls = useClassification({ federated, confirm, toast }); … secClassification({ ...ctx, cls }, '05')
 * @version-history
 *   v1.5.0 — 2026-09-30 — Browser check fixes: the waiting suggestions take the cut whose item column
 *     keeps 10rem (name-score-desc-doors), so the proposer's reason no longer squeezes the item to
 *     nothing; the classification the item has now is the line under the suggested one, and the
 *     reason the line under who suggested it. An agent's suggestion names the agent ("bot (agent)")
 *     instead of its owner. A change of the node's switch in the log says "setting changed".
 *   v1.4.0 — 2026-09-30 — Accepting a suggestion that lowers a classification which needs a reason
 *     (the policy's lowerNeedsJustification, ranks from the person's policy) asks for the reason in
 *     the same confirm step, a dialog with the reason field, and sends it as `justification`; the
 *     server's JUSTIFICATION_REQUIRED was the only thing the page said before (TARGET-082 review,
 *     item 3).
 *   v1.3.0 — 2026-09-29 — Waiting suggestions (each item where an AI or a rule suggested another
 *     classification, with Accept and Reject, POST /v1/classification/label/review), the person's
 *     classified items a page at a time (GET /v1/classification/labels), how long the log keeps its
 *     rows (the node policy's auditRetentionDays), and the policy view's `dropped` (what the server
 *     left out of the person's stored policy because its own now covers it) as a short list. A
 *     suggestion on an item an agent holds is reviewed with that agent as `owner`.
 *   v1.2.0 — 2026-09-29 — Jouni's review: the log names the server's own classifier "Content
 *     Classifier" and says a reclassification in words (the classifications' names and who gave it)
 *     instead of the server's ids; the count's column holds its words (listing.css).
 *   v1.1.0 — 2026-09-29 — Browser check fixes: the proposal's sentence starts with a capital letter;
 *     Accept and Reject in one case; the section space above the proposal, the labels and the log;
 *     the labels list says each value's column name when it stacks.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import {
  readPolicy, writePolicy, reviewPolicy, readAudit, listLabels, reviewLabel, labelName, labelById, aiWord, aiTone,
  leaveWord, audienceWord, actionWord, rowActionWord, readerKindWord, readerName, sourceWord, purposeWords, sentence, ACTIONS,
} from '/js/services/classification.js';
import { Space } from '/components/Layout.js';
import { Section } from '/components/Section.js';
import { Facts } from '/components/Facts.js';
import { Switch } from '/components/Switch.js';
import { List, Row, Name, Desc, Who, Num, When, Cell, Doors, More } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Figure } from '/components/Figure.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Modal } from '/components/Modal.js';
import { Fields } from '/components/Field.js';
import { TextArea } from '/components/TextField.js';
import { t } from '/js/i18n.js';
import { x, n, dateWord, timeWord, accessorWords, whoOf } from './frame.js';

const PAGE = 50;
const MAX_ROWS = 1000;
/** Waiting suggestions shown at once. More than this is rare; the rest come after these are answered. */
const PENDING_MAX = 100;
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error');

/**
 * What answering a waiting suggestion asks of the person first. Accepting one that lowers the
 * classification (by rank, from the policy; the item's own brief when the policy lacks the label)
 * asks for a confirmation, and for a written reason when the current classification needs one to be
 * lowered (lowerNeedsJustification). A reject, a raise and a same-rank change ask nothing.
 * @param {any} policy the person's effective policy ({ labels })
 * @param {{ label: string, labelDetail?: any, suggestion?: { label: string, labelDetail?: any } | null }} item
 * @param {'accept'|'reject'} decision
 * @returns {{ kind: 'none' } | { kind: 'confirm'|'reason', words: { from: string, to: string } }}
 */
export function acceptStep(policy, item, decision) {
  const s = item?.suggestion;
  if (decision !== 'accept' || !s) return { kind: 'none' };
  const now = labelById(policy, item.label) || item.labelDetail;
  const next = labelById(policy, s.label) || s.labelDetail;
  if (!now || !next || !(next.rank < now.rank)) return { kind: 'none' };
  const words = { from: labelName(now), to: labelName(next) };
  return { kind: labelById(policy, item.label)?.lowerNeedsJustification ? 'reason' : 'confirm', words };
}

/**
 * The reads and the handlers of the section: the owner's policy, the audit log with its filter and
 * its length, the switch, and the review of a waiting proposal.
 * @param {{ federated: boolean, confirm: Function, toast: (m: string, err?: boolean) => void }} deps
 */
export function useClassification({ federated, confirm, toast }) {
  const [view, setView] = useState(null);
  const [failed, setFailed] = useState(false);
  const [rows, setRows] = useState(null);
  const [action, setActionState] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (federated) return;
    try {
      const v = await readPolicy('owner');
      setView(v);
      setFailed(!v);
    } catch (e) { swallowed('data-wallet: classification policy', e); setFailed(true); }
  }, [federated]);

  const loadRows = useCallback(async (a, max) => {
    if (federated) return;
    try { setRows(await readAudit('owner', { action: a, limit: max })); }
    catch (e) { swallowed('data-wallet: classification audit', e); setRows([]); }
  }, [federated]);

  // The items where a suggestion waits for the person, and the person's classified items, a page at a time.
  const [pending, setPending] = useState(null);
  const [items, setItems] = useState(null);
  const [itemsNext, setItemsNext] = useState(null);
  const loadItems = useCallback(async () => {
    if (federated) return;
    try { setPending((await listLabels({ pending: true, limit: PENDING_MAX })).items); }
    catch (e) { swallowed('data-wallet: classification pending', e); setPending([]); }
    try {
      const r = await listLabels({ limit: PAGE });
      setItems(r.items);
      setItemsNext(r.next);
    } catch (e) { swallowed('data-wallet: classification items', e); setItems([]); setItemsNext(null); }
  }, [federated]);
  const moreItems = async () => {
    if (!itemsNext) return;
    try {
      const r = await listLabels({ limit: PAGE, cursor: itemsNext });
      setItems((prev) => [...(prev || []), ...r.items]);
      setItemsNext(r.next);
    } catch (e) { toast(errText(e, x('cls.loadFailed')), true); }
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRows(action, limit); }, [loadRows, action, limit]);
  useEffect(() => { loadItems(); }, [loadItems]);
  const again = useRef(null);
  again.current = () => { load(); loadRows(action, limit); loadItems(); };
  useEffect(() => onLiveUpdate(['classification', 'memory'], () => again.current()), []);

  const setAction = (a) => { setRows(null); setLimit(PAGE); setActionState(a); };
  const more = () => setLimit((k) => Math.min(k + PAGE, MAX_ROWS));

  /** On or off for the person's own content. Turning it off asks first, since it gives protection away. */
  const toggle = () => {
    if (!view) return;
    const next = !view.active;
    const run = async () => {
      setBusy('switch');
      try {
        const r = await writePolicy('owner', { ...(view.stored || {}), enabled: next });
        if (r?.view) setView(r.view); else await load();
        toast(x(next ? 'cls.turnedOn' : 'cls.turnedOff'));
      } catch (e) { toast(errText(e, x('cls.saveFailed')), true); }
      setBusy(false);
    };
    if (next) run(); else confirm(x('cls.confirmOff'), run);
  };

  /** Accept or reject the AI's proposal. Accepting gives something away, so it asks first. */
  const review = (decision) => {
    const run = async () => {
      setBusy('review');
      try {
        const r = await reviewPolicy('owner', decision);
        if (r?.view) setView(r.view); else await load();
        toast(x(decision === 'accept' ? 'cls.accepted' : 'cls.rejected'));
      } catch (e) { toast(errText(e, x('cls.saveFailed')), true); }
      setBusy(false);
    };
    if (decision === 'accept') confirm(x('cls.confirmAccept'), run); else run();
  };

  // An accepted suggestion that lowers a classification which needs a reason waits here, with what
  // it lowers from and to, until the person writes the reason or cancels.
  const [lowering, setLowering] = useState(null);
  const [reason, setReason] = useState('');

  /**
   * Accept or reject the suggestion waiting on one item. Accepting one that lowers the
   * classification gives protection away, so it asks first. The ranks come from the person's
   * policy; when the current classification needs a reason to be lowered, the same step asks for
   * it and sends it as `justification`.
   */
  const reviewItem = (item, decision) => {
    const run = async (justification) => {
      setBusy('item:' + item.kind + ':' + item.key);
      try {
        await reviewLabel(item, decision, justification ? { justification } : {});
        toast(x(decision === 'accept' ? 'cls.suggestionAccepted' : 'cls.suggestionRejected'));
        setLowering(null);
        await loadItems();
      } catch (e) { toast(errText(e, x('cls.saveFailed')), true); }
      setBusy(false);
    };
    const step = acceptStep(view?.effective, item, decision);
    if (step.kind === 'reason') {
      setReason('');
      setLowering({ words: step.words, send: run });
    } else if (step.kind === 'confirm') {
      confirm(x('cls.confirmLower', step.words), () => run());
    } else {
      run();
    }
  };

  return {
    view, failed, rows, action, limit, busy, setAction, more, toggle, review,
    pending, items, itemsNext, moreItems, reviewItem,
    lowering, reason, setReason, cancelLowering: () => setLowering(null),
  };
}

/* ── The render ───────────────────────────────────────────────────────────────────────────────── */

/** The word beside the section's title and in the rail: on, off, or not in use here. */
export function classificationCount(cls) {
  const v = cls?.view;
  if (!v) return '';
  if (v.mode === 'off') return x('cls.notInUse');
  return x(v.active ? 'cls.on' : 'cls.off');
}

/** The switch as a row of facts: its state, and what the operator's setting leaves to the person. */
function switchRow(cls) {
  const v = cls.view;
  if (v.mode === 'off') return { key: 'switch', k: x('cls.switch'), v: x('cls.notInUse'), missing: true, sub: x('cls.modeOff') };
  if (v.mode === 'all') return { key: 'switch', k: x('cls.switch'), v: html`<${Switch} on locked label=${x('cls.on')} />`, sub: x('cls.modeAll') };
  return {
    key: 'switch', k: x('cls.switch'),
    v: html`<${Switch} on=${!!v.active} label=${x(v.active ? 'cls.on' : 'cls.off')} disabled=${cls.busy === 'switch'} onToggle=${cls.toggle} />`,
    sub: x(v.active ? 'cls.modeOwnerOn' : 'cls.modeOwnerOff'),
  };
}

/** An AI's proposal to loosen the policy: who, when, what it gives away, and the two answers. */
function proposal(cls) {
  const p = cls.view?.proposal;
  if (!p) return null;
  const lines = (p.loosens || []).map((s, i) => ({ key: String(i), s }));
  // The proposer is a name said in words ("the agent bot of sandbox"), which the English sentence
  // opens with; sentence() gives it its capital. Accept and Reject are two answers of the same
  // weight: the same action link.
  return html`
    <${Space} above="section">
      <${Note} kind="aside">
        <b>${x('cls.proposalTitle')}</b> ${sentence(x('cls.proposalBody', { by: whoOf(p.by, {}).name, date: dateWord(p.at) }))}
        ${p.humanSaid ? html` ${x('cls.proposalSaid', { said: p.humanSaid })}` : null}
        ${lines.length ? html`
          <${Label} block>${x('cls.proposalGives')}<//>
          <${List} cols="name" small rows=${lines} render=${(r) => html`<${Row} key=${r.key}><${Cell}>${r.s}<//><//>`} />` : null}
        <${Actions}>
          <${Action} small disabled=${!!cls.busy} onClick=${() => cls.review('accept')}>${x('cls.accept')}<//>
          <${Action} small disabled=${!!cls.busy} onClick=${() => cls.review('reject')}>${x('cls.reject')}<//>
        <//>
      <//>
    <//>`;
}

/** What the server left out of the person's stored policy because the server's policy now covers it. */
function dropped(cls) {
  const lines = (cls.view?.dropped || []).map((s, i) => ({ key: String(i), s }));
  if (!lines.length) return null;
  return html`
    <${Space} above="section">
      <${Note} kind="aside">
        <b>${x('cls.dropped')}</b>
        <${List} cols="name" small rows=${lines} render=${(r) => html`<${Row} key=${r.key}><${Cell}>${r.s}<//><//>`} />
      <//>
    <//>`;
}

/** One label as a row: its name, what an AI sees, whether it may leave the organism, who may read. */
function labelRow(l) {
  return html`
    <${Row} key=${l.id}>
      <${Name}>${labelName(l)}<//>
      <${Cell} line><${Mark} kind="status" tone=${aiTone(l.aiVisibility)}>${aiWord(l.aiVisibility)}<//><//>
      <${Cell} meta>${leaveWord(l.mayLeaveOrganism)}<//>
      <${Cell} meta>${audienceWord(l.audience)}<//>
      <${Doors} />
    <//>`;
}

/**
 * One row of the audit log, in the trail's own cut: who, what, how many times and what happened, when.
 * The server's own classifier is named in words; a reclassification's purpose already names the
 * classification it moved to, so its row does not repeat the label before it.
 */
function auditRow(policy, r) {
  const own = readerName(r.reader, r.readerKind);
  const who = own ? { name: own, sub: '' } : accessorWords(r.reader);
  const label = labelById(policy, r.label);
  const at = r.lastAt || r.minute;
  const changed = r.action === 'changed';
  const sub = [changed ? '' : (label ? labelName(label) : r.label), t('classification.kind.' + r.kind), purposeWords(policy, r)].filter(Boolean).join(' · ');
  return html`
    <${Row} key=${r.id || `${r.minute}|${r.reader}|${r.action}|${r.key}`}>
      <${Name} meta=${who.sub || readerKindWord(r.readerKind)}>${who.name}<//>
      <${Desc} sub=${sub}>${r.key}<//>
      <${Num}><${Figure} small end tone=${r.action === 'refused' ? 'notice' : r.action === 'changed' ? 'dim' : 'fine'} n=${n(r.count)} sub=${rowActionWord(r)} /><//>
      <${When}>${dateWord(at)} ${timeWord(at)}<//>
      <${Doors} />
    <//>`;
}

/** The locale key of each reason a suggestion could not apply (services/classification/labels.ts). */
const WHY = { HUMAN_LABEL: 'human', CANNOT_LOWER: 'lower', AI_SUGGESTS: 'suggest', BELOW_THRESHOLD: 'threshold' };

/** A classification an explorer item carries, as a word: its name in the reader's language, or its id. */
const nameOf = (detail, id) => (detail ? labelName(detail) : id);

/**
 * Who suggested a classification, in words: the server's own classifier by its name, a rule, an
 * agent by its own name ("bot (agent)"; an agent of another person as "the agent bot of alice"), or
 * a person by their account name. `me` is the signed-in person's account name.
 * @param {{ by?: string, source?: string }} s @param {string} [me]
 * @returns {string}
 */
function suggester(s, me) {
  const own = readerName(s.by, s.source === 'rule' ? 'system' : 'ai');
  if (own) return own;
  if (s.source === 'rule') return sourceWord('rule');
  const id = String(s.by || '').replace(/^ghii:/, '');
  const hash = id.indexOf('#');
  if (hash <= 0) return accessorWords(id).name;
  const owner = accessorWords(id).name;
  return !me || owner === me ? x('cls.byAgent', { name: id.slice(0, hash) }) : sentence(whoOf(id, {}).name);
}

/**
 * One waiting suggestion, on the cut whose first column keeps 10rem (listing.css
 * name-score-desc-doors): the item, the classification suggested with the one it has now on the
 * line under it, who suggested it with why it waits on the line under that, and the two answers.
 */
function pendingRow(cls, it, me) {
  const s = it.suggestion;
  const why = [s.reason, WHY[s.why] ? x('cls.why.' + WHY[s.why]) : ''].filter(Boolean).join(' · ');
  const busy = !!cls.busy;
  return html`
    <${Row} key=${`${it.kind}|${it.scope}|${it.key}`}>
      <${Name} meta=${t('classification.kind.' + it.kind)}>${it.key}<//>
      <${Desc} sub=${x('cls.nowIs', { label: nameOf(it.labelDetail, it.label) })}><${Mark} kind="status" tone=${aiTone(s.labelDetail?.aiVisibility)}>${nameOf(s.labelDetail, s.label)}<//><//>
      <${Who} sub=${why}>${suggester(s, me)}<//>
      <${Doors}>
        <${Action} small soft disabled=${busy} onClick=${() => cls.reviewItem(it, 'accept')}>${x('cls.accept')}<//>
        <${Action} small soft disabled=${busy} onClick=${() => cls.reviewItem(it, 'reject')}>${x('cls.reject')}<//>
      <//>
    <//>`;
}

/** One classified item: the item, its classification, who gave it, and when it last changed. */
function itemRow(it) {
  return html`
    <${Row} key=${`${it.kind}|${it.scope}|${it.key}`}>
      <${Name} meta=${t('classification.kind.' + it.kind)}>${it.key}<//>
      <${Cell} line><${Mark} kind="status" tone=${aiTone(it.labelDetail?.aiVisibility)}>${nameOf(it.labelDetail, it.label)}<//><//>
      <${Cell} meta>${sourceWord(it.source)}<//>
      <${Cell} meta>${dateWord(it.updatedAt)}<//>
      <${Doors} />
    <//>`;
}

/** The waiting suggestions and the classified items, each under its own label. `me`: the person's account name. */
function itemSections(cls, me) {
  const pending = cls.pending;
  const items = cls.items;
  return html`
    <${Space} above="section">
      <${Label} block>${x('cls.pendingTitle')}<//>
      <${List} cols="name-score-desc-doors" labels loading=${!pending}
        head=${[x('cls.col.item'), x('cls.col.suggested'), x('cls.col.by'), '']}
        empty=${x('cls.pendingEmpty')} rows=${pending || []} render=${(it) => pendingRow(cls, it, me)} />
      ${pending && pending.length ? html`<${Note} kind="hint">${x('cls.pendingHint')}<//>` : null}
    <//>
    <${Space} above="section">
      <${Label} block>${x('cls.itemsTitle')}<//>
      <${List} cols="name-state-meta-meta-doors" labels loading=${!items}
        head=${[x('cls.col.item'), x('cls.col.label'), x('cls.col.givenBy'), x('cls.col.changed'), '']}
        empty=${x('cls.itemsEmpty')} rows=${items || []} render=${itemRow} />
      ${cls.itemsNext ? html`<${More} label=${x('cls.moreRows')} onMore=${() => cls.moreItems()} />` : null}
    <//>`;
}

/**
 * The confirm step of an accepted suggestion that lowers a classification which needs a reason:
 * what it lowers from and to, the reason field, and Accept only once the reason is written.
 */
function reasonDialog(cls) {
  const ask = cls.lowering;
  if (!ask) return null;
  const said = cls.reason.trim();
  const busy = !!cls.busy;
  return html`
    <${Modal} open onClose=${() => cls.cancelLowering()} size="sm" title=${x('cls.reasonTitle')}
      footer=${html`
        <${Action} onClick=${() => cls.cancelLowering()} disabled=${busy}>${t('common.cancel')}<//>
        <${Loud} control onClick=${() => ask.send(said)} disabled=${busy || !said}>${x('cls.reasonSend')}<//>`}>
      <${Fields}>
        <${Note}>${x('cls.reasonBody', ask.words)}<//>
        <${TextArea} label=${x('cls.reasonLabel')} rows=${3} maxLength=${2000} autoFocus value=${cls.reason} onInput=${cls.setReason} />
      <//>
    <//>`;
}

/** How long the log keeps its rows: the node policy's days, or every row. */
function keepsWords(eff) {
  const days = eff?.auditRetentionDays;
  return typeof days === 'number' && days > 0 ? x('cls.keepsDays', { n: n(days) }) : x('cls.keepsAll');
}

/** The section. `num` is its number on the page. */
export function secClassification(ctx, num) {
  const cls = ctx.cls;
  const v = cls.view;
  const body = !v
    ? (cls.failed ? html`<${Note} kind="quiet">${x('cls.loadFailed')}<//>` : html`<${Note} kind="loading">${x('loading')}<//>`)
    : sections(cls, ctx.session?.owner);
  return html`
    <${Section} id="dw-class" num=${num} title=${x('cls.title')} count=${classificationCount(cls)}>
      <${Note} kind="lead">${x('cls.lead')}<//>
      ${body}
      ${reasonDialog(cls)}
    <//>`;
}

function sections(cls, me) {
  const v = cls.view;
  const eff = v.effective || {};
  const labels = (eff.labels || []).filter((l) => l.status !== 'retired').slice().sort((a, b) => a.rank - b.rank);
  const dflt = labelById(eff, eff.defaultLabel);
  const rows = cls.rows;
  const shown = v.mode !== 'off' || (rows && rows.length);
  const filters = ['all', ...ACTIONS].map((a) => ({ value: a, label: a === 'all' ? x('cls.filterAll') : actionWord(a) }));
  return html`
    <${Facts} rows=${[switchRow(cls)]} />
    ${dropped(cls)}
    ${proposal(cls)}
    ${v.mode !== 'off' ? html`
      <${Space} above="section">
        <${Label} block>${x('cls.labels')}<//>
        <${List} cols="name-state-meta-meta-doors" labels head=${[x('cls.col.label'), x('cls.col.ai'), x('cls.col.leave'), x('cls.col.audience'), '']}
          empty=${x('cls.noLabels')} rows=${labels} render=${labelRow} />
        ${dflt ? html`<${Note} kind="hint">${x('cls.defaultLabel', { label: labelName(dflt) })}<//>` : null}
      <//>` : null}
    ${v.mode !== 'off' || (cls.items && cls.items.length) || (cls.pending && cls.pending.length) ? itemSections(cls, me) : null}
    ${shown ? html`
      <${Space} above="section">
        <${Label} block>${x('cls.audit')}<//>
        <${Note} kind="hint">${keepsWords(eff)}<//>
        <${Tabs} tone="filter" value=${cls.action} onSelect=${(a) => cls.setAction(a)} items=${filters} />
        <${List} cols="name-desc-count-when-doors" keepCols loading=${!rows}
          head=${[x('col.who'), x('col.what'), { label: x('col.times'), num: true }, x('col.when'), '']}
          empty=${html`<${Note} kind="quiet"><b>${x('cls.auditEmptyTitle')}</b> ${x('cls.auditEmptyBody')}<//>`}
          rows=${rows || []} render=${(r) => auditRow(eff, r)} />
        ${rows && rows.length >= cls.limit && cls.limit < MAX_ROWS ? html`<${More} label=${x('cls.moreRows')} onMore=${() => cls.more()} />` : null}
      <//>` : null}`;
}
