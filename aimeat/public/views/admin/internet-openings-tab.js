/**
 * @file public/views/admin/internet-openings-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin page "Open to the internet" (id `internet-openings`, opened by
 *   /v1/admin?tab=internet-openings, the link the operators' notifications carry). On a node whose
 *   content access is "signed-in", one app and the public intake forms it declares can be opened to
 *   everyone on the internet as a watched exception; this page lists them. One read, GET
 *   /v1/admin/internet-openings, which the aimeat_admin_internet_openings tool returns too, re-read on
 *   the SSE change domains `internet-openings` and `config`. In order: the lead, the numeral strip
 *   (open now, waiting for your decision, ending within 7 days), how apps are opened (the node
 *   setting and the longest opening), the owners who may open on their own (only while an operator
 *   approves), what waits for your decision, what is open now, what closed or was declined in the
 *   last 30 days, and the aside on the same list for the operator's own AI. When the node is open to
 *   everyone, nothing needs opening and the page shows only the history. Every part is a library
 *   component; the page passes data and writes no class.
 * @structure InternetOpeningsTab({ data, reload, switchPage }) — load · Strip · the sections from
 *   internet-openings-tab.parts.js and internet-openings-tab.lists.js · AiAside · the writes (setting,
 *   decide, close, trust, untrust)
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Note } from '/components/Note.js';
import { Marks, Code } from '/components/Mark.js';
import { saveConfig } from '/js/services/admin.js';
import {
  getInternetOpenings, decideInternetOpening, closeInternetOpening, setInternetOpener, removeInternetOpener,
} from '/js/services/internet-opening.js';
import { O, ModeSection, OpenersSection } from './internet-openings-tab.parts.js';
import { WaitingSection, OpenSection, ClosedSection, waitingItems } from './internet-openings-tab.lists.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** The tools the operator's own AI reads and decides this list with. */
const AI_TOOLS = ['aimeat_admin_internet_openings', 'aimeat_admin_internet_opening_decide', 'aimeat_admin_internet_opener_set'];

/** The numeral strip: open now, waiting for a decision, ending within 7 days; each scrolls to its section. */
function Strip({ counts, toSection }) {
  return html`<${FigureStrip} wrap items=${[
    { key: 'open', n: num(counts.open), label: O('strip.open'), sub: O('strip.openSub'), onClick: () => toSection('adm-io-open') },
    { key: 'waiting', n: num(counts.waiting), label: O('strip.waiting'), sub: O('strip.waitingSub'), tone: counts.waiting > 0 ? 'notice' : undefined, onClick: () => toSection('adm-io-waiting') },
    { key: 'soon', n: num(counts.ending_soon), label: O('strip.soon'), sub: O('strip.soonSub'), tone: counts.ending_soon > 0 ? 'warn' : undefined, onClick: () => toSection('adm-io-open') },
  ]} />`;
}

/** The aside: the operator's own AI reads and decides the same list with three tools. */
function AiAside() {
  return html`
    <${Note} kind="aside" size="small">
      <b>${O('ai.title')}</b> ${O('ai.text')}
      <${Marks}>${AI_TOOLS.map(n => html`<${Code} key=${n}>${n}<//>`)}<//>
    <//>`;
}

export default function InternetOpeningsTab(props) {
  const { data, reload, switchPage } = props;
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await getInternetOpenings();
      setList(r.data);
      setFailed(false);
    } catch (e) {
      setFailed(true);
      showErr((e && e.message) || t('common.error'));
    }
  }, [showErr]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['internet-openings', 'config'], () => load()), [load]);

  const toSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /** One write, one re-read, one word to the operator; true when it was done. */
  const write = async (fn, word) => {
    try {
      await fn();
      showOk(word);
      await load();
      return true;
    } catch (e) {
      // The operator reads the refusal in the toast; the form keeps what they typed.
      swallowed('internet-openings-tab: write', e);
      showErr((e && e.message) || t('common.error'));
      return false;
    }
  };

  /** A node setting through the Config tab's own route; the node names a value it refused. */
  const setSetting = (path, value) => write(async () => {
    const r = await saveConfig([{ path, value }]);
    const refused = (r.data && r.data.errors) || [];
    if (refused.length) throw new Error(refused[0].reason || O('settingRefused'));
    reload?.();
  }, O('settingSaved'));

  const decide = (item, decision, note) => write(
    () => decideInternetOpening(item.o.owner, item.o.app, { decision, note, which: item.which }),
    O(decision === 'approve' ? 'approved' : 'declined', { app: item.o.app_name || item.o.app }),
  );
  const close = (o, reason) => write(() => closeInternetOpening(o.owner, o.app, reason), O('closed', { app: o.app_name || o.app }));
  const give = (owner, reason, until) => write(() => setInternetOpener(owner, reason, until), O('openers.given', { owner }));
  const untrust = (owner) => confirm(
    O('openers.removeAsk', { owner }),
    () => write(() => removeInternetOpener(owner), O('openers.removed', { owner })),
    { danger: true, title: O('openers.title'), confirmLabel: O('openers.remove') },
  );

  if (!list) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      ${failed ? html`<${Note} kind="quiet">${O('loadFailed')}<//>` : html`<${Spinner} />`}`;
  }

  // The node is open to everyone: nothing needs opening, so only what happened before shows.
  if (list.mode === 'not-needed') {
    return html`
      <${ConfirmUI} />${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note} kind="lead">${O('leadNotNeeded')}<//>
      <${ClosedSection} number="01" openings=${list.openings} notNeeded />
      <${AiAside} />`;
  }

  let counter = 0;
  const n = () => String(++counter).padStart(2, '0');
  const people = (data?.ghiiUsers || []).map(u => {
    const name = u.owner_name || u.username || String(u.ghii || '').split('@')[0];
    return { id: name, name, sub: u.ghii };
  }).filter(p => p.id);
  // Every request that waits is listed whatever its age, and an opening may wait twice (an extension
  // and new forms), so the strip counts the items the section shows.
  const waiting = waitingItems(list.openings).length;
  return html`
    <${ConfirmUI} />${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Note} kind="lead">${O('lead')}<//>
    <${Strip} counts=${{ ...list.counts, waiting }} toSection=${toSection} />
    <${ModeSection} number=${n()} mode=${list.mode} maxDays=${list.max_days} onSet=${setSetting} switchPage=${switchPage} />
    ${list.mode === 'operator'
      ? html`<${OpenersSection} number=${n()} openers=${list.openers || []} people=${people} onGive=${give} onRemove=${untrust} />`
      : null}
    <${WaitingSection} number=${n()} openings=${list.openings} onDecide=${decide} />
    <${OpenSection} number=${n()} openings=${list.openings} onClose=${close} />
    <${ClosedSection} number=${n()} openings=${list.openings} />
    <${AiAside} />`;
}
