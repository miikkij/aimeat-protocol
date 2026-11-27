/**
 * @file work-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing incoming and outgoing work requests.
 *   Displays inbox (received) and sent work items with accept/decline/deliver actions
 *   and a rating modal for completed deliveries. How the page explains itself
 *   (.claude/rules/page-guidance.md): PageStart "work" under the head and the title's question mark
 *   concept.work_request.
 * @version-history
 *   v1.22.0 -- 2026-11-27 -- With no work in either direction the strip is not drawn (FigureStrip hideZeros, its first figure now counts every work item) and the page is section 01 with one line that says how a request gets here; the sent requests and the delivered record are drawn once they hold something, the numbers and the rail follow what is drawn, and one section has no rail. A request that waits for an answer, then work to deliver, comes first in the inbox; a delivery that waits for a rating first in the sent list.
 *   v1.21.0 -- 2026-11-27 -- The page leads with where things stand: a figure strip (requests that wait for an answer, work to deliver, deliveries that wait for a rating, work delivered) from the overview it already reads. The three lists are sections with the contents rail instead of view tabs: 01 requests to the person (wk-inbox), 02 requests they sent (wk-sent), 03 work they delivered (wk-delivered) as a FoldSection row that says how many. Accept is the one loud action; Deliver on a row is a quiet Action that opens the same dialog. No list or control was removed.
 *   v1.20.0 -- 2026-11-15 -- Accept and Decline say what they do (the past-tense "Work accepted" was the label and the error toast); accept, decline and deliver have their own error toasts; the Deliver dialog's placeholder goes through t(). A Delivered view lists the work the person delivered as a provider (GET /v1/work/overview `delivered`), with what was sent and the rating, so a delivered item no longer leaves no record. Decline and Rate are the control-tall action (Action `control`), the touch target Accept has.
 *   v1.19.0 -- 2026-11-15 -- A row reads its tracking code from `tracking_code`, the name the work routes answer with, so accept, decline, deliver and rate reach the right item, and names the row by its `action_id` when it has no description. A sent item shows what was delivered, "Delivered with no text" for an empty one; an empty text area delivers { text: "" }.
 *   v1.18.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md): PageStart under the head (folded once a work item is listed) and the title's question mark concept.work_request; the head's paragraph is two sentences.
 *   v1.17.1 -- 2026-10-11 -- The pacing amount is read where the work routes put it, `cost.toll` (then `cost.base_price`, then the flat fields), so a work item in the inbox and in the sent list shows "pacing N morsels" again.
 *   v1.17.0 -- 2026-10-11 -- A work item's morsels read "pacing N morsels" (toll, then the 3.x base_price mirror, then toll_morsels / price_morsels), not "Cost: N ❤️": a morsel is pacing, not a price.
 *   v1.16.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a work description with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.16.0 -- 2026-09-26 -- Every part is a component that gets data (component plan, page group G4): the page frame
 *     (SettingsPage), the view tabs (Tabs bar), the list (List, Row, Name, Desc, Doors), the state (Mark status), the
 *     ways on (Loud, Action), the dialogs' words (Note, TextArea) and the stars to give (components/Stars.js, now
 *     buttons in a radio group, so a keyboard can rate too). The page writes no class.
 *   v1.15.0 -- 2026-09-26 -- Rating a work item is the library's Rating stars in the tone to give (css/components/rating-stars.css): dark up to the rating and up to the star under the pointer, instead of amber (a unification: Jouni's decision "Rating stars").
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A list drawn as classic cards is the Listing (css/components/listing.css), a row that opens shows the Listing's open panel; the card, its header, arrow and detail rules go (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.8.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- V2u: compose the tab strip top rule from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — The rate and deliver dialogs' actions sit in their footers, Cancel first.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.3.0 — 2026-07-16 — Mount folds inbox + sent into GET /v1/work/overview (getWorkOverview); individual reads kept as fallback.
 *   v1.0.0 — 2026-03-16 — Initial work tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes; i18n for action labels
 *   v1.2.0 — 2026-06-02 — Component unification (#2): Rate + Deliver modals use the
 *     canonical <Modal> component (Escape/backdrop close + header ✕) instead of
 *     hand-rolled .modal-overlay markup.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { timeAgo } from '/js/utils.js';
import { pacingOf } from '/js/format.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { PageStart } from '/components/PageStart.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextArea } from '/components/TextField.js';
import { Stack } from '/components/Layout.js';
import { Stars } from '/components/Stars.js';
import { listInbox, listSent, getWorkOverview, submitRating, acceptWork, rejectWork, deliverWork } from '/js/services/work.js';
import { swallowed } from '/js/swallowed.js';
import { deliveredText } from './work-delivered.js';

/**
 * A work item's pacing amount. The work routes nest it under `cost` (presentWorkCost: `cost.toll`,
 * with `cost.total` adding the network fee, and the 3.x mirror `cost.base_price` / `cost.basePrice`);
 * a flat `toll` / `base_price` and the offer-style fields pacingOf reads are the older shapes.
 */
const num = (v) => (typeof v === 'number' ? v : undefined);
const workToll = (w) => num(w.cost?.toll) ?? num(w.cost?.base_price) ?? num(w.cost?.basePrice) ?? num(w.toll) ?? num(w.base_price) ?? pacingOf(w);

/**
 * A list in the order a person acts on it: in the inbox a request that waits for an answer first,
 * then accepted work still to deliver; in the sent list a delivery that waits for a rating first.
 * The server's order holds within each group.
 */
const ATTENTION = {
  inbox: (w) => (['pending', 'offered'].includes(w.status) ? 0 : ['accepted', 'in_progress'].includes(w.status) ? 1 : 2),
  sent: (w) => (w.status === 'delivered' ? 0 : 1),
};
function byAttention(items, type) {
  const rank = ATTENTION[type];
  if (!rank) return items;
  return items.map((w, i) => [w, i]).sort(([a, i], [b, j]) => (rank(a) - rank(b)) || i - j).map(([w]) => w);
}

export default function WorkTab({ session, showToast, onStats }) {
  const [workInbox, setWorkInbox] = useState(null);
  const [workSent, setWorkSent] = useState(null);
  // The work this person (or their agents) delivered as a provider: it left the inbox, and this is
  // where it stays on record. Only the overview carries it, so the fallback reads leave it empty.
  const [workDelivered, setWorkDelivered] = useState(null);
  const [deliveredOpen, setDeliveredOpen] = useState(false);
  const [rateModal, setRateModal] = useState(null);
  const [deliverModal, setDeliverModal] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const loadData = useCallback(async () => {
    // Mount fold: ONE composite (inbox + sent). On failure, fall back to the individual reads.
    const ov = await getWorkOverview();
    if (ov) {
      setWorkInbox(ov.inbox);
      onStats?.({ work: ov.inbox.length });
      setWorkSent(ov.sent);
      setWorkDelivered(ov.delivered);
      return;
    }
    setWorkDelivered([]);
    try {
      const inbox = await listInbox();
      setWorkInbox(inbox);
      onStats?.({ work: inbox.length });
    } catch (err) { swallowed('work-tab', err); setWorkInbox([]); }
    try {
      const sent = await listSent();
      setWorkSent(sent);
    } catch (err) { swallowed('work-tab', err); setWorkSent([]); }
  }, [onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // A TAB SHOWING SERVER DATA RE-FETCHES ON THE LIVE STREAM. Every sibling here subscribes; these
  // three did not, so a work item accepted or delivered anywhere else -- another tab, an agent, the
  // MCP surface -- left this list showing yesterday until the person reloaded. Review item 7.6.
  useEffect(() => {
    // The DOMAINS this tab actually depends on. A listener that re-fetches on every event of any
    // kind is the fan-out services/surface/shared-read.js exists to remove; the sibling tabs filter,
    // and so does this. `detail.domains` absent means "everything changed", which is the legacy
    // announce and must still be honoured.
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !['work', 'disputes'].some(x => d.has(x))) return;
      if (session) loadData();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, loadData]);

  async function handleRate(workId, rating, comment) {
    if (!rating) { showToast(t('profile.work.selectRating'), true); return; }
    const resp = await submitRating(workId, rating, comment);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.work.ratingSubmitted'));
    setRateModal(null);
    loadData();
  }

  async function handleAccept(tc) {
    setActionLoading(tc);
    try {
      const resp = await acceptWork(tc);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.work.acceptFailed'), true); return; }
      showToast(t('profile.work.accepted'));
      loadData();
    } catch (e) {
      showToast(e.message || t('profile.work.acceptFailed'), true);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(tc) {
    setActionLoading(tc);
    try {
      const resp = await rejectWork(tc);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.work.declineFailed'), true); return; }
      showToast(t('profile.work.declined'));
      loadData();
    } catch (e) {
      showToast(e.message || t('profile.work.declineFailed'), true);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeliver(tc, result) {
    setActionLoading(tc);
    try {
      const resp = await deliverWork(tc, result);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.work.deliverFailed'), true); return; }
      showToast(t('profile.work.delivered'));
      setDeliverModal(null);
      loadData();
    } catch (e) {
      showToast(e.message || t('profile.work.deliverFailed'), true);
    } finally {
      setActionLoading(null);
    }
  }

  function statusTone(status) {
    switch (status) {
      case 'completed':
      case 'accepted':
      case 'in_progress':
      case 'rated':
      case 'settled': return 'fine';
      case 'delivered':
      case 'disputed':
      case 'contested':
      case 'escalated': return 'attention';
      case 'rejected':
      case 'cancelled': return 'danger';
      default: return 'off';
    }
  }

  // A request's state in the person's language; a state this page has no word for is shown as the
  // node sent it. The row showed the raw value ("pending", "accepted") in every language.
  function statusWord(status) {
    const key = `profile.work.status.${status}`;
    const word = t(key);
    return word && word !== key ? word : status;
  }

  function renderList(items, type, emptyKey) {
    if (!items) return html`<${List} loading=${t('profile.work.loading')} />`;
    const empty = emptyKey || { sent: 'profile.work.sentEmpty', delivered: 'profile.work.deliveredListEmpty' }[type] || 'profile.work.empty';
    return html`<${List} cols="name-desc-doors" empty=${t(empty)}>${byAttention(items, type).map(w => {
      // The work routes name the item `tracking_code`; the other names are older shapes.
      const tc = w.tracking_code || w.tc || w.id || w.work_id;
      const said = type === 'sent' || type === 'delivered' ? deliveredText(w.output) : null;
      // A rating is stored as score 5 (positive) or 1 (negative); four and up reads positive, the
      // line services/trust.ts draws.
      const score = typeof w.rating?.score === 'number' ? w.rating.score : null;
      const isLoading = actionLoading === tc;
      const status = w.status || '-';
      const isPending = status === 'pending' || status === 'offered';
      const isActive = status === 'accepted' || status === 'in_progress';

      return html`
        <${Row} key=${tc}>
          <${Name}>${w.description || w.action_name || w.action_id || '-'}<//>
          <${Desc}>
            ${type === 'sent' ? t('profile.work.provider') + ': ' + (w.provider_gaii || '-') : t('profile.work.from') + ': ' + (w.requester_gaii || '-')}
            ${workToll(w) > 0 ? ' \u2502 ' + t('pacing.amount', { n: workToll(w) }) : ''}
            ${w.created_at ? ' \u2502 ' + timeAgo(w.created_at) : ''}
            ${said ? ' \u2502 ' + (said.empty ? t('profile.work.deliveredEmpty') : t('profile.work.deliveredText', { text: said.text })) : ''}
            ${type === 'delivered' && score !== null ? ' \u2502 ' + t(score >= 4 ? 'profile.work.ratedPositive' : 'profile.work.ratedNegative') : ''}
          <//>
          <${Doors}>
          <${Mark} kind="status" tone=${statusTone(status)}>${statusWord(status)}<//>
          ${type === 'inbox' && isPending && html`
              <${Loud} control disabled=${isLoading} onClick=${() => handleAccept(tc)}>
                ${isLoading ? '...' : t('profile.work.acceptBtn')}
              <//>
              <${Action} small row control disabled=${isLoading} onClick=${() => handleReject(tc)}>
                ${isLoading ? '...' : t('profile.work.declineBtn')}
              <//>
          `}

          ${type === 'inbox' && isActive && html`
              <${Action} small row control disabled=${isLoading} onClick=${() => setDeliverModal({ tc, desc: w.description || w.action_name || w.action_id })}>
                ${t('profile.work.deliver')}
              <//>
          `}

          ${type === 'sent' && w.status === 'delivered' && html`
            <${Action} small row control onClick=${() => setRateModal({ workId: tc, desc: w.description || w.action_name || w.action_id })}>${t('profile.work.rateBtn')}<//>
          `}
          <//>
        <//>
      `;
    })}<//>`;
  }

  // The figures under the head, from the overview the page already read: every work item the page
  // holds (to the person and from them), what waits for their answer, what was delivered to them and
  // waits for a rating, and what they accepted and still deliver. With nothing at all the strip is
  // not drawn (hideZeros).
  const loaded = workInbox !== null && workSent !== null && workDelivered !== null;
  const toYou = (workInbox?.length ?? 0) + (workDelivered?.length ?? 0);
  const fromYou = workSent?.length ?? 0;
  const answerN = (workInbox || []).filter(w => ['pending', 'offered'].includes(w.status)).length;
  const deliverN = (workInbox || []).filter(w => ['accepted', 'in_progress'].includes(w.status)).length;
  const rateN = (workSent || []).filter(w => w.status === 'delivered').length;
  const strip = !loaded ? html`<${FigureStrip} loading=${4} />` : html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'all', n: toYou + fromYou, label: t('profile.work.stripAll'), sub: t('profile.work.stripAllSub', { in: toYou, out: fromYou }) },
    { key: 'answer', n: answerN, tone: answerN ? 'notice' : undefined, label: t('profile.work.stripAnswer'), sub: answerN ? t('profile.work.stripAnswerSub') : undefined },
    { key: 'rate', n: rateN, tone: rateN ? 'notice' : undefined, label: t('profile.work.stripRate') },
    { key: 'deliver', n: deliverN, label: t('profile.work.stripDeliver') },
  ]} />`;
  const deliveredSub = workDelivered === null ? '…' : tn('profile.work.foldDelivered', workDelivered.length);

  // What is drawn: the requests to the person always (with nothing anywhere, its one line is the
  // page's empty line); the sent requests and the delivered record only once they hold something.
  // The numbers and the rail follow what is drawn, and one section has no rail.
  const nothing = loaded && toYou + fromYou === 0;
  const shown = [
    { id: 'wk-inbox', label: t('profile.work.secInbox'), count: workInbox?.length },
    workSent?.length ? { id: 'wk-sent', label: t('profile.work.secSent'), count: workSent.length } : null,
    workDelivered?.length ? { id: 'wk-delivered', label: t('profile.work.secDelivered'), count: workDelivered.length } : null,
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map(s => [s.id, s.num]));

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuBuildShare'), t('profile.tabs.work')]}
      title=${t('profile.work.title')} help="concept.work_request"
      desc=${t('profile.work.desc')}
      strip=${strip}
      start=${/* Folded once either list has a work item; a request is sent by one's own AI, so no button. */
        html`<${PageStart} id="work" done=${workInbox === null || workSent === null ? null : (workInbox.length + workSent.length + (workDelivered?.length ?? 0)) > 0} />`}
      railTitle=${shown.length > 1 ? t('profile.landing.railTitle') : undefined}
      sections=${shown.length > 1 ? shown : undefined}>
      ${/* What came to the person is section 01: it is what waits for their answer. What they sent
            follows, open, since a delivery to them waits for their rating there. What they delivered is
            the record, a row that says how many and opens in place. The three lists were tabs. */''}
      <${PageSection} id="wk-inbox" num=${numOf['wk-inbox']} first title=${t('profile.work.secInbox')} count=${workInbox?.length}>
        ${renderList(workInbox, 'inbox', nothing ? 'profile.work.emptyAll' : undefined)}
      <//>
      ${numOf['wk-sent'] && html`<${PageSection} id="wk-sent" num=${numOf['wk-sent']} title=${t('profile.work.secSent')} count=${workSent.length}>
        ${renderList(workSent, 'sent')}
      <//>`}
      ${numOf['wk-delivered'] && html`<${FoldSection} id="wk-delivered" num=${numOf['wk-delivered']} title=${t('profile.work.secDelivered')} sub=${deliveredSub}
        open=${deliveredOpen} onToggle=${() => setDeliveredOpen(o => !o)}>
        ${renderList(workDelivered, 'delivered')}
      <//>`}

      ${rateModal && html`<${RateModal} desc=${rateModal.desc}
        onSubmit=${(r, c) => handleRate(rateModal.workId, r, c)}
        onCancel=${() => setRateModal(null)} />`}

      ${deliverModal && html`<${DeliverModal} desc=${deliverModal.desc}
        loading=${actionLoading === deliverModal.tc}
        onSubmit=${(result) => handleDeliver(deliverModal.tc, result)}
        onCancel=${() => setDeliverModal(null)} />`}
    <//>
  `;
}

function RateModal({ desc, onSubmit, onCancel }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${t('profile.work.rateTitle')}
      footer=${html`
        <${Action} onClick=${onCancel}>${t('profile.cancel')}<//>
        <${Loud} control onClick=${() => onSubmit(rating, comment)}>${t('profile.work.submitRating')}<//>`}>
      <${Stack} gap="large">
        <${Note}>${t('profile.work.rateDesc')} ${desc || ''}<//>
        <${Stars} value=${rating} onPick=${setRating} label=${t('profile.work.rateTitle')} />
        <${TextArea} label=${t('profile.work.commentLabel')} rows=${2} value=${comment} onInput=${setComment} />
      <//>
    <//>`;
}

function DeliverModal({ desc, loading, onSubmit, onCancel }) {
  const [result, setResult] = useState('');
  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${t('profile.work.deliver')}
      footer=${html`
        <${Action} disabled=${loading} onClick=${onCancel}>${t('profile.cancel')}<//>
        <${Loud} control disabled=${loading} onClick=${() => onSubmit(result)}>
          ${loading ? t('profile.work.delivering') : t('profile.work.deliver')}
        <//>`}>
      <${Stack} gap="large">
        <${Note}>${t('profile.work.delivering')}: ${desc || ''}<//>
        <${TextArea} label=${t('profile.work.commentLabel')} rows=${4} placeholder=${t('profile.work.deliverPlaceholder')}
          value=${result} onInput=${setResult} />
      <//>
    <//>`;
}
