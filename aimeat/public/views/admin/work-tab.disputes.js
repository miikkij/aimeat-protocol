/**
 * @file public/views/admin/work-tab.disputes.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Work page's disputes that wait for the operator: the ones the parties escalated and
 *   the ones the 30-day timeout handed over because the provider's balance did not cover the refund
 *   (GET /v1/admin/disputes), each with the ruling dialog (POST /v1/admin/disputes/:id/rule). A notice
 *   about a waiting dispute opens this page with ?dispute=<id>, and the dialog of that dispute opens.
 *   The operator's own AI reads and rules the same list with aimeat_admin_disputes and
 *   aimeat_admin_dispute_rule.
 * @structure useWaitingDisputes() · DisputesSection({ list, first, onError, onDone }) · RuleDialog
 * @usage const disputes = useWaitingDisputes(); html`<${DisputesSection} list=${disputes} first />`
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida): the notice
 *     "Dispute … needs your ruling" opened the admin front page, and a ruling needed a hand-written
 *     REST call.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { getAdminDisputes, ruleDispute } from '/js/services/admin.js';
import { num, dt } from './shared.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, When, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Modal } from '/components/Modal.js';
import { Note } from '/components/Note.js';
import { Choice } from '/components/Choice.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Stack } from '/components/Layout.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const D = (key, params) => t('dashboard.workPage.disputes.' + key, params);

/** The tools the operator's own AI reads and rules this list with. */
const AI_TOOLS = ['aimeat_admin_disputes', 'aimeat_admin_dispute_rule'];

/** The waiting disputes, loaded once and again when a dispute changes anywhere on the node. */
export function useWaitingDisputes() {
  const [list, setList] = useState([]);
  const load = useCallback(async () => {
    try {
      const r = await getAdminDisputes('escalated');
      setList(r?.data?.disputes || []);
    } catch (err) {
      // The Work page stands without this section; a failed read leaves the last list.
      swallowed('admin disputes: list not read', err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['disputes', 'work'], () => load()), [load]);
  return list;
}

/** A whole, non-negative number from a field, or null for anything else. */
function whole(v) {
  const s = String(v ?? '').trim();
  if (s === '') return 0;
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** The ruling dialog of one dispute: who gets what, the reason, and a press that cannot be undone. */
function RuleDialog({ dispute, onClose, onError, onDone }) {
  const [ruling, setRuling] = useState('split');
  const [toRequester, setToRequester] = useState('');
  const [burned, setBurned] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const paid = dispute.paid_morsels || 0;
  const back = whole(toRequester);
  const burn = whole(burned);
  const bad = back === null || burn === null || back + burn > paid;
  const kept = bad ? null : paid - back - burn;

  const rule = async () => {
    if (bad || busy) return;
    setBusy(true);
    try {
      await ruleDispute(dispute.id, { ruling, distribution: { to_requester: back, burned: burn }, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      onDone(D('ruled', { code: dispute.tracking_code }));
      onClose();
    } catch (e) {
      onError((e && e.message) || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Modal} open onClose=${onClose} title=${D('ruleTitle', { code: dispute.tracking_code })}
      footer=${html`
        <${Action} onClick=${onClose}>${t('common.cancel')}<//>
        <${Loud} control danger disabled=${bad || busy} onClick=${rule}>${D('ruleFinal')}<//>`}>
      <${Stack} gap="medium">
        <span>${D('ruleLead', { requester: dispute.requester || '?', provider: dispute.provider || '?', paid: num(paid) })}</span>
        <${Note}>${dispute.reason}<//>
        <${Choice} label=${D('rulingLabel')} value=${ruling} onChange=${setRuling}
          options=${[['requester_wins', D('requesterWins')], ['split', D('split')], ['provider_wins', D('providerWins')]]} />
        <${TextField} type="number" min="0" step="1" inputMode="numeric" label=${D('toRequester')}
          value=${toRequester} placeholder="0" onInput=${setToRequester} />
        <${TextField} type="number" min="0" step="1" inputMode="numeric" label=${D('burned')}
          value=${burned} placeholder="0" onInput=${setBurned} />
        <span>${bad ? D('tooMuch', { paid: num(paid) }) : D('providerKeeps', { n: num(kept) })}</span>
        <${TextArea} label=${D('reasonLabel')} value=${reason} placeholder=${D('reasonPh')} onInput=${setReason} />
        <${Note}>${D('final')}<//>
      <//>
    <//>`;
}

/**
 * The section: one row per waiting dispute, the ruling dialog, and the AI's two tools. Nothing is
 * drawn while none waits. `?dispute=<id>` in the address opens that dispute's dialog once it is listed.
 */
export function DisputesSection({ list, first, onError, onDone }) {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const url = new URL(location.href);
    const asked = url.searchParams.get('dispute');
    if (!asked) return;
    const hit = list.find(d => d.id === asked);
    if (!hit) return;
    setOpen(hit);
    url.searchParams.delete('dispute');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }, [list]);

  if (!list.length) return null;
  return html`
    <${Section} first=${first} id="adm-work-disputes" title=${D('title')} count=${num(list.length)}>
      <${List} cols="state-name-who-when-doors" head=${[D('colState'), D('colWork'), D('colWho'), D('colWaits'), '']} labels>
        ${list.map(d => html`
          <${Row} key=${d.id} rail=${d.timed_out ? 'notice' : undefined}>
            <${Mark} kind="status" tone="attention">${d.timed_out ? D('timedOut') : D('escalated')}<//>
            <${Name} desc=${d.reason} note=${D('paid', { n: num(d.paid_morsels || 0) })}>${d.tracking_code}<//>
            <${Who}>${d.requester || '?'} → ${d.provider || '?'}<//>
            <${When} title=${dt(d.waits_since)}>${dt(d.waits_since)}<//>
            <${Doors}><${Action} small onClick=${() => setOpen(d)}>${D('rule')}<//><//>
          <//>`)}
      <//>
      <${Note} kind="aside" size="small">
        <b>${D('aiTitle')}</b> ${D('aiText')}
        <${Marks}>${AI_TOOLS.map(n => html`<${Code} key=${n}>${n}<//>`)}<//>
      <//>
      ${open && html`<${RuleDialog} dispute=${open} onClose=${() => setOpen(null)} onError=${onError} onDone=${onDone} />`}
    <//>`;
}
