/**
 * @file track-response-modal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Track a response" modal, shared by the Inbox tab and the Notebook. The INTENT is
 *   formed entirely by AI (the records triage): on open it asks the caller's own model which organism
 *   → workspace → RECORD TYPE best fits this message (chosen generically from what each workspace
 *   actually offers — not hard-coded), drafts a title + content, and (on create) builds the record
 *   value to conform to that type's ACTUAL schema + derives the completion condition. On submit the
 *   record is written DRAFT→PUBLISH through the proper workspace flow and bound to a Tracked Response.
 *   A secondary "park to notebook" action stores the message (with its source link + reply intent) for
 *   later processing instead of placing it now. No AI key → no feature.
 * @structure TrackResponseModal({ open, msg, onClose, onDone, showToast, defaultMode, allowPark })
 * @usage import { TrackResponseModal } from '/views/profile/track-response-modal.js';
 * @version-history
 *   v1.0.0 — 2026-06-21 — Extracted from inbox-tab.js so the Notebook can reuse it; + park-to-notebook.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Modal } from '/components/Modal.js';
import { Spinner } from './shared.js';
import * as tracked from '/js/services/tracked-responses.js';
import { parkMessageToNotebook } from '/js/services/notebook.js';
import { writeDraft, publishDraft, wsRoot } from '/js/services/organisms.js';
import { NB_STEPS, firstLine } from './notebook-helpers.js';

export function TrackResponseModal({ open, msg, onClose, onDone, showToast, defaultMode = 'approve', allowPark = true }) {
  const [phase, setPhase] = useState('classify');   // 'classify' | 'review' | 'error'
  const [aiErr, setAiErr] = useState(null);
  const [orgs, setOrgs] = useState([]);             // AI triage context: organisms → workspaces → recordTypes
  const [orgId, setOrgId] = useState('');
  const [wsId, setWsId] = useState('');
  const [namespace, setNamespace] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [replyMode, setReplyMode] = useState(defaultMode);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const sugRef = useRef({ workspaceId: '', namespace: '' });   // AI's suggested ws + record type (preselect)

  // On open: AI triage forms the FULL intent (organism + workspace + record TYPE + title + content).
  // Dropdown options come from the AI's context; the suggestion preselects everything. No AI key →
  // error phase (placement unavailable — but you can still park to the notebook).
  useEffect(() => {
    if (!open || !msg) return undefined;
    let cancelled = false;
    setPhase('classify'); setAiErr(null); setStep(0); setBusy(false); setReplyMode(defaultMode);
    setOrgs([]); setOrgId(''); setWsId(''); setNamespace('');
    const timer = setInterval(() => setStep(s => (s + 1) % NB_STEPS.length), 2200);
    (async () => {
      try {
        const result = await tracked.triageMessage(msg.body);
        if (cancelled) return;
        const sug = result?.suggestion || {};
        const ctxOrgs = result?.context?.organisms || [];
        setOrgs(ctxOrgs);
        sugRef.current = { workspaceId: sug.workspaceId || '', namespace: sug.namespace || '' };
        setTitle((sug.title || firstLine(msg.body) || '').slice(0, 120));
        setContent(sug.markdown || msg.body || '');
        setOrgId(ctxOrgs.some(o => o.id === sug.organismId) ? sug.organismId : (ctxOrgs[0]?.id || ''));
        setPhase('review');
      } catch (e) {
        if (cancelled) return;
        setAiErr({ message: e?.message || '', code: e?.code }); setPhase('error');
      } finally { clearInterval(timer); }
    })();
    return () => { cancelled = true; clearInterval(timer); };
    // defaultMode only seeds the initial replyMode; this effect runs the expensive AI triage and must
    // re-run only when the modal opens / the message changes, never when defaultMode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, msg]);

  const org = orgs.find(o => o.id === orgId);
  // Memoized so it is a stable dependency for the record-type effect below (else a fresh [] each render).
  const workspaces = useMemo(() => org?.workspaces || [], [org]);
  const recTypes = workspaces.find(w => w.id === wsId)?.recordTypes || [];

  // Organism chosen → preselect the AI's suggested workspace when valid.
  useEffect(() => {
    if (!org) { setWsId(''); return; }
    const sug = sugRef.current;
    if (!org.workspaces.some(w => w.id === wsId)) {
      setWsId(org.workspaces.some(w => w.id === sug.workspaceId) ? sug.workspaceId : (org.workspaces[0]?.id || ''));
    }
  }, [orgId, orgs, org, wsId]);

  // Workspace chosen → preselect the AI's suggested record type when valid.
  useEffect(() => {
    const types = workspaces.find(w => w.id === wsId)?.recordTypes || [];
    if (!types.length) { setNamespace(''); return; }
    if (types.some(tp => tp.namespace === namespace)) return;
    const sug = sugRef.current;
    setNamespace(types.some(tp => tp.namespace === sug.namespace) ? sug.namespace : types[0].namespace);
  }, [wsId, orgs, namespace, workspaces]);

  const close = () => { if (!busy) onClose?.(); };

  const submit = async () => {
    if (busy || !msg) return;
    if (!orgId || !wsId || !namespace) { showToast?.(t('inbox.trackPickTarget'), true); return; }
    setBusy(true);
    try {
      const recordId = 'rec-' + Math.random().toString(36).slice(2, 10);
      // Schema-aware fill: the AI builds the value to conform to THIS record type's actual schema (any
      // shape) + derives the schema-correct completion condition + inject field. Validated server-side.
      const fill = await tracked.fillRecord({ organismId: orgId, ws: wsId, namespace, recordId, message: msg.body, title, content });
      if (!fill?.value) throw new Error(t('inbox.trackFailed'));
      // Proper workspace flow: write a DRAFT then PUBLISH (activity feed + right owner + publish gate).
      const wr = await writeDraft(orgId, wsId, namespace, recordId, fill.value);
      if (wr?.ok === false) throw new Error(wr.error?.message || t('inbox.trackFailed'));
      const pub = await publishDraft(orgId, wsId, namespace, recordId);
      const gated = pub?.ok === false || pub?.data?.gated === true || /gate|approv/i.test(pub?.error?.code || '');
      const watchKey = `${wsRoot(orgId, wsId)}.${namespace}.${recordId}.latest`;
      await tracked.createTrackedResponse({
        messageId: msg.id,
        title: title.trim() || undefined,
        watch: { key: watchKey, condition: fill.condition },
        response: { mode: replyMode, inject: fill.inject?.field ? { from: 'watch.value', field: fill.inject.field } : undefined },
        references: { organismId: orgId, workspaceId: wsId, records: [{ namespace, id: recordId }] },
      });
      showToast?.(gated ? t('inbox.trackCreatedGated') : t('inbox.trackCreated'));
      onDone?.(); onClose?.();
    } catch (e) {
      showToast?.(e?.message || t('inbox.trackFailed'), true);
    }
    setBusy(false);
  };

  // Park to the notebook for later — keeps the source link + reply intent; processed later from there.
  const park = async () => {
    if (busy || !msg) return;
    setBusy(true);
    try {
      await parkMessageToNotebook(msg, { title: title || firstLine(msg.body), content: content || msg.body, mode: replyMode });
      showToast?.(t('inbox.trackParked'));
      onDone?.(); onClose?.();
    } catch (e) {
      showToast?.(e?.message || t('inbox.trackFailed'), true);
    }
    setBusy(false);
  };

  const parkBtn = allowPark ? html`<button class="btn-outline" disabled=${busy} onClick=${park}>📓 ${t('inbox.trackPark')}</button>` : null;

  return html`
    <${Modal} open=${open} onClose=${close} title=${t('inbox.trackResponse')} className="inbox-track-modal">
      ${phase === 'classify' ? html`
        <div class="inbox-track-classify">
          <${Spinner} />
          <div class="inbox-track-classify-step">${t('inbox.trackAiThinking')}</div>
          <div class="inbox-track-classify-sub">${t(NB_STEPS[step]) || ''}</div>
        </div>` : null}

      ${phase === 'error' ? html`
        <div class="inbox-track-form">
          <p class="inbox-track-hint">${t('inbox.trackNeedsAi')}</p>
          ${aiErr?.message ? html`<p class="inbox-tracked-err">${escHtml(aiErr.message)}</p>` : null}
          <div class="inbox-track-actions">
            <button class="btn-ghost" disabled=${busy} onClick=${onClose}>${t('common.cancel')}</button>
            ${parkBtn}
            <button class="btn-outline" disabled=${busy} onClick=${() => { window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'mcp' } })); onClose?.(); }}>${t('inbox.trackConfigureAi')}</button>
          </div>
        </div>` : null}

      ${phase === 'review' ? html`
        <div class="inbox-track-form">
          <p class="inbox-track-hint">${t('inbox.trackHintAi')}</p>
          <label class="inbox-form-row">
            <span class="inbox-form-label">${t('inbox.trackOrganism')}</span>
            <select class="inbox-input" value=${orgId} onChange=${(e) => { setOrgId(e.target.value); setWsId(''); }}>
              ${orgs.map(o => html`<option key=${o.id} value=${o.id}>${escHtml(o.name || o.id)}</option>`)}
            </select>
          </label>
          <label class="inbox-form-row">
            <span class="inbox-form-label">${t('inbox.trackWorkspace')}</span>
            <select class="inbox-input" value=${wsId} onChange=${(e) => setWsId(e.target.value)} disabled=${!orgId}>
              <option value="">${t('inbox.trackChoose')}</option>
              ${workspaces.map(w => html`<option key=${w.id} value=${w.id}>${escHtml(w.name || w.id)}</option>`)}
            </select>
          </label>
          <label class="inbox-form-row">
            <span class="inbox-form-label">${t('inbox.trackType')}</span>
            <select class="inbox-input" value=${namespace} onChange=${(e) => setNamespace(e.target.value)} disabled=${!recTypes.length}>
              ${recTypes.length === 0 ? html`<option value="">${t('inbox.trackNoTypes')}</option>` : null}
              ${recTypes.map(tp => html`<option key=${tp.namespace} value=${tp.namespace}>${escHtml(tp.name)}</option>`)}
            </select>
          </label>
          <label class="inbox-form-row">
            <span class="inbox-form-label">${t('inbox.trackTitle')}</span>
            <input class="inbox-input" type="text" value=${title} onInput=${(e) => setTitle(e.target.value)} />
          </label>
          <label class="inbox-form-row">
            <span class="inbox-form-label">${t('inbox.trackContent')}</span>
            <textarea class="inbox-input inbox-track-content" rows="4" value=${content} onInput=${(e) => setContent(e.target.value)}></textarea>
          </label>
          <label class="inbox-form-row">
            <span class="inbox-form-label">${t('inbox.trackReplyMode')}</span>
            <select class="inbox-input" value=${replyMode} onChange=${(e) => setReplyMode(e.target.value)}>
              <option value="approve">${t('inbox.trackModeApprove')}</option>
              <option value="auto">${t('inbox.trackModeAuto')}</option>
            </select>
          </label>
          <p class="inbox-track-hint">${t('inbox.trackFillNote')}</p>
          <div class="inbox-track-actions">
            <button class="btn-ghost" disabled=${busy} onClick=${close}>${t('common.cancel')}</button>
            ${parkBtn}
            <button class="btn-primary" disabled=${busy || !namespace} onClick=${submit}>
              ${busy ? html`<span class="inbox-spinner"></span> ${t('inbox.trackCreating')}` : t('inbox.trackCreate')}
            </button>
          </div>
        </div>` : null}
    </${Modal}>`;
}
